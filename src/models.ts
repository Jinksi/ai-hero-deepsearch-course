import { openai } from "@ai-sdk/openai";

// production models
export const model = openai("gpt-4.1-mini-2025-04-14");
export const titleGenerationModel = openai("gpt-4.1-nano-2025-04-14");
export const summaryModel = openai("gpt-4.1-nano-2025-04-14");
export const guardrailModel = openai("gpt-4.1-nano-2025-04-14");
export const clarificationModel = openai("gpt-4.1-nano-2025-04-14");

// eval models
export const factualityModel = openai("gpt-4.1-mini-2025-04-14");
export const statementGenerationModel = openai("gpt-4.1-nano-2025-04-14");
export const answerRelevancyModel = openai("gpt-4.1-mini-2025-04-14");
