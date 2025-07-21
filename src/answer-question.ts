import { generateText } from "ai";
import { model } from "~/models";
import { SystemContext } from "~/system-context";

export const answerQuestion = async (
  context: SystemContext,
  options: { isFinal: boolean },
): Promise<string> => {
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

Your task is to synthesise the search results and scraped content to provide a helpful, accurate answer to the user's question.

Guidelines:
- Provide accurate information based on the scraped content
- Cite your sources using inline links in markdown format: [Title of Source](URL)
- When citing sources, mention publication dates if available
- For time-sensitive information, emphasise the recency and current relevance
- If information appears outdated, acknowledge this limitation
- Structure your response clearly with appropriate headings and formatting
- Include multiple perspectives when available from different sources

${
  options.isFinal
    ? "IMPORTANT: This is your final attempt to answer. You may not have all the information you need, but you must provide the best possible answer based on the available data. If information is incomplete or missing, acknowledge this limitation while still providing a useful response."
    : "Based on the search and scraping results provided, give a comprehensive answer to the user's question."
}

User question:
${context.getInitialQuestion()}

Search and scraping results:

${context.getQueryHistory()}

${context.getScrapeHistory()}

Please provide your answer now:`;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: prompt,
  });

  return result.text;
};
