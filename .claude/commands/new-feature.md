# /new-feature

Scaffold a new feature for Brainiac.

## Instructions

When the user runs `/new-feature [feature-name]`:

1. Read `../../LESSONS.md` and `CLAUDE.md` to understand constraints
2. Identify which layers are needed: DB table, API route, UI component, types
3. Draft a plan before writing any code:
   - New DB columns or tables (add to `supabase/migrations/`)
   - API routes needed (`src/app/api/`)
   - UI components (`src/components/` or page files)
   - TypeScript types (`src/types/index.ts`)
4. Follow these non-negotiables from LESSONS.md:
   - Always `await` Supabase mutations
   - Sequential + delay for any rate-limited external API calls
   - Proxy server-hostile APIs through API routes, never call from browser
   - `export const dynamic = 'force-dynamic'` on all API routes

## Output

- List files to create/modify
- Write the migration SQL first
- Then types, then API routes, then UI
