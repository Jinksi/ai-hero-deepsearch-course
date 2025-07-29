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
import { generateChatTitle } from "~/utils";

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

  // Check global rate limit first
  const globalRateLimitCheck = await checkRateLimit(globalRateLimitConfig);

  if (!globalRateLimitCheck.allowed) {
    console.log("Global rate limit exceeded, waiting for reset...");
    const isAllowed = await globalRateLimitCheck.retry();

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

  // Check user-specific rate limiting
  const canMakeRequest = await canUserMakeRequest(session.user.id);

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

  // Create a trace for telemetry metadata
  const trace = langfuse.trace({
    name: "chat",
    userId: session.user.id,
    sessionId: body.chatId,
  });

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const { messages, chatId, isNewChat } = body;

      // Record the request
      await recordUserRequest(session.user.id);

      // If this is a new chat, send the chatId to the frontend
      if (isNewChat) {
        dataStream.writeData({
          type: "NEW_CHAT_CREATED",
          chatId,
        });
      }

      // Start generating chat title in parallel for new chats
      let titlePromise: Promise<string>;
      if (isNewChat) {
        titlePromise = generateChatTitle(messages);
      } else {
        titlePromise = Promise.resolve("");
      }

      // Create or update the chat with the current messages before starting the stream
      // This protects against broken streams and ensures the user's message is saved
      if (isNewChat) {
        // For new chats, save with a temporary title
        await upsertChat({
          userId: session.user.id,
          chatId,
          title: "Generating...",
          messages,
        });
      } else {
        // For existing chats, just save the messages without updating title
        await upsertChat({
          userId: session.user.id,
          chatId,
          messages,
        });
      }

      // Update the trace sessionId now that we have the chatId
      trace.update({
        sessionId: chatId,
      });

      // Collect annotations in memory to save to the database later
      const annotations: OurMessageAnnotation[] = [];

      const result = await streamFromDeepSearch({
        messages,
        langfuseTraceId: trace.id,
        writeMessageAnnotation: (annotation) => {
          // Save the annotation in-memory
          annotations.push(annotation);
          // Send it to the client
          dataStream.writeMessageAnnotation(
            annotation satisfies OurMessageAnnotation as any,
          );
        },
        onFinish: async ({ response }) => {
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

            // Add the annotations to the last message (assistant's response)
            const lastMessage = messagesToSave[messagesToSave.length - 1];
            if (lastMessage && annotations.length > 0) {
              (lastMessage as any).annotations = annotations;
            }

            // Resolve the title promise and update the chat
            const title = await titlePromise;

            // Save the complete conversation to the database
            await upsertChat({
              userId: session.user.id,
              chatId,
              ...(title ? { title } : {}), // Only save the title if it's not empty
              messages: messagesToSave,
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
