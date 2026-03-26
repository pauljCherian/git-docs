# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start development server (localhost:3000) |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm run lint` | ESLint checks |
| `npm run typecheck` | TypeScript type checking |

No test runner is configured.

## Architecture

Next.js 15 App Router application with React 19. A todo app that applies git-inspired workflows (sync, commit, branch) to todo list management. Uses PostgreSQL (via `pg` package) for persistence and NextAuth.js v5 (GitHub OAuth) for authentication.

### Request flow

1. **Middleware** (`middleware.ts`): NextAuth middleware protects all routes except `/auth/*` and `/api/auth/*`
2. **Server entry** (`app/page.tsx`): Async Server Component gets session, calls `loadDocument()` with `userId`, passes initial state to the client
3. **Client component** (`components/todo-app.tsx`): Single component managing all UI state with `useState`, `useOptimistic`, and `useTransition`
4. **API routes** (`app/api/sync|commit|branch|revisions/route.ts`): Extract userId from session via `requireUserId()`, delegate to `lib/data.ts` functions
5. **Data layer** (`lib/data.ts`): All PostgreSQL operations scoped by userId — `saveWorkingState()`, `createCommit()`, `createBranch()`, `listRevisions()`

### Key modules

- `lib/auth.ts` — NextAuth.js v5 config (GitHub OAuth, JWT strategy, user upsert)
- `lib/auth-helpers.ts` — `requireUserId()` for API route auth
- `lib/auth-types.d.ts` — Type augmentation for NextAuth session/JWT
- `lib/db.ts` — PostgreSQL pool initialization (`getPool()`), env var checking (`hasDbEnv()`)
- `lib/types.ts` — Core types: `TodoItem`, `PageState`, `DocumentRecord`, `BranchRecord`, `RevisionRecord`, `AppState`
- `lib/utils.ts` — Helpers for dates, normalization, default state
- `lib/diff.ts` — Diff logic for comparing todo snapshots between commits
- `components/providers.tsx` — SessionProvider wrapper for client components
- `db/schema.sql` — Database schema (users, documents, branches, revisions tables with triggers)

### Authentication

GitHub OAuth via NextAuth.js v5. JWT session strategy — no database sessions. User records are upserted into the `users` table on sign-in. All data is scoped by `user_id` on the `documents` table.

### Preview mode

When `DATABASE_URL` is not set, the app runs in preview mode with seeded sample data and no persistence. Auth is skipped in preview mode.

### Data model

- **users**: GitHub OAuth users (github_id, email, name, avatar_url)
- **documents**: Root record (UUID PK), belongs to a user via `user_id`
- **branches**: Named branches per document, stores `working_state` as JSONB and points to `head_revision_id`
- **revisions**: Committed snapshots with message and `snapshot` JSONB

### UI patterns

- Optimistic updates via `useOptimistic` for instant todo interactions
- `useTransition` wraps all async API calls (sync, commit, branch)
- Status messages with color-coded tones (neutral, success, error)
- Expandable commit history cards with inline diff view (added/removed/modified todos)

## Environment

Requires Node.js 20+. Copy `.env.example` to `.env.local` and set:
- `DATABASE_URL` — PostgreSQL connection string
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — from GitHub OAuth app (github.com/settings/developers)
- `AUTH_SECRET` — generate with `openssl rand -base64 32`

Run `db/schema.sql` against your database to initialize the schema.
