# Git Docs

A hosted, single-page todo and notes app with git-inspired revision controls:

- `Sync` saves the current branch working state to Supabase
- `Commit` stores a snapshot with a required message
- `Branch` creates a named version stream from the current state

## Stack

- Next.js App Router
- React 19
- Supabase

## Local setup

1. Install Node.js 20 or newer.
2. Install dependencies:

```bash
npm install
```

3. Copy the env template:

```bash
cp .env.example .env.local
```

4. Create a Supabase project and run [`supabase/schema.sql`](/Users/paulcherian/Desktop/Projects/git-docs/supabase/schema.sql).
5. Start the app:

```bash
npm run dev
```

## Environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Notes

- If Supabase env vars are missing, the UI still renders in preview mode with seeded sample data.
- Persistence, commit history, and branch creation require Supabase to be configured.
