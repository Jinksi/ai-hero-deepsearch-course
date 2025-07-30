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

// New types for query rewriting and planning
export interface PlanAction {
  type: "plan";
  title: string;
  plan: string;
  queries: string[];
}

export interface DecisionAction {
  type: "decision";
  title: string;
  reasoning: string;
  decision: "continue" | "answer";
  feedback: string;
}

export interface SourcesAction {
  type: "sources";
  title: string;
  sources: {
    title: string;
    url: string;
    snippet: string;
    favicon?: string;
    date?: string;
  }[];
}

// Extended action types
export type ExtendedAction =
  | Action
  | PlanAction
  | DecisionAction
  | SourcesAction;

// Message annotation type for progress indicators
export type OurMessageAnnotation = {
  type: "NEW_ACTION";
  action: ExtendedAction;
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

// Schema for query rewriter - generates multiple queries and a plan
export const queryRewriterSchema = z.object({
  plan: z
    .string()
    .describe(
      "A detailed research plan explaining what information needs to be gathered and why. This should outline the logical progression of research needed.",
    ),
  queries: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe(
      "A list of 1-5 specific search queries that will help answer the user's question. Queries should be specific, focused, and written in natural language. They should progress logically from foundational to specific information.",
    ),
});

// Schema for decision maker - decides whether to continue or answer with detailed feedback
export const decisionSchema = z.object({
  decision: z
    .enum(["continue", "answer"])
    .describe(
      "Whether to continue searching for more information or answer the question with current information.",
    ),
  reasoning: z
    .string()
    .describe(
      "The reason for this decision. Explain what information is still needed or why we're ready to answer.",
    ),
  feedback: z
    .string()
    .describe(
      "Detailed feedback about the current research state. Identify information gaps, quality issues, or what specific information still needs to be found. This feedback will guide the next search queries.",
    ),
});

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

export const queryRewriter = async ({
  context,
  langfuseTraceId,
}: {
  context: SystemContext;
  langfuseTraceId?: string;
}): Promise<{ plan: string; queries: string[] }> => {
  console.log("📋 queryRewriter called, step:", context.step);

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
    schema: queryRewriterSchema,
    system: `You are a strategic research planner with expertise in breaking down complex questions into logical search steps. Your primary role is to create a detailed research plan before generating any search queries.`,
    experimental_telemetry: langfuseTraceId
      ? {
          isEnabled: true,
          functionId: "deep-search-query-rewriter",
          metadata: {
            langfuseTraceId: langfuseTraceId,
            langfuseUpdateParent: true,
          },
        }
      : { isEnabled: false },
    prompt: `
CURRENT DATE AND TIME: ${currentDate}

You are a strategic research planner with expertise in breaking down complex questions into logical search steps. Your primary role is to create a detailed research plan before generating any search queries.

First, analyze the question thoroughly:
- Break down the core components and key concepts
- Identify any implicit assumptions or context needed
- Consider what foundational knowledge might be required
- Think about potential information gaps that need filling

Then, develop a strategic research plan that:
- Outlines the logical progression of information needed
- Identifies dependencies between different pieces of information
- Considers multiple angles or perspectives that might be relevant
- Anticipates potential dead-ends or areas needing clarification

Finally, translate this plan into a numbered list of 3-5 sequential search queries that:

- Are specific and focused (avoid broad queries that return general information)
- Are written in natural language without Boolean operators (no AND/OR)
- Progress logically from foundational to specific information
- Build upon each other in a meaningful way

Remember that initial queries can be exploratory - they help establish baseline information or verify assumptions before proceeding to more targeted searches. Each query should serve a specific purpose in your overall research plan.

IMPORTANT: When users ask for "up to date" information, "current" information, "latest" news, or anything time-sensitive:
- Use the current date (${currentDate}) to determine what constitutes "up to date"
- Prioritise sources with recent publication dates
- For time-sensitive queries like weather, sports scores, or breaking news, emphasise the recency of the information

${context.getUserLocationContext()}

Message history:
${context.getMessageHistory()}

Here is what has been done so far:

${context.getSearchHistory()}

${
  context.getMostRecentFeedback()
    ? `
Previous evaluator feedback:
${context.getMostRecentFeedback()}

Use this feedback to guide your research planning. Focus on the specific information gaps and quality issues identified above.
`
    : ""
}

Create a research plan and generate search queries to help answer the user's question.`,
  });

  return result.object;
};

export const getDecision = async ({
  context,
  langfuseTraceId,
}: {
  context: SystemContext;
  langfuseTraceId?: string;
}): Promise<{
  decision: "continue" | "answer";
  reasoning: string;
  feedback: string;
}> => {
  console.log("🤔 getDecision called, step:", context.step);

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
    schema: decisionSchema,
    system: `You are a research query optimiser. Your task is to analyse search results against the original research goal and either decide to answer the question or to search for more information.`,
    experimental_telemetry: langfuseTraceId
      ? {
          isEnabled: true,
          functionId: "deep-search-get-decision",
          metadata: {
            langfuseTraceId: langfuseTraceId,
            langfuseUpdateParent: true,
          },
        }
      : { isEnabled: false },
    prompt: `
CURRENT DATE AND TIME: ${currentDate}

PROCESS:
1. Identify ALL information explicitly requested in the original research goal
2. Analyse what specific information has been successfully retrieved in the search results
3. Identify ALL information gaps between what was requested and what was found
4. For entity-specific gaps: Create targeted queries for each missing attribute of identified entities
5. For general knowledge gaps: Create focused queries to find the missing conceptual information

Your task is to determine whether we have enough information to provide a comprehensive answer to the user's question, or if we need to continue searching for more information.

Consider the following when making your decision:

For CONTINUE decision:
- Key information is still missing or unclear from the original request
- The search results don't fully address all aspects of the user's question
- There are contradictory pieces of information that need clarification
- More recent or authoritative sources might be needed for accuracy
- The question has multiple components that haven't been fully explored
- Entity-specific attributes are missing (dates, numbers, names, relationships)
- Conceptual gaps exist that prevent a complete understanding

For ANSWER decision:
- We have sufficient information from diverse, credible sources
- The search results comprehensively address ALL parts of the user's question
- All key aspects and entities mentioned in the question have been explored
- The information is current and relevant to the user's needs
- Any contradictions have been resolved or can be acknowledged
- We have specific details needed to provide actionable insights

Remember: It's better to search once more if you're uncertain about completeness, but don't search unnecessarily if we already have comprehensive information covering all aspects of the original question.

When providing feedback, be specific about:
- What information is still missing
- What quality issues exist with current results
- Which aspects of the original question remain unaddressed
- What specific searches would help fill these gaps

${context.getUserLocationContext()}

Message history:
${context.getMessageHistory()}

Here is what has been done so far:

${context.getSearchHistory()}

Based on the information gathered so far, decide whether to continue searching or answer the question, and provide detailed feedback about the current research state.`,
  });

  return result.object;
};
