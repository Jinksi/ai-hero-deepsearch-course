import type { Message } from "ai";
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "./index";
import { chats, messages, requests, users } from "./schema";
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

/**
 * Create or update a chat with all its messages
 * If the chat exists and belongs to the user, all existing messages are replaced
 * If the chat doesn't exist, a new chat is created
 */
export async function upsertChat(opts: {
  userId: string;
  chatId: string;
  title: string;
  messages: Message[];
  updateTitle?: boolean;
}): Promise<void> {
  const {
    userId,
    chatId,
    title,
    messages: chatMessages,
    updateTitle = true,
  } = opts;

  return await db.transaction(async (tx) => {
    // Check if chat exists and belongs to the user
    const existingChat = await tx
      .select({ id: chats.id, userId: chats.userId })
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1);

    if (existingChat.length > 0) {
      // Chat exists - verify ownership
      if (existingChat[0]!.userId !== userId) {
        throw new Error("Chat not found"); // Obscure error message
      }

      // Delete all existing messages for this chat
      await tx.delete(messages).where(eq(messages.chatId, chatId));

      // Update chat title and updatedAt (only if updateTitle is true)
      const updateData: any = {
        updatedAt: new Date(),
      };

      if (updateTitle) {
        updateData.title = title;
      }

      await tx.update(chats).set(updateData).where(eq(chats.id, chatId));
    } else {
      // Chat doesn't exist - create new chat
      const newChat: DB.NewChat = {
        id: chatId,
        title,
        userId,
      };
      await tx.insert(chats).values(newChat);
    }

    // Insert all messages
    if (chatMessages.length > 0) {
      const newMessages: DB.NewMessage[] = chatMessages.map((msg, index) => ({
        chatId,
        role: msg.role,
        parts: msg.content as any, // JSON field for message parts
        order: index,
      }));
      await tx.insert(messages).values(newMessages);
    }
  });
}

/**
 * Get a chat by id with its messages
 * Returns null if chat doesn't exist or doesn't belong to the user
 */
export async function getChat(
  chatId: string,
  userId: string,
): Promise<{
  chat: DB.Chat;
  messages: Message[];
} | null> {
  // First check if chat exists and belongs to user
  const chatResult = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1);

  if (chatResult.length === 0) {
    return null;
  }

  const chat = chatResult[0]!;

  // Get all messages for this chat, ordered by order field
  const messagesResult = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(messages.order);

  // Convert DB messages to AI SDK Message format
  const chatMessages: Message[] = messagesResult.map((msg) => ({
    id: msg.id,
    role: msg.role as "user" | "assistant" | "system",
    content: msg.parts as any, // JSON field converted back to content
    createdAt: msg.createdAt,
  }));

  return {
    chat,
    messages: chatMessages,
  };
}

/**
 * Get all chats for a user, without the messages
 * Returns chats ordered by most recently updated first
 */
export async function getChats(userId: string): Promise<DB.Chat[]> {
  const chatsResult = await db
    .select()
    .from(chats)
    .where(eq(chats.userId, userId))
    .orderBy(desc(chats.updatedAt));

  return chatsResult;
}
