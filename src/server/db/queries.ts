import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "./index";
import { requests, users } from "./schema";
import type { DB } from "./schema";

const DAILY_RATE_LIMIT = 1; // Maximum requests per day for regular users

/**
 * Get the count of requests made by a user today
 */
export async function getUserDailyRequestCount(
  userId: string,
): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Start of today

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(requests)
    .where(and(eq(requests.userId, userId), gte(requests.createdAt, today)));

  return result[0]?.count ?? 0;
}

/**
 * Check if a user is an admin
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
  const user = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user[0]?.isAdmin ?? false;
}

/**
 * Check if a user can make a request (rate limiting)
 * Returns true if the user can make a request, false if rate limited
 */
export async function canUserMakeRequest(userId: string): Promise<boolean> {
  // Check if user is admin (admins bypass rate limits)
  const admin = await isUserAdmin(userId);
  if (admin) {
    return true;
  }

  // Check daily request count
  const dailyCount = await getUserDailyRequestCount(userId);
  return dailyCount < DAILY_RATE_LIMIT;
}

/**
 * Record a new request for a user
 */
export async function recordUserRequest(
  userId: string,
  promptTokens: number = 0,
  completionTokens: number = 0,
): Promise<DB.Request> {
  const newRequest: DB.NewRequest = {
    userId,
    promptTokens,
    completionTokens,
  };

  const result = await db.insert(requests).values(newRequest).returning();
  return result[0]!;
}

export { DAILY_RATE_LIMIT };
