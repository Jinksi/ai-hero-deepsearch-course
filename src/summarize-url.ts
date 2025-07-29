import { generateText } from "ai";
import { summaryModel } from "~/models";
import { cacheWithRedis } from "~/server/redis/redis";

interface SummarizeUrlInput {
  query: string;
  url: string;
  title: string;
  snippet: string;
  date: string;
  scrapedContent: string;
  conversationHistory: string;
  langfuseTraceId?: string;
}

interface SummarizeUrlResult {
  url: string;
  title: string;
  date: string;
  snippet: string;
  summary: string;
}

const summarizeUrlInternal = async (
  input: SummarizeUrlInput,
): Promise<SummarizeUrlResult> => {
  const prompt = `You are a research extraction specialist. Given a research topic and raw web content, create a thoroughly detailed synthesis as a cohesive narrative that flows naturally between key concepts.

Extract the most valuable information related to the research topic, including relevant facts, statistics, methodologies, claims, and contextual information. Preserve technical terminology and domain-specific language from the source material.

Structure your synthesis as a coherent document with natural transitions between ideas. Begin with an introduction that captures the core thesis and purpose of the source material. Develop the narrative by weaving together key findings and their supporting details, ensuring each concept flows logically to the next.

Integrate specific metrics, dates, and quantitative information within their proper context. Explore how concepts interconnect within the source material, highlighting meaningful relationships between ideas. Acknowledge limitations by noting where information related to aspects of the research topic may be missing or incomplete.

Important guidelines:
- Maintain original data context (e.g., "2024 study of 150 patients" rather than generic "recent study")
- Preserve the integrity of information by keeping details anchored to their original context
- Create a cohesive narrative rather than disconnected bullet points or lists
- Use paragraph breaks only when transitioning between major themes

Critical Reminder: If content lacks a specific aspect of the research topic, clearly state that in the synthesis, and you should NEVER make up information and NEVER rely on external knowledge.

RESEARCH TOPIC/QUERY: ${input.query}

CONVERSATION CONTEXT:
${input.conversationHistory}

SOURCE METADATA:
- URL: ${input.url}
- Title: ${input.title}
- Date: ${input.date}
- Snippet: ${input.snippet}

RAW WEB CONTENT:
${input.scrapedContent}

Please provide your detailed synthesis:`;

  const result = await generateText({
    model: summaryModel,
    prompt,
    experimental_telemetry: input.langfuseTraceId
      ? {
          isEnabled: true,
          functionId: "deep-search-summarize-url",
          metadata: {
            langfuseTraceId: input.langfuseTraceId,
            langfuseUpdateParent: true,
            url: input.url,
          },
        }
      : { isEnabled: false },
  });

  return {
    url: input.url,
    title: input.title,
    date: input.date,
    snippet: input.snippet,
    summary: result.text,
  };
};

// Cache the summarization function with Redis
export const summarizeURL = cacheWithRedis(
  "summarize-url",
  summarizeUrlInternal,
);

// Function to summarize multiple URLs in parallel
export const summarizeURLs = async (
  inputs: SummarizeUrlInput[],
  langfuseTraceId?: string,
): Promise<SummarizeUrlResult[]> => {
  console.log(`📝 Starting summarization of ${inputs.length} URLs`);

  const startTime = Date.now();

  try {
    // Process all URLs in parallel
    const summaries = await Promise.all(
      inputs.map(async (input) => {
        try {
          console.log(`🔍 Summarizing: ${input.title}`);
          return await summarizeURL({
            ...input,
            langfuseTraceId,
          });
        } catch (error) {
          console.error(`❌ Failed to summarize ${input.url}:`, error);
          // Return a fallback summary on error
          return {
            url: input.url,
            title: input.title,
            date: input.date,
            snippet: input.snippet,
            summary: `Failed to generate summary for this source. Original content preview: ${input.scrapedContent.slice(0, 500)}...`,
          };
        }
      }),
    );

    const endTime = Date.now();
    console.log(
      `✅ Completed summarization of ${inputs.length} URLs in ${endTime - startTime}ms`,
    );

    return summaries;
  } catch (error) {
    console.error("❌ Error in summarizeURLs:", error);
    throw error;
  }
};
