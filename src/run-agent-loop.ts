import type { StreamTextResult, Message, streamText } from "ai";
import {
  queryRewriter,
  getDecision,
  type OurMessageAnnotation,
  type PlanAction,
  type DecisionAction,
  type SourcesAction,
  type SearchAction,
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
    favicon: string;
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
    favicon: `https://www.google.com/s2/favicons?domain=${new URL(result.link).hostname}`,
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
      favicon: searchResult.favicon,
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
    favicon: `https://www.google.com/s2/favicons?domain=${new URL(summary.url).hostname}`,
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

    // Step 1: Generate research plan and queries
    const planResult = await queryRewriter({
      context: ctx,
      langfuseTraceId: opts.langfuseTraceId,
    });
    console.log("📋 Plan generated:", planResult.plan);
    console.log("🔍 Queries generated:", planResult.queries);

    // Send plan annotation to the UI
    const planAction: PlanAction = {
      type: "plan",
      title: "Planning research approach",
      plan: planResult.plan,
      queries: planResult.queries,
    };
    opts.writeMessageAnnotation({
      type: "NEW_ACTION",
      action: planAction,
    });

    // Step 2: Execute all queries in parallel
    console.log(
      `🚀 Executing ${planResult.queries.length} queries in parallel`,
    );
    const searchPromises = planResult.queries.map(async (query) => {
      console.log("🔍 Executing search for:", query);
      const searchAction: SearchAction = {
        type: "search",
        title: `Searching for "${query}"`,
        reasoning: `Searching for "${query}"`,
        query,
      };
      opts.writeMessageAnnotation({
        type: "NEW_ACTION",
        action: searchAction,
      });
      const result = await searchAndScrape(
        query,
        ctx.getMessageHistory(),
        opts.langfuseTraceId,
      );
      console.log(
        `📊 Search for "${query}" returned ${result.results.length} results`,
      );
      return result;
    });

    const searchResults = await Promise.allSettled(searchPromises);

    // Process successful results and log failures
    const successfulResults = searchResults
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof searchAndScrape>>
        > => result.status === "fulfilled",
      )
      .map((result) => result.value);

    const failedResults = searchResults
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result, index) => ({
        query: planResult.queries[index],
        error: result.reason,
      }));

    // Log any failures for debugging
    if (failedResults.length > 0) {
      console.warn(`⚠️ ${failedResults.length} queries failed:`, failedResults);
    }

    console.log(
      `✅ ${successfulResults.length}/${planResult.queries.length} queries completed successfully`,
    );

    // Report successful search results to context
    successfulResults.forEach((result) => {
      ctx.reportSearch(result);
    });

    // Collect all sources from search results and write sources annotation
    if (successfulResults.length > 0) {
      const allSources = successfulResults.flatMap((result) =>
        result.results.map((searchResult) => ({
          title: searchResult.title,
          url: searchResult.url,
          snippet: searchResult.snippet,
          date: searchResult.date,
          favicon: searchResult.favicon,
        })),
      );

      // Remove duplicates based on URL
      const uniqueSources = allSources.filter(
        (source, index, self) =>
          index === self.findIndex((s) => s.url === source.url),
      );

      // Send sources annotation to the UI
      const sourcesAction: SourcesAction = {
        type: "sources",
        title: `Found ${uniqueSources.length} sources`,
        sources: uniqueSources,
      };
      opts.writeMessageAnnotation({
        type: "NEW_ACTION",
        action: sourcesAction,
      });
    }

    // Step 3: Decide whether to continue or answer
    const decision = await getDecision({
      context: ctx,
      langfuseTraceId: opts.langfuseTraceId,
    });
    console.log(
      "🤔 Decision made:",
      decision.decision,
      "- Reasoning:",
      decision.reasoning,
    );

    // Store the feedback in context for next iteration
    ctx.updateFeedback(decision.feedback);

    // Send decision annotation to the UI
    const decisionAction: DecisionAction = {
      type: "decision",
      title:
        decision.decision === "continue"
          ? "Need more information"
          : "Ready to answer",
      reasoning: decision.reasoning,
      decision: decision.decision,
      feedback: decision.feedback,
    };
    opts.writeMessageAnnotation({
      type: "NEW_ACTION",
      action: decisionAction,
    });

    // Step 4: Act on the decision
    if (decision.decision === "answer") {
      console.log("💬 Executing answer generation");
      return answerQuestion(ctx, {
        isFinal: false,
        langfuseTraceId: opts.langfuseTraceId,
        onFinish: opts.onFinish,
      });
    }

    // If decision is "continue", increment step and continue loop
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
