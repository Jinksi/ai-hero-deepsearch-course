import ReactMarkdown, { type Components } from "react-markdown";
import type { Message } from "ai";
import { SearchIcon } from "lucide-react";
import { useState } from "react";
import type { OurMessageAnnotation } from "~/deep-search";

export type MessagePart = NonNullable<Message["parts"]>[number];

interface ChatMessageProps {
  parts: MessagePart[];
  role: string;
  userName: string;
  annotations: OurMessageAnnotation[];
}

const components: Components = {
  // Override default elements with custom styling
  p: ({ children }) => <p className="mb-4 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  code: ({ className, children, ...props }) => (
    <code className={`${className ?? ""}`} {...props}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-lg bg-gray-700 p-4">
      {children}
    </pre>
  ),
  a: ({ children, ...props }) => (
    <a
      className="text-blue-400 underline"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

const Markdown = ({ children }: { children: string }) => {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
};

const ReasoningSteps = ({
  annotations,
}: {
  annotations: OurMessageAnnotation[];
}) => {
  const [openStep, setOpenStep] = useState<number | null>(null);

  if (annotations.length === 0) return null;

  return (
    <div className="mb-4 w-full">
      <ul className="space-y-1">
        {annotations.map((annotation, index) => {
          const isOpen = openStep === index;
          return (
            <li key={index} className="relative">
              <button
                onClick={() => setOpenStep(isOpen ? null : index)}
                className={`min-w-34 flex w-full flex-shrink-0 items-center rounded px-2 py-1 text-left text-sm transition-colors ${
                  isOpen
                    ? "bg-gray-700 text-gray-200"
                    : "text-gray-400 hover:bg-gray-800 hover:text-gray-300"
                }`}
              >
                <span
                  className={`z-10 mr-3 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 border-gray-500 text-xs font-bold ${
                    isOpen
                      ? "border-blue-400 text-white"
                      : "bg-gray-800 text-gray-300"
                  }`}
                >
                  {index + 1}
                </span>
                {annotation.action.title}
              </button>
              <div className={`${isOpen ? "mt-1" : "hidden"}`}>
                {isOpen && (
                  <div className="px-2 py-1">
                    {annotation.action.type === "plan" && (
                      <div>
                        <div className="text-sm italic text-gray-400 mb-3">
                          <Markdown>{annotation.action.plan}</Markdown>
                        </div>
                        <div className="text-sm text-gray-400">
                          <div className="mb-2 font-semibold">Search Queries:</div>
                          <ul className="list-disc pl-4 space-y-1">
                            {annotation.action.queries.map((query, queryIndex) => (
                              <li key={queryIndex} className="flex items-center gap-2">
                                <SearchIcon className="size-3 flex-shrink-0" />
                                <span>{query}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                    {annotation.action.type === "decision" && (
                      <div>
                        <div className="text-sm italic text-gray-400 mb-2">
                          <Markdown>{annotation.action.reasoning}</Markdown>
                        </div>
                        {annotation.action.feedback && (
                          <div className="text-sm text-gray-400 mb-3 p-2 bg-gray-700/50 rounded">
                            <div className="font-semibold text-gray-300 mb-1">Evaluator Feedback:</div>
                            <Markdown>{annotation.action.feedback}</Markdown>
                          </div>
                        )}
                        <div className="text-sm text-gray-400">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                            annotation.action.decision === "continue" 
                              ? "bg-blue-500/20 text-blue-300" 
                              : "bg-green-500/20 text-green-300"
                          }`}>
                            {annotation.action.decision === "continue" ? "Continue Searching" : "Ready to Answer"}
                          </span>
                        </div>
                      </div>
                    )}
                    {annotation.action.type === "search" && (
                      <div>
                        <div className="text-sm italic text-gray-400 mb-2">
                          <Markdown>{annotation.action.reasoning}</Markdown>
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-sm text-gray-400">
                          <SearchIcon className="size-4" />
                          <span>{annotation.action.query}</span>
                        </div>
                      </div>
                    )}
                    {annotation.action.type === "answer" && (
                      <div className="text-sm italic text-gray-400">
                        <Markdown>{annotation.action.reasoning}</Markdown>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const ToolInvocation = ({
  part,
}: {
  part: MessagePart & { type: "tool-invocation" };
}) => {
  const { toolInvocation } = part;

  if (
    toolInvocation.state === "partial-call" ||
    toolInvocation.state === "call"
  ) {
    return (
      <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
        <div className="mb-2 text-sm font-semibold text-blue-400">
          🔧 Calling tool: {toolInvocation.toolName}
        </div>
        <div className="text-sm text-gray-300">
          <pre className="overflow-x-auto rounded bg-gray-700 p-2 text-xs">
            {JSON.stringify(toolInvocation.args, null, 2)}
          </pre>
        </div>
      </div>
    );
  }

  if (toolInvocation.state === "result") {
    return (
      <div className="mb-4 rounded-lg border border-green-500/30 bg-green-500/10 p-3">
        <div className="mb-2 text-sm font-semibold text-green-400">
          ✅ Tool result: {toolInvocation.toolName}
        </div>
        <div className="mb-2 text-xs text-gray-400">
          <details className="cursor-pointer">
            <summary>Arguments</summary>
            <pre className="mt-1 overflow-x-auto rounded bg-gray-700 p-2 text-xs">
              {JSON.stringify(toolInvocation.args, null, 2)}
            </pre>
          </details>
        </div>
        <div className="text-sm text-gray-300">
          <div className="mb-1 text-xs text-gray-400">Result:</div>
          <pre className="overflow-x-auto rounded bg-gray-700 p-2 text-xs">
            {typeof toolInvocation.result === "string"
              ? toolInvocation.result
              : JSON.stringify(toolInvocation.result, null, 2)}
          </pre>
        </div>
      </div>
    );
  }

  return null;
};

const TextPart = ({ part }: { part: MessagePart & { type: "text" } }) => {
  return (
    <div className="prose prose-invert max-w-none">
      <Markdown>{part.text}</Markdown>
    </div>
  );
};

export const ChatMessage = ({ parts, role, userName, annotations }: ChatMessageProps) => {
  const isAI = role === "assistant";

  // Defensive check: ensure parts is always an array
  const safeParts = Array.isArray(parts) ? parts : [];

  return (
    <div className="mb-6">
      <div
        className={`rounded-lg p-4 ${
          isAI ? "bg-gray-800 text-gray-300" : "bg-gray-900 text-gray-300"
        }`}
      >
        <p className="mb-2 text-sm font-semibold text-gray-400">
          {isAI ? "AI" : userName}
        </p>

        {isAI && <ReasoningSteps annotations={annotations} />}

        {safeParts.map((part, index) => {
          switch (part.type) {
            case "text":
              return <TextPart key={index} part={part} />;
            case "tool-invocation":
              return <ToolInvocation key={index} part={part} />;
            default:
              // Ignore unsupported part types
              return null;
          }
        })}
      </div>
    </div>
  );
};
