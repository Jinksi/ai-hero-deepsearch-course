import type { Message } from "ai";
import { generateObject } from "ai";
import { createScorer } from "evalite";
import { z } from "zod";
import {
  answerRelevancyModel,
  statementGenerationModel,
} from "~/models";

const generateEvaluationStatementsPrompt = (output: string) => {
  return `Given the text, break it down into meaningful statements while preserving context and relationships.
Don't split too aggressively.

Split compound statements particularly when they:
- Are joined by "and"
- Contain multiple distinct facts or claims
- Have multiple descriptive elements about the subject


Handle special cases:
- A single word answer should be treated as a complete statement
- Error messages should be treated as a single statement
- Empty strings should return an empty list
- When splitting text, keep related information together

Example:
Example text: Look! A bird! Birds are an interesting animal.

{
    "statements": ["Look!", "A bird!", "Birds are interesting animals."]
}

Please return only JSON format with "statements" array.
Return empty list for empty input.

Text:
${output}

JSON:
`;
};

const ANSWER_RELEVANCY_AGENT_INSTRUCTIONS = `You are a balanced and nuanced answer relevancy evaluator. Your job is to determine if LLM outputs are relevant to the input, including handling partially relevant or uncertain cases.

Key Principles:
1. Evaluate whether the output addresses what the input is asking for
2. Consider both direct answers and related context
3. Prioritise relevance to the input over correctness
4. Recognise that responses can be partially relevant
5. Empty inputs or error messages should always be marked as "no"
6. Responses that discuss the type of information being asked show partial relevance`;

const generateEvaluatePrompt = (input: string, statements: string[]) => {
  return `Evaluate each statement's relevance to the input question, considering direct answers, related context, and uncertain cases.

    Return JSON with array of verdict objects. Each verdict must include:
    - "verdict": "yes", "no", or "unsure"
    - "reason": Clear explanation of the verdict

    Verdict Guidelines:
    - "yes": Statement explicitly and directly answers the input question when it:
        * Contains specific answer to the question asked (e.g., "The colour of the sky is blue")
        * States explicit relationship between key concepts (e.g., "X is the CEO of company Y")
        * Can stand alone as a complete answer
        * Contains appropriate question-type response (e.g., location for "where", person for "who")
        * Note: If statement is incorrect but directly addresses the question, mark as "unsure"

    - "unsure": Statement shows partial relevance when it:
        * Discusses the type of information being asked about (e.g., mentions temperatures when asked about temperature)
        * Contains information about the answer without explicit statement
        * Uses importance indicators ("main", "primary", "major") with relevant concepts
        * Includes indirect references to the answer (e.g., "where the president works")
        * Contains topic-related administrative/governance terms without direct answer
        * References functions or characteristics typically associated with the answer
        * Uses terms that match what's being asked about
        * Mentions related entities without specifying their relationship to the answer
        * Is incorrect but shows understanding of the question
        * Contains the answer term but needs more context to be complete
        * Contains measurement units or quantities relevant to the question type
        * References locations or entities in the same category as what's being asked about
        * Provides relevant information without using explicit question-type terminology
        * Contains references to properties of the subject that relate to the question type


    - "no": Statement lacks meaningful connection to question when it:
        * Contains neither the subject nor the type of information being requested
        * Contains no terms related to what's being asked about
        * Contains only general subject information without relating to what's being asked
        * Consists of empty or meaningless content
        * Contains purely tangential information with no mention of the subject or question type
        * Discusses the subject but not the specific attribute being asked about
        * Note: Assessment is about connection to what's being asked, not factual accuracy
        * Contains no connection to what's being asked about (neither the subject nor the type of information requested)

    REMEMBER:
    - If the statement contains words or phrases that are relevant to the input, it is partially relevant.
    - If the statement is a direct answer to the input, it is relevant.
    - If the statement is completely unrelated to the input or contains nothing, it is not relevant.
    - DO NOT MAKE A JUDGEMENT ON THE CORRECTNESS OF THE STATEMENT, JUST THE RELEVANCY.

    STRICT RULES:
    - If a statement mentions the type of information being requested, it should be marked as "unsure" ONLY if it's discussing that type meaningfully (not just mentioning it)
    - Subject mentions alone are NOT enough for relevance - they must connect to what's being asked about
    - Empty or meaningless statements are always "no"
    - General facts about the subject without connection to the question type should be marked as "no"
    - ALWAYS mark a statement as "no" if it discusses the topic without any connection to the question type
    - Statements that mention neither the subject nor the type of information are always "no"
    - Type-level relevance overrides topic-only content
    - Measurement/quantity relevance counts as type-level relevance
    - Administrative/governance terms are only relevant if they relate to the question type
    - Descriptive facts about the subject should be marked as "no" unless they directly relate to the question type


    Examples of "no" statements:
        * "Japan has beautiful seasons" for "What is Japan's largest city?"
        * "Trees grow tall" for "How tall is Mount Everest?"
        * "The weather is nice" for "Who is the president?"

    Example:
    Input: "What colour is the sky during daytime?"
    Statements: [
      "The sky is blue during daytime",
      "The sky is full of clouds",
      "I had breakfast today",
      "Blue is a beautiful colour",
      "Many birds fly in the sky",
      "",
      "The sky is purple during daytime",
      "Daytime is when the sun is up",
    ]
    JSON:
    {
        "verdicts": [
            {
                "verdict": "yes",
                "reason": "This statement explicitly answers what colour the sky is during daytime"
            },
            {
                "verdict": "unsure",
                "reason": "This statement describes the sky but doesn't address its colour"
            },
            {
                "verdict": "no",
                "reason": "This statement about breakfast is completely unrelated to the sky"
            },
            {
                "verdict": "unsure",
                "reason": "This statement about blue is related to colour but doesn't address the sky"
            },
            {
                "verdict": "unsure",
                "reason": "This statement is about the sky but doesn't address its colour"
            },
            {
                "verdict": "no",
                "reason": "This statement is empty"
            },
            {
                "verdict": "unsure",
                "reason": "This statement is incorrect but contains relevant information and still addresses the question"
            },
            {
                "verdict": "no",
                "reason": "This statement is about daytime but doesn't address the sky"
            }
        ]
    }

The number of verdicts MUST MATCH the number of statements exactly.

  Input:
  ${input}

  Number of statements: ${statements.length === 0 ? "1" : statements.length}

  Statements:
  ${statements}

  JSON:
  `;
};

