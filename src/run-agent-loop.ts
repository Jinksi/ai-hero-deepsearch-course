import type { StreamTextResult, Message, streamText } from "ai";
import {
  getNextAction,
  type OurMessageAnnotation,
  type Action,
} from "~/deep-search";
import { env } from "~/env";
import { bulkCrawlWebsites } from "~/scraper";
import { searchSerper } from "~/serper";
import { summarizeURLs } from "~/summarize-url";
import { SystemContext } from "~/system-context";

import { answerQuestion } from "./answer-question";

// Types for scrape results (used internally by searchAndScrape)
interface ScrapePageResult {
  url: string;
  content: string;
}

interface ScrapeSuccessResult {
  success: true;
  pages: ScrapePageResult[];
}

interface ScrapeErrorResult {
  success: false;
  error: string;
  partialResults: ScrapePageResult[];
}

type ScrapeResult = ScrapeSuccessResult | ScrapeErrorResult;

// Combined search and scrape functionality
export const searchAndScrape = async (
  query: string,
  conversationHistory: string,
  langfuseTraceId?: string,
): Promise<{
  query: string;
  results: {
    date: string;
    title: string;
    url: string;
    snippet: string;
    summary: string;
  }[];
}> => {
  // First, search for results
  const searchResults = await searchSerper(
    { q: query, num: env.SEARCH_RESULTS_COUNT },
    undefined, // abortSignal
  );

  const searchResultsFormatted = searchResults.organic.map((result) => ({
    title: result.title,
    link: result.link,
    snippet: result.snippet,
    date: result.date ?? "Unknown date",
  }));

  // Then, scrape the URLs from the search results
  const urls = searchResultsFormatted.map((result) => result.link);
  const scrapeResult = await scrapeUrl(urls);

  // Combine search results with scraped content
  const combinedResults = searchResultsFormatted.map((searchResult) => {
    const scrapedPage = scrapeResult.success
      ? scrapeResult.pages.find((page) => page.url === searchResult.link)
      : scrapeResult.partialResults?.find(
          (page) => page.url === searchResult.link,
        );

    return {
      date: searchResult.date,
      title: searchResult.title,
      url: searchResult.link,
      snippet: searchResult.snippet,
      scrapedContent: scrapedPage?.content ?? "Failed to scrape content",
    };
  });

  // Prepare inputs for summarization
  const summarizationInputs = combinedResults.map((result) => ({
    query,
    url: result.url,
    title: result.title,
    snippet: result.snippet,
    date: result.date,
    scrapedContent: result.scrapedContent,
    conversationHistory,
    langfuseTraceId,
  }));

  // Summarize all URLs in parallel
  console.log(
    `📝 Starting parallel summarization of ${summarizationInputs.length} URLs`,
  );
  const summaries = await summarizeURLs(summarizationInputs, langfuseTraceId);

  // Map summaries back to results format
  const finalResults = summaries.map((summary) => ({
    date: summary.date,
    title: summary.title,
    url: summary.url,
    snippet: summary.snippet,
    summary: summary.summary,
  }));

  return {
    query,
    results: finalResults,
  };
};

// Internal scrape functionality used by searchAndScrape
const scrapeUrl = async (urls: string[]): Promise<ScrapeResult> => {
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
export const runAgentLoop = async (opts: {
  messages: Message[];
  userLocation?: {
    longitude?: string;
    latitude?: string;
    city?: string;
    country?: string;
  };
  writeMessageAnnotation: (annotation: OurMessageAnnotation) => void;
  langfuseTraceId?: string;
  onFinish: Parameters<typeof streamText>[0]["onFinish"];
}): Promise<StreamTextResult<Record<string, never>, string>> => {
  console.log("🚀 Starting agent loop for messages:", opts.messages.length);

  // A persistent container for the state of our system
  const ctx = new SystemContext(opts.messages, opts.userLocation);

  // A loop that continues until we have an answer
  // or we've taken 10 actions
  while (!ctx.shouldStop()) {
    console.log(`🔄 Agent loop step ${ctx.step + 1}/10`);

    // We choose the next action based on the state of our system
    const nextAction = await getNextAction({
      context: ctx,
      langfuseTraceId: opts.langfuseTraceId,
    });
    console.log("🎯 Next action chosen:", nextAction);

    // Send progress annotation to the UI
    opts.writeMessageAnnotation({
      type: "NEW_ACTION",
      action: nextAction as Action,
    });

    // We execute the action and update the state of our system
    if (nextAction.type === "search" && nextAction.query) {
      console.log(
        "🔍 Executing combined search and scrape for:",
        nextAction.query,
      );
      const result = await searchAndScrape(
        nextAction.query,
        ctx.getMessageHistory(),
        opts.langfuseTraceId,
      );
      console.log(
        `📊 Search and scrape returned ${result.results.length} results`,
      );
      ctx.reportSearch(result);
    } else if (nextAction.type === "answer") {
      console.log("💬 Executing answer generation");
      return answerQuestion(ctx, {
        isFinal: false,
        langfuseTraceId: opts.langfuseTraceId,
        onFinish: opts.onFinish,
      });
    }

    // We increment the step counter
    ctx.incrementStep();
  }

  // If we've taken 10 actions and still don't have an answer,
  // we ask the LLM to give its best attempt at an answer
  console.log("⏰ Reached maximum steps (10), generating final answer");
  return answerQuestion(ctx, {
    isFinal: true,
    langfuseTraceId: opts.langfuseTraceId,
    onFinish: opts.onFinish,
  });
};
