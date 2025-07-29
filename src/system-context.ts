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
    return this.step >= 10;
  }

  incrementStep() {
    this.step++;
  }

  reportSearch(search: SearchHistoryEntry) {
    this.searchHistory.push(search);
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
}
