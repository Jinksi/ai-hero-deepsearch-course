import type { Message } from "ai";
import {
  appendResponseMessages,
  createDataStreamResponse,
  streamText,
} from "ai";
import { z } from "zod";
import { model } from "~/models";
import { searchSerper } from "~/serper";
import { auth } from "~/server/auth";
import {
  DAILY_RATE_LIMIT,
  canUserMakeRequest,
  recordUserRequest,
  upsertChat,
} from "~/server/db/queries";

export const maxDuration = 60;

export async function POST(request: Request) {
  // Check if user is authenticated
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorised", { status: 401 });
  }

  // Check rate limiting
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
    chatId?: string;
  };

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const { messages, chatId } = body;

      // Record the request (we'll update with token counts later if needed)
      await recordUserRequest(session.user.id);

      // Generate chatId if not provided
      const currentChatId = chatId ?? crypto.randomUUID();

      // If this is a new chat, send the chatId to the frontend
      if (!chatId) {
        dataStream.writeData({
          type: "NEW_CHAT_CREATED",
          chatId: currentChatId,
        });
      }

      // Create or update the chat with the current messages before starting the stream
      // This protects against broken streams and ensures the user's message is saved
      const firstMessage = messages[0];
      const chatTitle = firstMessage?.content
        ? typeof firstMessage.content === "string"
          ? firstMessage.content.slice(0, 50) +
            (firstMessage.content.length > 50 ? "..." : "")
          : "New Chat"
        : "New Chat";

      await upsertChat({
        userId: session.user.id,
        chatId: currentChatId,
        title: chatTitle,
        messages,
      });

      const result = streamText({
        model,
        messages,
        system: `You are a helpful AI assistant with access to web search capabilities.

You should ALWAYS use the searchWeb tool to find current, accurate information to answer user questions. This allows you to provide up-to-date information and cite reliable sources.

When providing information:
1. Always search for relevant information using the searchWeb tool before responding
2. Cite your sources using inline links in markdown format: [label](URL), where label is the title of the source and URL is the link to the source.
3. Synthesise information from multiple sources when available
4. If you can't find relevant information through search, acknowledge the limitation, but still return the search results.

Your goal is to provide helpful, accurate, and well-sourced responses to user queries.`,
        maxSteps: 10,
        tools: {
          searchWeb: {
            parameters: z.object({
              query: z.string().describe("The query to search the web for"),
            }),
            execute: async ({ query }, { abortSignal }) => {
              const results = await searchSerper(
                { q: query, num: 10 },
                abortSignal,
              );

              return results.organic.map((result) => ({
                title: result.title,
                link: result.link,
                snippet: result.snippet,
              }));
            },
          },
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

            // Save the complete conversation to the database
            await upsertChat({
              userId: session.user.id,
              chatId: currentChatId,
              title: chatTitle,
              messages: messagesToSave,
            });
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
