import { LangfuseExporter } from "langfuse-vercel";
import { env } from "~/env";

import { registerOTel } from "@vercel/otel";

export function register() {
  registerOTel({
    serviceName: "ai-hero-deepsearch",
    traceExporter: new LangfuseExporter({
      environment: env.NODE_ENV,
    }),
  });
}
