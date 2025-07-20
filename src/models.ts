import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

export const model = openai("gpt-4.1-mini-2025-04-14");

export const factualityModel = openai("gpt-4.1-mini-2025-04-14");

export const statementGenerationModel = openai("gpt-4.1-nano-2025-04-14");
export const answerRelevancyModel = openai("gpt-4.1-mini-2025-04-14");
