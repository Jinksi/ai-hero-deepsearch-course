import { LangfuseExporter } from "langfuse-vercel";
import { env } from "~/env";

import * as Sentry from "@sentry/nextjs";
import { registerOTel } from "@vercel/otel";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }

  registerOTel({
    serviceName: "ai-hero-deepsearch",
    traceExporter: new LangfuseExporter({
      environment: env.NODE_ENV,
    }),
  });
}

export const onRequestError = Sentry.captureRequestError;
