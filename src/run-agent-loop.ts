import type { StreamTextResult } from "ai";
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
): Promise<StreamTextResult<{}, string>> => {
  console.log("🚀 Starting agent loop for question:", initialQuestion);

  // A persistent container for the state of our system
  const ctx = new SystemContext(initialQuestion);

  // A loop that continues until we have an answer
  // or we've taken 10 actions
  while (!ctx.shouldStop()) {
    console.log(`🔄 Agent loop step ${ctx.step + 1}/10`);

    // We choose the next action based on the state of our system
    const nextAction = await getNextAction(ctx);
    console.log("🎯 Next action chosen:", nextAction);

    // We execute the action and update the state of our system
    if (nextAction.type === "search" && nextAction.query) {
      console.log("🔍 Executing search for:", nextAction.query);
      const result = await searchWeb(nextAction.query);
      console.log(`📊 Search returned ${result.length} results`);
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
      console.log("🕷️ Executing scrape for URLs:", nextAction.urls);
      const result = await scrapeUrl(nextAction.urls);
      if (result.success) {
        console.log(`✅ Scrape successful for ${result.pages.length} pages`);
        ctx.reportScrapes(
          result.pages.map((page: any) => ({
            url: page.url,
            result: page.content,
          })),
        );
      } else if (result.partialResults) {
        console.log(
          `⚠️ Scrape partially successful for ${result.partialResults.length} pages`,
        );
        ctx.reportScrapes(
          result.partialResults.map((page: any) => ({
            url: page.url,
            result: page.content,
          })),
        );
      } else {
        console.log("❌ Scrape failed completely");
      }
    } else if (nextAction.type === "answer") {
      console.log("💬 Executing answer generation");
      return answerQuestion(ctx, { isFinal: false });
    }

    // We increment the step counter
    ctx.incrementStep();
  }

  // If we've taken 10 actions and still don't have an answer,
  // we ask the LLM to give its best attempt at an answer
  console.log("⏰ Reached maximum steps (10), generating final answer");
  return answerQuestion(ctx, { isFinal: true });
};
