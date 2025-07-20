import type { RateLimitConfig } from "~/server/redis/rate-limit";

// Global rate limit configuration
// For testing: 1 request per 1 second
// For production: consider something like 100 requests per minute
export const globalRateLimitConfig: RateLimitConfig = {
  maxRequests: 1,
  maxRetries: 10,
  windowMs: 1_000, // 1 second
  keyPrefix: "global",
};

// You can add more specific rate limit configs here in the future
// export const userRateLimitConfig: RateLimitConfig = { ... };
