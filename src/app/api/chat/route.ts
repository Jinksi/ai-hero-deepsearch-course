import type { Message } from "ai";
import { appendResponseMessages, createDataStreamResponse } from "ai";
import { Langfuse } from "langfuse";
import { globalRateLimitConfig } from "~/config/rate-limit";
import { streamFromDeepSearch, type OurMessageAnnotation } from "~/deep-search";
import { env } from "~/env";
import { auth } from "~/server/auth";
import {
  DAILY_RATE_LIMIT,
  canUserMakeRequest,
  recordUserRequest,
  upsertChat,
} from "~/server/db/queries";
import { checkRateLimit, recordRateLimit } from "~/server/redis/rate-limit";

const langfuse = new Langfuse({
  environment: env.NODE_ENV,
});

export const maxDuration = 60;

export async function POST(request: Request) {
  // Check if user is authenticated
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorised", { status: 401 });
  }

  // Create a trace with session and user tracking
  const trace = langfuse.trace({
    name: "chat",
    userId: session.user.id,
  });

  // Check global rate limit first
  const globalRateLimitSpan = trace.span({
    name: "global-rate-limit-check",
    input: globalRateLimitConfig,
  });

  const globalRateLimitCheck = await checkRateLimit(globalRateLimitConfig);

  globalRateLimitSpan.end({
    output: {
      allowed: globalRateLimitCheck.allowed,
      remaining: globalRateLimitCheck.remaining,
      totalHits: globalRateLimitCheck.totalHits,
      resetTime: globalRateLimitCheck.resetTime,
    },
  });

  if (!globalRateLimitCheck.allowed) {
    console.log("Global rate limit exceeded, waiting for reset...");
    const globalRateLimitWaitSpan = trace.span({
      name: "global-rate-limit-wait",
      input: {
        waitTime: globalRateLimitCheck.resetTime - Date.now(),
      },
    });

    const isAllowed = await globalRateLimitCheck.retry();

    globalRateLimitWaitSpan.end({
      output: {
        success: isAllowed,
      },
    });

    // If still not allowed after retries, return error
    if (!isAllowed) {
      return new Response(
        JSON.stringify({
          error: "Global rate limit exceeded",
          message:
            "Too many requests across the system. Please try again later.",
          resetTime: globalRateLimitCheck.resetTime,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": Math.ceil(
              (globalRateLimitCheck.resetTime - Date.now()) / 1000,
            ).toString(),
          },
        },
      );
    }
  }

  // Record the global rate limit usage
  await recordRateLimit(globalRateLimitConfig);

  // Check user-specific rate limiting with tracing
  const rateLimitSpan = trace.span({
    name: "user-rate-limit-check",
    input: {
      userId: session.user.id,
    },
  });

  const canMakeRequest = await canUserMakeRequest(session.user.id);

  rateLimitSpan.end({
    output: {
      canMakeRequest,
      dailyLimit: DAILY_RATE_LIMIT,
    },
  });

  if (!canMakeRequest) {
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        message: `You have exceeded the daily limit of ${DAILY_RATE_LIMIT} requests. Please try again tomorrow.`,
        limit: DAILY_RATE_LIMIT,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "86400", // 24 hours in seconds
        },
      },
    );
  }

  const body = (await request.json()) as {
    messages: Array<Message>;
    chatId: string;
    isNewChat: boolean;
  };

  // Determine the actual chat ID to use for the session
  // If it's a new chat, we'll use the generated chatId from the request
  // If it's an existing chat, we'll use the provided chatId
  const currentChatId = body.chatId;

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const { messages, chatId, isNewChat } = body;

      // Record the request with tracing
      const recordRequestSpan = trace.span({
        name: "record-user-request",
        input: {
          userId: session.user.id,
        },
      });

      await recordUserRequest(session.user.id);

      recordRequestSpan.end({
        output: {
          success: true,
        },
      });

      // If this is a new chat, send the chatId to the frontend
      if (isNewChat) {
        dataStream.writeData({
          type: "NEW_CHAT_CREATED",
          chatId,
        });
      }

      // Create or update the chat with the current messages before starting the stream
      // This protects against broken streams and ensures the user's message is saved
      let chatTitle: string;

      if (isNewChat) {
        // For new chats, generate title from the first message
        const firstMessage = messages[0];
        chatTitle = firstMessage?.content
          ? typeof firstMessage.content === "string"
            ? firstMessage.content.slice(0, 50) +
              (firstMessage.content.length > 50 ? "..." : "")
            : "New Chat"
          : "New Chat";
      } else {
        // For existing chats, use a placeholder title (won't be used)
        chatTitle = "New Chat";
      }

      // First upsertChat call with tracing
      const initialUpsertSpan = trace.span({
        name: "initial-chat-upsert",
        input: {
          userId: session.user.id,
          chatId,
          title: chatTitle,
          messageCount: messages.length,
          isNewChat,
          updateTitle: isNewChat,
        },
      });

      await upsertChat({
        userId: session.user.id,
        chatId,
        title: chatTitle,
        messages,
        updateTitle: isNewChat, // Only update title for new chats
      });

      initialUpsertSpan.end({
        output: {
          success: true,
          chatId,
        },
      });

      // Update the trace sessionId now that we have the chatId
      trace.update({
        sessionId: chatId,
      });

      const result = await streamFromDeepSearch({
        messages,
        telemetry: {
          isEnabled: true,
          functionId: `agent`,
          metadata: {
            langfuseTraceId: trace.id,
          },
        },
        writeMessageAnnotation: (annotation) => {
          dataStream.writeMessageAnnotation(annotation satisfies OurMessageAnnotation as any);
        },
        onFinish: async ({ text, finishReason, usage, response }) => {
          try {
            const responseMessages = response.messages;

            // Merge the original messages with the response messages
            const updatedMessages = appendResponseMessages({
              messages,
              responseMessages,
            });

            // Convert messages to the format expected by the database
            // The upsertChat function expects Message[] with content property
            // We store parts as content (similar to how getChat converts back)
            const messagesToSave: Message[] = updatedMessages.map((msg) => ({
              id: msg.id,
              role: msg.role,
              content: (msg.parts ?? []) as any, // Store parts as content for database
              createdAt: msg.createdAt,
            }));

            // Save the complete conversation to the database with tracing
            const finalUpsertSpan = trace.span({
              name: "final-chat-upsert",
              input: {
                userId: session.user.id,
                chatId,
                title: chatTitle,
                messageCount: messagesToSave.length,
                updateTitle: isNewChat,
                finishReason,
                usage,
              },
            });

            await upsertChat({
              userId: session.user.id,
              chatId,
              title: chatTitle,
              messages: messagesToSave,
              updateTitle: isNewChat, // Only update title for new chats
            });

            finalUpsertSpan.end({
              output: {
                success: true,
                chatId,
                totalMessages: messagesToSave.length,
              },
            });

            // Flush the trace to Langfuse
            await langfuse.flushAsync();
          } catch (error) {
            console.error("Error saving chat:", error);
            // Don't throw here as it would break the stream response
          }
        },
      });

      result.mergeIntoDataStream(dataStream);
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occured!";
    },
  });
}
