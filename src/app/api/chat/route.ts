import type { Message } from "ai";
import {
  appendResponseMessages,
  createDataStreamResponse,
  streamText,
} from "ai";
import { Langfuse } from "langfuse";
import { z } from "zod";
import { env } from "~/env";
import { model } from "~/models";
import { bulkCrawlWebsites } from "~/scraper";
import { searchSerper } from "~/serper";
import { auth } from "~/server/auth";
import {
  DAILY_RATE_LIMIT,
  canUserMakeRequest,
  recordUserRequest,
  upsertChat,
} from "~/server/db/queries";

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

  // Check rate limiting with tracing
  const rateLimitSpan = trace.span({
    name: "rate-limit-check",
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

      // Get current date and time for date-aware responses
      const currentDate = new Date().toLocaleString("en-AU", {
        timeZone: "Australia/Sydney",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const result = streamText({
        model,
        messages,
        experimental_telemetry: {
          isEnabled: true,
          functionId: `agent`,
          metadata: {
            langfuseTraceId: trace.id,
          },
        },
        system: `You are a helpful AI assistant with access to web search and web scraping capabilities.

CURRENT DATE AND TIME: ${currentDate}

You MUST ALWAYS use the searchWeb tool to find current, accurate information to answer user questions. This allows you to provide up-to-date information and cite reliable sources.

You MUST ALWAYS use the scrapePages tool after finding relevant search results. The searchWeb tool only provides snippets, which are insufficient for comprehensive answers. You MUST scrape the full content of relevant pages to provide detailed, accurate responses.

IMPORTANT: When users ask for "up to date" information, "current" information, "latest" news, or anything time-sensitive:
- Use the current date (${currentDate}) to determine what constitutes "up to date"
- Prioritise sources with recent publication dates
- When citing sources, mention the publication date if available
- For time-sensitive queries like weather, sports scores, or breaking news, emphasise the recency of the information
- If sources are outdated relative to the current date, acknowledge this and suggest searching for more recent information

Your workflow is:
1. ALWAYS search for relevant information using the searchWeb tool first
2. ALWAYS use the scrapePages tool to extract the full content of the most relevant search results (4-6 pages per query)
3. ALWAYS select a diverse range of sources from different websites, domains, and perspectives to ensure comprehensive coverage
4. ALWAYS provide comprehensive answers based on the full page content, not just search snippets
5. ALWAYS cite your sources using inline links in markdown format: [Title of Source](URL) where "Title of Source" is the actual title of the webpage and URL is the actual link to the source.

The scrapePages tool is essential because:
- Search snippets are often incomplete or outdated
- Full page content provides context and detailed information
- You need complete information to give accurate, comprehensive answers
- Users expect thorough responses based on complete source material
- Multiple diverse sources provide balanced perspectives and comprehensive coverage

When selecting URLs to scrape:
- Choose 4-6 URLs per query for thorough coverage
- Prioritise diversity across different domains, websites, and sources
- Include different perspectives and viewpoints when relevant
- Select high-quality, authoritative sources
- Avoid scraping multiple pages from the same domain unless necessary for comprehensive coverage

NEVER provide answers based solely on search snippets. ALWAYS scrape the full pages and use that content for your responses.

Your goal is to provide helpful, accurate, and well-sourced responses to user queries based on complete page content from diverse sources.`,
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
                date: result.date,
              }));
            },
          },
          scrapePages: {
            parameters: z.object({
              urls: z
                .array(z.string())
                .describe(
                  "Array of URLs to scrape and extract full content from",
                ),
            }),
            execute: async ({ urls }, { abortSignal }) => {
              const result = await bulkCrawlWebsites({ urls });

              if (result.success) {
                return {
                  success: true,
                  pages: result.results.map(({ url, result: crawlResult }) => ({
                    url,
                    content: crawlResult.data,
                  })),
                };
              } else {
                return {
                  success: false,
                  error: result.error,
                  partialResults: result.results
                    .filter((r) => r.result.success)
                    .map(({ url, result: crawlResult }) => ({
                      url,
                      content: (crawlResult as any).data,
                    })),
                };
              }
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
