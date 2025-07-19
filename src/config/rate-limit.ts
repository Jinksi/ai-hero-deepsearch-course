import type { RateLimitConfig } from "~/server/redis/rate-limit";

// Global rate limit configuration
// For testing: 1 request per 5 seconds
// For production: consider something like 100 requests per minute
export const globalRateLimitConfig: RateLimitConfig = {
  maxRequests: 1,
  maxRetries: 3,
  windowMs: 5_000, // 5 seconds
  keyPrefix: "global",
};

// You can add more specific rate limit configs here in the future
// export const userRateLimitConfig: RateLimitConfig = { ... };
