import type { Message } from "ai";

type SearchResult = {
  date: string;
  title: string;
  url: string;
  snippet: string;
  summary: string;
};

type SearchHistoryEntry = {
  query: string;
  results: SearchResult[];
};

type TokenUsageEntry = {
  source: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

export class SystemContext {
  /**
   * The current step in the loop
   */
  public step = 0;

  /**
   * The history of all searches performed, including scraped content
   */
  private searchHistory: SearchHistoryEntry[] = [];

  /**
   * The history of all token usage for this request
   */
  private tokenUsageHistory: TokenUsageEntry[] = [];

  /**
   * The full message array including all messages
   */
  private messages: Message[];

  /**
   * The user's location information
   */
  private userLocation?: {
    longitude?: string;
    latitude?: string;
    city?: string;
    country?: string;
  };

  /**
   * The most recent feedback from the decision evaluator
   */
  private mostRecentFeedback?: string;

  constructor(
    messages: Message[],
    userLocation?: {
      longitude?: string;
      latitude?: string;
      city?: string;
      country?: string;
    },
  ) {
    this.messages = messages;
    this.userLocation = userLocation;
  }

  shouldStop() {
    return this.step >= 2;
  }

  incrementStep() {
    this.step++;
  }

  reportSearch(search: SearchHistoryEntry) {
    this.searchHistory.push(search);
  }

  reportUsage(
    source: string,
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    },
  ) {
    this.tokenUsageHistory.push({ source, usage });
  }

  updateFeedback(feedback: string) {
    this.mostRecentFeedback = feedback;
  }

  getMostRecentFeedback(): string {
    return this.mostRecentFeedback ?? "";
  }

  getSearchHistory(): string {
    return this.searchHistory
      .map((search) =>
        [
          `## Query: "${search.query}"`,
          ...search.results.map((result) =>
            [
              `### ${result.date} - ${result.title}`,
              result.url,
              result.snippet,
              `<summary>`,
              result.summary,
              `</summary>`,
            ].join("\n\n"),
          ),
        ].join("\n\n"),
      )
      .join("\n\n");
  }

  getMessageHistory(): string {
    // Build message history from all messages
    return this.messages
      .map((message) => {
        let content = "";
        if (typeof message.content === "string") {
          content = message.content;
        } else if (message.content && Array.isArray(message.content)) {
          content = (message.content as any[])
            .map((part: any) =>
              typeof part === "string"
                ? part
                : part.type === "text"
                  ? part.text
                  : "",
            )
            .join("");
        }
        return `${message.role.toUpperCase()}: ${content}`;
      })
      .join("\n\n");
  }

  getUserLocationContext(): string {
    if (!this.userLocation) {
      return "";
    }

    const { latitude, longitude, city, country } = this.userLocation;

    if (!latitude || !longitude || !city || !country) {
      return "";
    }

    return `About the origin of user's request:
- lat: ${latitude}
- lon: ${longitude}
- city: ${city}
- country: ${country}`;
  }

  getTotalTokenUsage(): number {
    return this.tokenUsageHistory.reduce(
      (total, entry) => total + entry.usage.totalTokens,
      0,
    );
  }
}
