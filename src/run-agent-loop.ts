import { getNextAction } from "~/deep-search";
import { env } from "~/env";
import { bulkCrawlWebsites } from "~/scraper";
import { searchSerper } from "~/serper";
import { SystemContext } from "~/system-context";

import { answerQuestion } from "./answer-question";

// Copied and adapted from deep-search.ts searchWeb tool
export const searchWeb = async (query: string): Promise<any> => {
  const results = await searchSerper(
    { q: query, num: env.SEARCH_RESULTS_COUNT },
    undefined, // abortSignal
  );

  return results.organic.map((result) => ({
    title: result.title,
    link: result.link,
    snippet: result.snippet,
    date: result.date,
  }));
};

// Copied and adapted from deep-search.ts scrapePages tool
export const scrapeUrl = async (urls: string[]): Promise<any> => {
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
};

// Main agent loop implementation
export const runAgentLoop = async (
  initialQuestion: string,
): Promise<string> => {
  // A persistent container for the state of our system
  const ctx = new SystemContext(initialQuestion);

  // A loop that continues until we have an answer
  // or we've taken 10 actions
  while (!ctx.shouldStop()) {
    // We choose the next action based on the state of our system
    const nextAction = await getNextAction(ctx);

    // We execute the action and update the state of our system
    if (nextAction.type === "search" && nextAction.query) {
      const result = await searchWeb(nextAction.query);
      ctx.reportQueries([
        {
          query: nextAction.query,
          results: result.map((r: any) => ({
            date: r.date,
            title: r.title,
            url: r.link,
            snippet: r.snippet,
          })),
        },
      ]);
    } else if (nextAction.type === "scrape" && nextAction.urls) {
      const result = await scrapeUrl(nextAction.urls);
      if (result.success) {
        ctx.reportScrapes(
          result.pages.map((page: any) => ({
            url: page.url,
            result: page.content,
          })),
        );
      } else if (result.partialResults) {
        ctx.reportScrapes(
          result.partialResults.map((page: any) => ({
            url: page.url,
            result: page.content,
          })),
        );
      }
    } else if (nextAction.type === "answer") {
      return answerQuestion(ctx, { isFinal: false });
    }

    // We increment the step counter
    ctx.incrementStep();
  }

  // If we've taken 10 actions and still don't have an answer,
  // we ask the LLM to give its best attempt at an answer
  return answerQuestion(ctx, { isFinal: true });
};
