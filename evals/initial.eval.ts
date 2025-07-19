import type { Message } from "ai";
import { generateObject } from "ai";
import { evalite } from "evalite";
import { createScorer } from "evalite";
import { z } from "zod";
import { globalRateLimitConfig } from "~/config/rate-limit";
import { askDeepSearch } from "~/deep-search";
import { factualityModel } from "~/models";
import { checkRateLimit, recordRateLimit } from "~/server/redis/rate-limit";

export const checkFactuality = async (opts: {
  question: string;
  groundTruth: string;
  submission: string;
}) => {
  // Check global rate limit before proceeding
  const rateLimitCheck = await checkRateLimit(globalRateLimitConfig);

  if (!rateLimitCheck.allowed) {
    console.log("Rate limit exceeded in checkFactuality, waiting for reset...");
    const isAllowed = await rateLimitCheck.retry();

    // If still not allowed after retries, throw an error
    if (!isAllowed) {
      throw new Error(
        `Global rate limit exceeded. Please wait ${Math.ceil((rateLimitCheck.resetTime - Date.now()) / 1000)} seconds before trying again.`,
      );
    }
  }

  // Record the rate limit usage
  await recordRateLimit(globalRateLimitConfig);

  const { object } = await generateObject({
    model: factualityModel,
    /**
     * Prompt taken from autoevals:
     *
     * {@link https://github.com/braintrustdata/autoevals/blob/5aa20a0a9eb8fc9e07e9e5722ebf71c68d082f32/templates/factuality.yaml}
     */
    prompt: `
      You are comparing a submitted answer to an expert answer on a given question. Here is the data:
      [BEGIN DATA]
      ************
      [Question]: ${opts.question}
      ************
      [Expert]: ${opts.groundTruth}
      ************
      [Submission]: ${opts.submission}
      ************
      [END DATA]

      Compare the factual content of the submitted answer with the expert answer. Ignore any differences in style, grammar, or punctuation.
      The submitted answer may either be a subset or superset of the expert answer, or it may conflict with it. Determine which case applies. Answer the question by selecting one of the following options:
      (A) The submitted answer is a subset of the expert answer and is fully consistent with it.
      (B) The submitted answer is a superset of the expert answer and is fully consistent with it.
      (C) The submitted answer contains all the same details as the expert answer.
      (D) There is a disagreement between the submitted answer and the expert answer.
      (E) The answers differ, but these differences don't matter from the perspective of factuality.
    `,
    schema: z.object({
      answer: z.enum(["A", "B", "C", "D", "E"]).describe("Your selection."),
      rationale: z
        .string()
        .describe("Why you chose this answer. Be very detailed."),
    }),
  });

  /**
   * LLM's are well documented at being poor at generating
   */
  const scores = {
    A: 0.4,
    B: 0.6,
    C: 1,
    D: 0,
    E: 1,
  };

  return {
    score: scores[object.answer],
    metadata: {
      rationale: object.rationale,
    },
  };
};

// This is the scorer that can be passed into the scorers in Evalite
export const Factuality = createScorer<Message[], string, string>({
  name: "Factuality",
  scorer: async ({ input, expected, output }) => {
    // Extract the user's question from the messages
    const userMessage = input.find((msg) => msg.role === "user");
    const question = userMessage?.content || "";

    return checkFactuality({
      question,
      groundTruth: expected!,
      submission: output,
    });
  },
});

evalite("Deep Search Eval", {
  data: async (): Promise<{ input: Message[]; expected: string }[]> => {
    return [
      {
        input: [
          {
            id: "1",
            role: "user",
            content: "What is the latest version of TypeScript?",
          },
        ],
        expected:
          "The current TypeScript version is 5.8.3. Version 5.9 is currently in beta.",
      },
      {
        input: [
          {
            id: "2",
            role: "user",
            content: "What are the main features of Next.js 15?",
          },
        ],
        expected: `
React 19 Support: Next.js 15 offers full support for React 19, enabling the use of its new features, including new hooks. What's New in Next.js 15: New Hooks, Turbopack and more
Caching Improvements: Overhauled caching system. Next.js 15 Breakdown (Everything You Need To Know) - YouTube
Turbopack: Stable release for Turbopack in development. Next.js 15
New APIs: Introduction of new APIs. Next.js 15
Performance enhancements: Next.js 15 includes performance boosts. Introduction to Next.js 15: What's New and Improved - DEV Community
Improved Debugging: Updates for debugging errors with a redesigned error UI and improved stack traces. Next.js 15.2
`,
      },
    ];
  },
  task: async (input) => {
    return askDeepSearch(input);
  },
  scorers: [
    {
      name: "Contains Links",
      description: "Checks if the output contains any markdown links.",
      scorer: ({ output }) => {
        // Regex pattern to match markdown links: [text](url)
        const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/;
        const containsLinks = markdownLinkPattern.test(output);

        return containsLinks ? 1 : 0;
      },
    },
    Factuality,
  ],
});
