# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `pnpm install` - Install dependencies
- `pnpm run dev` - Start development server with turbo mode
- `pnpm run build` - Build the application
- `pnpm run preview` - Build and preview the production build
- `pnpm run lint` - Run ESLint
- `pnpm run lint:fix` - Fix linting issues automatically
- `pnpm run typecheck` - Run TypeScript type checking
- `pnpm run check` - Run both linting and type checking
- `pnpm run format:write` - Format code with Prettier
- `pnpm run format:check` - Check code formatting
- `pnpm run eval` - Run evalite evaluations in watch mode

## Evaluation Commands

- `pnpm evalite` - Run evaluations with dev dataset (2 test cases)
- `EVAL_DATASET=ci pnpm evalite` - Run evaluations with CI dataset (dev + ci = 4 test cases)
- `EVAL_DATASET=regression pnpm evalite` - Run evaluations with regression dataset (dev + ci + regression = 5 test cases)

## Database Commands

- `./start-database.sh` - Start PostgreSQL database with Docker
- `./start-redis.sh` - Start Redis server with Docker
- `pnpm run db:push` - Migrate database using Drizzle schema
- `pnpm run db:generate` - Generate Drizzle migrations
- `pnpm run db:migrate` - Run Drizzle migrations
- `pnpm run db:studio` - Open Drizzle Studio

## Architecture Overview

This is an AI-powered deep search application built with Next.js and the Vercel AI SDK. The core functionality revolves around searching the web and scraping content to provide comprehensive, well-sourced answers.

### Key Components

- **Deep Search Engine** (`src/deep-search.ts`): Core AI functionality that combines web search and content scraping using the Vercel AI SDK's tool system
- **Web Search** (`src/serper.ts`): Integration with Serper for web search capabilities
- **Web Scraping** (`src/scraper.ts`): Bulk website crawling and content extraction
- **Chat Interface** (`src/app/chat.tsx`): Frontend chat implementation using `useChat` from AI SDK
- **API Routes** (`src/app/api/chat/route.ts`): Backend API for handling chat requests with `streamText`

### Data Layer

- **Database**: PostgreSQL with Drizzle ORM
- **Schema**: Defined in `src/server/db/schema.ts`
- **Queries**: Helper functions in `src/server/db/queries.ts`
- **Caching**: Redis for rate limiting and caching

### Authentication

- NextAuth v5 beta implementation in `src/server/auth/`
- Drizzle adapter for database sessions

### Key Features

- Multi-step AI reasoning with up to 10 steps
- Web search and content scraping tools
- Rate limiting by IP and user
- Telemetry with OpenTelemetry and Langfuse
- Frontend error monitoring with Sentry
- Evaluation system using evalite

## Code Style Guidelines

- Use dash-case for file names (e.g., `auth-button.tsx`)
- Prefer TypeScript with type imports: `import type { Message } from "ai"`
- Use lucide-react for icons
- Use Tailwind `size-*` classes instead of `h-* w-*`
- Use non-optional properties where possible
- Components in `src/components/` with dash-cased names

## Environment Setup

1. Install Docker Desktop
2. Run `./start-database.sh` and `./start-redis.sh`
3. Configure `.env` file (validate changes in `src/env.js`)
4. Run `pnpm run db:push` after schema changes

## Configuration

### Search Results Count

The number of search results returned by the web search tool can be configured via the `SEARCH_RESULTS_COUNT` environment variable in your `.env` file:

```
SEARCH_RESULTS_COUNT=10
```

- **Default**: 10 results
- **Location**: Configured in `src/env.js` and used in `src/deep-search.ts`
- **Purpose**: Controls how many search results are fetched from Serper API during web searches

## Important File Locations

- **Models**: `src/models.ts` - AI model configurations
- **Types**: `src/types.ts` - General-purpose types
- **Utils**: `src/utils.ts` - General utilities
- **Rate Limiting**: `src/config/rate-limit.ts` and `src/server/redis/rate-limit.ts`
- **Environment**: `src/env.js` - Type-safe environment validation
- **Error Monitoring**: Sentry configuration in `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/app/global-error.tsx`, and `src/instrumentation.ts`
- **Evaluation Datasets**: `evals/` directory contains three dataset files:
  - `evals/dev.ts` - Development dataset (2 test cases for local testing)
  - `evals/ci.ts` - CI dataset (2 test cases for pre-deployment testing)
  - `evals/regression.ts` - Regression dataset (1 test case for periodic testing)