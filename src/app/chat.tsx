"use client";

import type { Message } from "ai";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChatMessage } from "~/components/chat-message";
import { ErrorMessage } from "~/components/error-message";
import { SignInModal } from "~/components/sign-in-modal";
import { isNewChatCreated } from "~/utils";

import { useChat } from "@ai-sdk/react";

interface ChatProps {
  userName: string;
  chatId: string;
  initialMessages: Message[];
  isNewChat: boolean;
}

export const ChatPage = ({
  userName,
  chatId,
  initialMessages,
  isNewChat,
}: ChatProps) => {
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);
  const router = useRouter();

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    error,
    data,
  } = useChat({
    initialMessages,
    body: {
      chatId,
      isNewChat,
    },
    onError: (error) => {
      console.log("useChat error:", error); // Debug logging

      // Check if it's an authentication error
      if (
        error.message.includes("401") ||
        error.message.includes("Unauthorised")
      ) {
        setShowSignInModal(true);
        setRateLimitError(null);
        return;
      }

      // Check if it's a rate limit error - be more comprehensive
      const isRateLimitError =
        error.message.includes("429") ||
        error.message.includes("Rate limit exceeded") ||
        error.message.includes("daily limit") ||
        error.message.includes("Too Many Requests");

      if (isRateLimitError) {
        let errorMessage =
          "You have exceeded your daily request limit. Please try again tomorrow.";

        try {
          // Try to parse the error response for more details
          // The error message might contain JSON or just be the message directly
          if (error.message.includes("{")) {
            const jsonMatch = error.message.match(/\{.*\}/);
            if (jsonMatch) {
              const errorData = JSON.parse(jsonMatch[0]);
              errorMessage = errorData.message || errorMessage;
            }
          } else if (error.message.includes("daily limit")) {
            // If it's already a formatted message, use it
            errorMessage = error.message;
          }
        } catch (parseError) {
          console.log("Failed to parse error message:", parseError);
          // Use fallback message
        }

        setRateLimitError(errorMessage);
        setShowSignInModal(false);
        return;
      }

      // Clear rate limit error for other types of errors
      setRateLimitError(null);
    },
  });

  // Handle new chat creation - redirect to the new chat URL
  useEffect(() => {
    const lastDataItem = data?.[data.length - 1];

    if (lastDataItem && isNewChatCreated(lastDataItem)) {
      router.push(`?id=${lastDataItem.chatId}`);
    }
  }, [data, router]);

  const isLoading = status === "streaming" || status === "submitted";

  return (
    <>
      <div className="flex flex-1 flex-col">
        <div
          className="mx-auto w-full max-w-[65ch] flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-track-gray-800 scrollbar-thumb-gray-600 hover:scrollbar-thumb-gray-500"
          role="log"
          aria-label="Chat messages"
        >
          {/* Display rate limit error */}
          {rateLimitError && (
            <div className="mb-4">
              <ErrorMessage message={rateLimitError} />
            </div>
          )}

          {/* Display general errors */}
          {error &&
            !rateLimitError &&
            !error.message.includes("401") &&
            !error.message.includes("Unauthorised") && (
              <div className="mb-4">
                <ErrorMessage
                  message={
                    error.message || "An error occurred. Please try again."
                  }
                />
              </div>
            )}

          {messages.map((message, index) => {
            return (
              <ChatMessage
                key={index}
                parts={
                  message.parts || [{ type: "text", text: message.content }]
                }
                role={message.role}
                userName={userName}
              />
            );
          })}
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-6 animate-spin text-gray-400" />
            </div>
          )}
        </div>

        <div className="border-t border-gray-700">
          <form onSubmit={handleSubmit} className="mx-auto max-w-[65ch] p-4">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={handleInputChange}
                placeholder="Say something..."
                autoFocus
                aria-label="Chat input"
                disabled={isLoading}
                className="flex-1 rounded border border-gray-700 bg-gray-800 p-2 text-gray-200 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:hover:bg-gray-700"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Send"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      <SignInModal
        isOpen={showSignInModal}
        onClose={() => setShowSignInModal(false)}
      />
    </>
  );
};
