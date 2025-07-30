import { smoothStream, streamText, type StreamTextResult } from "ai";
import { model } from "~/models";
import type { SystemContext } from "~/system-context";
import { markdownJoinerTransform } from "~/markdown-transform";

export const answerQuestion = (
  context: SystemContext,
  options: {
    isFinal: boolean;
    langfuseTraceId?: string;
    onFinish: Parameters<typeof streamText>[0]["onFinish"];
  },
): StreamTextResult<Record<string, never>, string> => {
  console.log("📝 answerQuestion called, isFinal:", options.isFinal);

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

  const systemPrompt = `You are a helpful AI assistant that provides comprehensive, well-sourced answers based on web search and scraping results.`;
  const prompt = `
CURRENT DATE AND TIME: ${currentDate}

Your task is to synthesise the search results and summarised content to provide a helpful, accurate answer to the user's question.

Guidelines:
- Provide accurate information based on the summarised content
- Cite your sources using inline links in markdown format: [Title of Source](URL)
- When citing sources, mention publication dates if available
- For time-sensitive information, emphasise the recency and current relevance
- If information appears outdated, acknowledge this limitation
- Structure your response clearly with appropriate headings and formatting
- Include multiple perspectives when available from different sources

${
  options.isFinal
    ? "IMPORTANT: This is your final attempt to answer. You may not have all the information you need, but you must provide the best possible answer based on the available data. If information is incomplete or missing, acknowledge this limitation while still providing a useful response."
    : "Based on the search results and summarised content provided, give a comprehensive answer to the user's question."
}

${context.getUserLocationContext()}

Message history:
${context.getMessageHistory()}

Search results and summaries:

${context.getSearchHistory()}

Please provide your answer now:`;

  console.log("🎨 Starting streamText for answer generation");

  return streamText({
    model,
    system: systemPrompt,
    prompt: prompt,
    onFinish: options.onFinish,
    experimental_transform: [
      markdownJoinerTransform(),
      smoothStream({
        delayInMs: 20,
        chunking: "line",
      }),
    ],
    experimental_telemetry: options.langfuseTraceId
      ? {
          isEnabled: true,
          functionId: options.isFinal
            ? "deep-search-final-answer"
            : "deep-search-answer",
          metadata: {
            langfuseTraceId: options.langfuseTraceId,
            langfuseUpdateParent: true,
          },
        }
      : { isEnabled: false },
  });
};
