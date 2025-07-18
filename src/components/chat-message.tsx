import ReactMarkdown, { type Components } from "react-markdown";
import type { Message } from "ai";
import { ExternalLink } from "lucide-react";

export type MessagePart = NonNullable<Message["parts"]>[number];

interface ChatMessageProps {
  parts: Array<MessagePart>;
  role: "user" | "assistant" | "system" | "data";
  userName: string;
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

const Source = ({ part }: { part: MessagePart & { type: "source" } }) => {
  const { source } = part;

  return (
    <div className="mb-4 rounded-lg border border-purple-500/30 bg-purple-500/10 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-purple-400">
        <ExternalLink className="size-4" />
        Source
      </div>
      <div className="space-y-2">
        <div className="text-sm">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-blue-300 hover:text-blue-200 hover:underline"
          >
            {source.title || source.url}
            <ExternalLink className="size-3" />
          </a>
        </div>
        <div className="text-xs text-gray-400">{source.url}</div>
      </div>
    </div>
  );
};

export const ChatMessage = ({ parts, role, userName }: ChatMessageProps) => {
  const isAI = role === "assistant";

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

        {parts.map((part, index) => {
          switch (part.type) {
            case "text":
              return <TextPart key={index} part={part} />;
            case "tool-invocation":
              return <ToolInvocation key={index} part={part} />;
            case "source":
              return <Source key={index} part={part} />;
            default:
              // Ignore unsupported part types
              return null;
          }
        })}
      </div>
    </div>
  );
};
