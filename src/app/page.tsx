import type { Message } from "ai";
import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { auth } from "~/server/auth/index.ts";
import { getChat, getChats } from "~/server/db/queries.ts";

import { AuthButton } from "../components/auth-button.tsx";
import { ChatPage } from "./chat.tsx";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const session = await auth();
  const userName = session?.user?.name ?? "Guest";
  const isAuthenticated = !!session?.user;
  const isNewChat = !id;
  const chatId = id ?? crypto.randomUUID();

  // Fetch chats from database if user is authenticated
  let userChats: Array<{ id: string; title: string }> = [];
  let initialMessages: Message[] = [];

  if (isAuthenticated && session.user?.id) {
    // Fetch all chats for the sidebar
    const fetchedChats = await getChats(session.user.id);
    userChats = fetchedChats.map((chat) => ({
      id: chat.id,
      title: chat.title,
    }));

    // If there's an id search param, fetch the specific chat with messages
    if (id) {
      const chatData = await getChat(id, session.user.id);

      if (chatData) {
        // The getChat function returns messages with content mapped from parts,
        // but we need to remap them to the format specified by the user
        initialMessages = chatData.messages.map((msg) => ({
          id: msg.id,
          // msg.role is typed as string, so we
          // need to cast it to the correct type
          role: msg.role as "user" | "assistant",
          // getChat returns content as the parts data, so we map it back to parts
          parts: msg.content as unknown as Message["parts"],
          // content is not persisted, so we can
          // safely pass an empty string, because
          // parts are always present, and the AI SDK
          // will use the parts to construct the content
          content: "",
        }));
      }
    }
  }

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Sidebar */}
      <div className="flex w-64 flex-col border-r border-gray-700 bg-gray-900">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-400">Your Chats</h2>
            {isAuthenticated && (
              <Link
                href="/"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                title="New Chat"
              >
                <PlusIcon className="h-5 w-5" />
              </Link>
            )}
          </div>
        </div>
        <div className="-mt-1 flex-1 space-y-2 overflow-y-auto px-4 pt-1 scrollbar-thin scrollbar-track-gray-800 scrollbar-thumb-gray-600">
          {userChats.length > 0 ? (
            userChats.map((chat) => (
              <div key={chat.id} className="flex items-center gap-2">
                <Link
                  href={`/?id=${chat.id}`}
                  className={`flex-1 rounded-lg p-3 text-left text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                    chat.id === id
                      ? "bg-gray-700"
                      : "hover:bg-gray-750 bg-gray-800"
                  }`}
                >
                  {chat.title}
                </Link>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500">
              {isAuthenticated
                ? "No chats yet. Start a new conversation!"
                : "Sign in to start chatting"}
            </p>
          )}
        </div>
        <div className="p-4">
          <AuthButton
            isAuthenticated={isAuthenticated}
            userImage={session?.user?.image}
          />
        </div>
      </div>

      <ChatPage
        key={chatId}
        userName={userName}
        chatId={chatId}
        initialMessages={initialMessages}
        isNewChat={isNewChat}
      />
    </div>
  );
}
