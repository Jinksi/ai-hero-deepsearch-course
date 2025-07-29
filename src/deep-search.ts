import {
  generateObject,
  type Message,
  type StreamTextResult,
  type streamText,
} from "ai";
import { z } from "zod";
import { model } from "~/models";
import { runAgentLoop } from "~/run-agent-loop";
import type { SystemContext } from "~/system-context";
import { env } from "~/env";

// Action types for structured LLM outputs
export interface SearchAction {
  type: "search";
  title: string;
  reasoning: string;
  query: string;
}

export interface AnswerAction {
  type: "answer";
  title: string;
  reasoning: string;
}

export type Action = SearchAction | AnswerAction;

// Message annotation type for progress indicators
export type OurMessageAnnotation = {
  type: "NEW_ACTION";
  action: Action;
};

// Return type for getNextAction that includes optional fields
export interface ActionResult {
  type: "search" | "answer";
  title: string;
  reasoning: string;
  query?: string;
}

// Schema for structured outputs - using single object with conditional validation
export const actionSchema = z
  .object({
    title: z
      .string()
      .describe(
        "The title of the action, to be displayed in the UI. Be extremely concise. 'Searching Saka's injury history', 'Checking HMRC industrial action', 'Comparing toaster ovens'",
      ),
    reasoning: z.string().describe("The reason you chose this step."),
    type: z.enum(["search", "answer"]).describe(
      `The type of action to take.
      - 'search': Search the web for information and automatically scrape the most relevant results.
      - 'answer': Answer the user's question and complete the loop.`,
    ),
    query: z
      .string()
      .describe("The query to search for. Required if type is 'search'.")
      .optional(),
  })
  .refine(
    (data) => {
      if (data.type === "search" && !data.query) {
        return false;
      }
      return true;
    },
    {
      message: "query is required for search actions",
    },
  );

export async function streamFromDeepSearch(opts: {
  messages: Message[];
  userLocation?: {
    longitude?: string;
    latitude?: string;
    city?: string;
    country?: string;
  };
  onFinish: Parameters<typeof streamText>[0]["onFinish"];
  langfuseTraceId: string;
  writeMessageAnnotation?: (annotation: OurMessageAnnotation) => void;
}): Promise<StreamTextResult<Record<string, never>, string>> {
  console.log(
    "🌟 streamFromDeepSearch called with",
    opts.messages.length,
    "messages",
  );

  // Run the agent loop directly and return the streaming result
  console.log("🎬 Starting agent loop...");
  const result = await runAgentLoop({
    messages: opts.messages,
    userLocation: opts.userLocation,
    writeMessageAnnotation: opts.writeMessageAnnotation ?? (() => {}),
    langfuseTraceId: opts.langfuseTraceId,
    onFinish: opts.onFinish,
  });
  console.log("✨ Agent loop completed, returning streaming result");

  return result;
}

export async function askDeepSearch(messages: Message[]) {
  console.log("🔬 askDeepSearch called for evaluation");

  const result = await streamFromDeepSearch({
    messages,
    userLocation: undefined, // No location data for evaluations
    onFinish: () => {}, // just a stub
    langfuseTraceId: "test-session",
    writeMessageAnnotation: () => {}, // no-op for evaluations
  });

  console.log("📋 streamFromDeepSearch completed, consuming stream...");

  // Consume the stream - without this, the stream will never finish
  // We need to consume the stream to force it to completion and ensure
  // the text promise resolves properly
  try {
    await result.consumeStream({
      onError: (error) => {
        console.error("⚠️ Stream consumption error:", error);
        throw error; // Re-throw to handle properly
      },
    });
    console.log("🔄 Stream consumed successfully");
  } catch (error) {
    console.error("❌ Stream consumption failed:", error);
    // Re-throw the error instead of silently continuing
    // This ensures caller can handle stream failures appropriately
    throw new Error(
      `Stream consumption failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const text = await result.text;
  console.log("📄 Final text length:", text.length);

  return text;
}

export const getNextAction = async ({
  context,
  langfuseTraceId,
}: {
  context: SystemContext;
  langfuseTraceId?: string;
}): Promise<ActionResult> => {
  console.log("🧠 getNextAction called, step:", context.step);

  // Get current date and time for date-aware responses
  const currentDate = new Date().toLocaleString(env.DEFAULT_LOCALE, {
    timeZone: env.DEFAULT_TIMEZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const result = await generateObject({
    model,
    schema: actionSchema,
    system: `You are a helpful AI assistant with access to web search and web scraping capabilities.`,
    experimental_telemetry: langfuseTraceId
      ? {
          isEnabled: true,
          functionId: "deep-search-get-next-action",
          metadata: {
            langfuseTraceId: langfuseTraceId,
            langfuseUpdateParent: true,
          },
        }
      : { isEnabled: false },
    prompt: `
CURRENT DATE AND TIME: ${currentDate}

You MUST ALWAYS use the search action to find current, accurate information to answer user questions. The search action will automatically search the web and scrape the full content of the most relevant results, providing you with comprehensive information from diverse sources.

IMPORTANT: When users ask for "up to date" information, "current" information, "latest" news, or anything time-sensitive:
- Use the current date (${currentDate}) to determine what constitutes "up to date"
- Prioritise sources with recent publication dates
- When citing sources, mention the publication date if available
- For time-sensitive queries like weather, sports scores, or breaking news, emphasise the recency of the information
- If sources are outdated relative to the current date, acknowledge this and suggest searching for more recent information

Your workflow is:
1. ALWAYS search for relevant information first - this will automatically provide you with both search results and the full scraped content from the most relevant pages
2. ALWAYS provide comprehensive answers based on the full page content, not just search snippets

The search action automatically:
- Searches the web for information
- Selects the most relevant results from diverse sources and domains
- Scrapes the full content of these pages
- Provides you with both search snippets and complete page content

Your goal is to provide helpful, accurate, and well-sourced responses to user queries based on complete page content from diverse sources.

${context.getUserLocationContext()}

Message history:
${context.getMessageHistory()}

Here is what has been done so far:

${context.getSearchHistory()}

Choose the next action to take to help answer the user's question.`,
  });

  return result.object;
};
