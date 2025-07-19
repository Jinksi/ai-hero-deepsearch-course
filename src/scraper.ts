import { env } from "~/env";
import { cacheWithRedis } from "~/server/redis/redis";

export const DEFAULT_MAX_RETRIES = 3;
const MIN_DELAY_MS = 500; // 0.5 seconds
const MAX_DELAY_MS = 8000; // 8 seconds

export interface CrawlSuccessResponse {
  success: true;
  data: string;
}

export interface CrawlErrorResponse {
  success: false;
  error: string;
}

export type CrawlResponse = CrawlSuccessResponse | CrawlErrorResponse;

export interface BulkCrawlSuccessResponse {
  success: true;
  results: {
    url: string;
    result: CrawlSuccessResponse;
  }[];
}

export interface BulkCrawlFailureResponse {
  success: false;
  results: {
    url: string;
    result: CrawlResponse;
  }[];
  error: string;
}

export type BulkCrawlResponse =
  | BulkCrawlSuccessResponse
  | BulkCrawlFailureResponse;

export interface CrawlOptions {
  maxRetries?: number;
}

export interface BulkCrawlOptions extends CrawlOptions {
  urls: string[];
}

export const bulkCrawlWebsites = async (
  options: BulkCrawlOptions,
): Promise<BulkCrawlResponse> => {
  const { urls, maxRetries = DEFAULT_MAX_RETRIES } = options;

  const results = await Promise.all(
    urls.map(async (url) => ({
      url,
      result: await crawlWebsite({ url, maxRetries }),
    })),
  );

  const allSuccessful = results.every((r) => r.result.success);

  if (!allSuccessful) {
    const errors = results
      .filter((r) => !r.result.success)
      .map((r) => `${r.url}: ${(r.result as CrawlErrorResponse).error}`)
      .join("\n");

    return {
      results,
      success: false,
      error: `Failed to crawl some websites:\n${errors}`,
    };
  }

  return {
    results,
    success: true,
  } as BulkCrawlResponse;
};

export const crawlWebsite = cacheWithRedis(
  "crawlWebsite",
  async (options: CrawlOptions & { url: string }): Promise<CrawlResponse> => {
    const { url, maxRetries = DEFAULT_MAX_RETRIES } = options;

    let attempts = 0;

    while (attempts < maxRetries) {
      try {
        const jinaUrl = `https://r.jina.ai/${url}`;
        const response = await fetch(jinaUrl, {
          headers: {
            Authorization: `Bearer ${env.JINA_API_KEY}`,
          },
        });

        if (response.ok) {
          const text = await response.text();
          return {
            success: true,
            data: text,
          };
        }

        attempts++;
        if (attempts === maxRetries) {
          return {
            success: false,
            error: `Failed to fetch website after ${maxRetries} attempts: ${response.status} ${response.statusText}`,
          };
        }

        // Exponential backoff: 0.5s, 1s, 2s, 4s, 8s max
        const delay = Math.min(
          MIN_DELAY_MS * Math.pow(2, attempts),
          MAX_DELAY_MS,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        attempts++;
        if (attempts === maxRetries) {
          return {
            success: false,
            error: `Network error after ${maxRetries} attempts: ${error instanceof Error ? error.message : "Unknown error"}`,
          };
        }
        const delay = Math.min(
          MIN_DELAY_MS * Math.pow(2, attempts),
          MAX_DELAY_MS,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return {
      success: false,
      error: "Maximum retry attempts reached",
    };
  },
);