export const checkAnswerRelevancy = async (opts: {
  question: string;
  submission: string;
}) => {
  // Step 1: Break down the submission into statements
  const { object: statementsResult } = await generateObject({
    model: statementGenerationModel,
    prompt: generateEvaluationStatementsPrompt(opts.submission),
    schema: z.object({
      statements: z
        .array(z.string())
        .describe("Array of statements from the text"),
    }),
    experimental_telemetry: { isEnabled: false },
  });

  // Handle empty or single-statement cases
  const statements =
    statementsResult.statements.length === 0
      ? [opts.submission]
      : statementsResult.statements;

  // Step 2: Evaluate each statement's relevance
  const { object: evalResult } = await generateObject({
    model: answerRelevancyModel,
    system: ANSWER_RELEVANCY_AGENT_INSTRUCTIONS,
    prompt: generateEvaluatePrompt(opts.question, statements),
    schema: z.object({
      verdicts: z
        .array(
          z.object({
            verdict: z
              .enum(["yes", "no", "unsure"])
              .describe("The relevance verdict"),
            reason: z.string().describe("Explanation for the verdict"),
          }),
        )
        .describe("Array of verdicts for each statement"),
    }),
    experimental_telemetry: { isEnabled: false },
  });

  // Step 3: Calculate the average score
  const scores = evalResult.verdicts.map((v) => {
    switch (v.verdict) {
      case "yes":
        return 1;
      case "no":
        return 0;
      case "unsure":
        return 0.5;
      default:
        return 0;
    }
  });

  const averageScore =
    scores.length > 0
      ? scores.reduce((sum: number, score: number) => sum + score, 0) /
        scores.length
      : 0;

  return {
    score: averageScore,
    metadata: {
      statements: statements,
      verdicts: evalResult.verdicts,
      individualScores: scores,
    },
  };
};

// This is the scorer that can be passed into the scorers in Evalite
export const AnswerRelevancy = createScorer<Message[], string, string>({
  name: "Answer Relevancy",
  scorer: async ({ input, output }) => {
    // Extract the user's question from the messages
    const userMessage = input.find((msg) => msg.role === "user");
    const question = userMessage?.content || "";

    return checkAnswerRelevancy({
      question,
      submission: output,
    });
  },
});