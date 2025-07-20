import { streamText, type Message, type TelemetrySettings } from "ai";
import { z } from "zod";
import { model } from "~/models";
import { bulkCrawlWebsites } from "~/scraper";
import { searchSerper } from "~/serper";

export const streamFromDeepSearch = (opts: {
  messages: Message[];
  onFinish: Parameters<typeof streamText>[0]["onFinish"];
  telemetry: TelemetrySettings;
}) => {
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

  return streamText({
    model,
    messages: opts.messages,
    maxSteps: 10,
    experimental_telemetry: opts.telemetry,
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
            .describe("Array of URLs to scrape and extract full content from"),
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
    onFinish: opts.onFinish,
  });
};

export async function askDeepSearch(messages: Message[]) {
  const result = streamFromDeepSearch({
    messages,
    onFinish: () => {}, // just a stub
    telemetry: {
      isEnabled: false,
    },
  });

  // Consume the stream - without this,
  // the stream will never finish
  await result.consumeStream();

  return await result.text;
}
