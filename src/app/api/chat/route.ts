import type { Message } from "ai";
import { createDataStreamResponse, streamText } from "ai";
import { model } from "~/models";
import { auth } from "~/server/auth";

export const maxDuration = 60;

export async function POST(request: Request) {
  // Check if user is authenticated
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorised", { status: 401 });
  }

  const body = (await request.json()) as {
    messages: Array<Message>;
  };

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const { messages } = body;

      const result = streamText({
        model,
        messages,
        system: `You are a helpful AI assistant with access to real-time web search capabilities through search grounding.

When providing information:
1. Use your search grounding capabilities to find current, accurate information
2. Cite your sources using inline links in markdown format: [label](URL), where label is the title of the source and URL is the link to the source
3. Synthesise information from multiple sources when available
4. Provide well-researched and up-to-date responses

Your goal is to provide helpful, accurate, and well-sourced responses to user queries using the latest information available.`,
        maxSteps: 10,
      });

      result.mergeIntoDataStream(dataStream, {
        sendSources: true,
      });
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occured!";
    },
  });
}
