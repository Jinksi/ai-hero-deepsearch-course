import type { Message } from "ai";

export const devData: { input: Message[]; expected: string }[] = [
  {
    input: [
      {
        id: "1",
        role: "user",
        content: "What is the latest version of TypeScript?",
      },
    ],
    expected:
      "The current TypeScript version is 5.8.3. Version 5.9 is currently in beta.",
  },
  {
    input: [
      {
        id: "2",
        role: "user",
        content: "What are the main features of Next.js 15?",
      },
    ],
    expected: `
React 19 Support: Next.js 15 offers full support for React 19, enabling the use of its new features, including new hooks. What's New in Next.js 15: New Hooks, Turbopack and more
Caching Improvements: Overhauled caching system. Next.js 15 Breakdown (Everything You Need To Know) - YouTube
Turbopack: Stable release for Turbopack in development. Next.js 15
New APIs: Introduction of new APIs. Next.js 15
Performance enhancements: Next.js 15 includes performance boosts. Introduction to Next.js 15: What's New and Improved - DEV Community
Improved Debugging: Updates for debugging errors with a redesigned error UI and improved stack traces. Next.js 15.2
`,
  },
];