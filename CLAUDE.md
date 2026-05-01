# CLAUDE.md - PublisherIQ

> Steam data analytics platform with AI chat interface. Next.js 15 + Supabase + Cube.js + TigerData/R2-backed ingestion and query-api surfaces. Last updated: May 1, 2026.

## When Uncertain, Ask

**Don't assume - ask questions using AskUserQuestion with clear options.**

Ask before:
- Choosing between multiple valid implementation approaches
- Making architectural decisions (new files, patterns, dependencies)
- Changing existing behavior that might be intentional
- Any destructive or hard-to-reverse operations

**Always provide 2-4 concrete options** with brief explanations of trade-offs.

---

## Database Safety Rules

**NEVER apply database changes automatically, even if auto-accept is enabled.**

Before ANY write operation, STOP and explain:
1. What will change (tables, columns, indexes, data)
2. Why the change is needed
3. Risk level (low/medium/high)
4. Rollback plan

**Requires explicit approval:**
- `supabase db push` / `supabase migration up`
- `ALTER TABLE`, `DROP`, `CREATE TABLE`, `TRUNCATE`
- `INSERT`, `UPDATE`, `DELETE` on production data

**Always safe (no approval needed):**
- `SELECT` queries, `supabase db dump`, `supabase migration list`

---

## Key Commands

```bash
pnpm install && pnpm build              # Build all packages
pnpm check-types                        # TypeScript type checking
pnpm --filter @publisheriq/admin dev    # Dashboard on http://localhost:3001
pnpm --filter @publisheriq/query-api dev
pnpm --filter database generate         # Regenerate Supabase types
```

Primary verification is `pnpm build` + `pnpm check-types`.
Targeted suites also exist for change intelligence:
- `pnpm --filter @publisheriq/ingestion test:change-intel`
- `cd services/pics-service && pytest`

Worker scripts: `pnpm --filter @publisheriq/ingestion <script-name>`. See `.claude/skills/data-pipeline/` for the full list.
YouTube operator scripts: `pnpm youtube:seed-routing`, `pnpm youtube:sync-discovery`, `pnpm youtube:sync-refresh`, `pnpm youtube:rollup-daily`.

---

## Common Pitfalls

### psql is NOT in PATH
```bash
# CORRECT - always use full path
source /Users/ryanbohmann/Desktop/publisheriq/.env && /opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -c "YOUR_SQL_HERE"
```

**\d commands fail** - Use `information_schema.columns` instead:
```sql
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'apps' ORDER BY ordinal_position;
```

### Common Mistakes
- Using `date` instead of `metric_date` in daily_metrics
- Looking for `description` column in `apps` table (doesn't exist)
- Using `getSupabase()` in client hooks (use `createBrowserClient()` instead)
- Referencing `LatestMetrics.js` as a separate file (it's defined inside `DailyMetrics.js`)
- Running `trends-calculate` or `priority-calculate` (correct: `calculate-trends`, `update-priorities`)
- Assuming `/apps` is Tiger-backed today (it is still Supabase/RPC-backed)
- Forgetting that YouTube chat coverage depends on the `getYoutubeGameCoverage` contract and `CHAT_TIGER_YOUTUBE_ENABLED`
- Writing new product/ingestion data to Supabase. Accepted incoming ingestion/product-data paths are Tiger/R2-primary; Supabase is retained only for auth/session/reference/legacy/product surfaces not proven Tiger-backed.
- Creating tests (no test framework configured; use `pnpm build` + `pnpm check-types`)

---

## Current Data-Plane Split

Do not describe PublisherIQ as a single Postgres app anymore.

- **TigerData / Timescale** is primary for accepted incoming ingestion and product-data writes, and is the contract-serving read plane behind `apps/query-api`.
- **Cloudflare R2** is the primary object archive for accepted change-intel/product payloads that are stored outside relational Tiger tables.
- **Supabase** remains for auth/session, reference data, legacy compatibility, and product surfaces not yet proven Tiger-backed. Do not add new product/ingestion writes to Supabase.
- **Cube.js** remains for compatibility and legacy analytics reads that have not yet moved to typed Tiger-backed contracts.

Current high-level ownership:

| Surface | Primary Path |
|---------|--------------|
| accepted Steam ingestion/product-data writes | TigerData; R2 for archived payload bodies/assets |
| `/chat` supported contract families | `apps/query-api` -> TigerData |
| `/chat` per-game YouTube coverage | `apps/query-api` -> TigerData |
| auth, sessions, credits, chat logs | Supabase |
| `/apps`, `/companies`, `/changes`, `/admin` product surfaces not proven Tiger-backed | Supabase RPCs/tables/views |
| legacy analytics compatibility | Cube.js over Supabase |

Recent accepted state:
- PR #8 fixed Tiger-primary change-intel worker startup and routed storefront inaccessible/no-data updates through Tiger when `CHANGE_INTEL_WRITE_TARGET=tiger`.
- PR #9 fixed the Tiger review claim RPC and updated ingestion verification to use actual Tiger job names and GitHub gate variables.
- PR #10 fixed Tiger embedding candidate selection and added capped manual embedding smoke runs.
- Embedding smoke evidence: GitHub Actions `embedding-sync.yml` manual runs `25205576035`, `25205646372`, `25205710827`, and `25205779668` all completed successfully on commit `7be82955` on May 1, 2026 UTC.
- This is not a claim that PICS, Railway service deployment, or every runtime surface has fully cut over.

---

## Architecture Patterns

### Supabase Client Variants

| Context | Function | File |
|---------|----------|------|
| Server Component / API Route | `createServerClient()` | `lib/supabase/server.ts` |
| Client Component / Hook | `createBrowserClient()` | `lib/supabase/client.ts` |
| Login page only | `createBrowserClientNoRefresh()` | `lib/supabase/client.ts` |
| Middleware | `createMiddlewareClient()` | `lib/supabase/middleware.ts` |
| Ingestion workers | `createServiceClient()` | `packages/database/src/client.ts` |

All paths relative to `apps/admin/src/` unless fully qualified.

### Import Conventions
- Supabase types: `import type { Database } from '@publisheriq/database'`
- Shared utilities: `import { logger } from '@publisheriq/shared'`
- Ingestion package: `@publisheriq/ingestion`

### Auth and Change Feed Surfaces
- Primary sign-in flow is OTP-first at `/login`
- Protected-route redirects use `?next=...`
- Auth redirect normalization lives in `apps/admin/src/lib/auth/origin.ts`
- Browser session readiness helper lives in `apps/admin/src/lib/auth/browser-session.ts`
- Change Feed UI lives in `apps/admin/src/app/(main)/changes/`
- Change Feed read APIs live in `apps/admin/src/app/api/change-feed/`
- YouTube chat follow-up paging route lives in `apps/admin/src/app/api/chat/youtube-coverage/`

### Command Palette & Filters
Each page has its **own** filter system (NOT shared):
- Games: `app/(main)/apps/lib/filter-registry.ts` + `app/(main)/apps/components/command-palette/`
- Companies: `app/(main)/companies/lib/filter-registry.ts` + `app/(main)/companies/components/command-palette/`

### Non-obvious File Mappings
- Cube models: 27 cubes across 9 files in `packages/cube/model/`
- `LatestMetrics` cube is inside `DailyMetrics.js` (NOT a separate file)
- `Apps.js` contains 5 cubes: Apps, AppPublishers, AppDevelopers, AppTrends, AppSteamDeck
- `Discovery.js` contains 5 cubes: Discovery, Genres, AppGenres, Tags, AppTags
- Chat LLM files: `apps/admin/src/lib/llm/` (tools, system prompt, providers, entity links)
- Tiger chat routing and YouTube prompt handling live in `apps/admin/src/lib/chat/tiger-shadow.ts`
- Direct-to-Tiger YouTube ingestion lives in `packages/youtube/`
- Tiger/R2 ingestion writer code lives primarily in `packages/database/src/tiger-writer.ts`, `packages/ingestion/src/workers/`, and `packages/ingestion/src/change-intel/`
- When modifying cubes, always update `cube-system-prompt.ts` too
- Change Feed SQL read surfaces are created by:
  - `20260315114500_add_change_feed_read_surfaces.sql`
  - `20260315143000_optimize_change_feed_news_rpc.sql`

---

## Database

### Scale (optimize all queries)

| Table | ~Rows |
|-------|-------|
| `apps` | 200K |
| `daily_metrics` | 15M+ |
| `ccu_snapshots` | 5M+ |
| `review_deltas` | 3M+ |
| `app_steam_tags` | 1.5M+ |

### Query Rules
1. **ALWAYS use LIMIT** - Start with `LIMIT 100` for exploration
2. **Use indexed columns** - `appid`, `metric_date`, `created_at`, `publisher_id`, `developer_id`
3. **Prefer materialized views** - Use `publisher_metrics`, `latest_daily_metrics` over raw aggregations
4. **Use RPC functions** - `get_companies_with_filters()`, `get_apps_with_filters()` are pre-optimized
5. **Avoid COUNT(\*)** - Use approximate counts or cached stats
6. **Time-bound queries** - Always filter `daily_metrics` and `ccu_snapshots` by date range

For full schema details (tables, views, enums, RPC functions, column schemas), see `.claude/skills/database-schema/`.

---

## Deployment

| Service | Platform |
|---------|----------|
| Dashboard | Vercel |
| Query API | Railway |
| PICS Service | Railway |
| Cube.js | Fly.io |
| YouTube sync | GitHub Actions + TigerData |
| Accepted ingestion/product-data writes | Tiger / Timescale + R2 |
| Supabase Auth / Session / Reference / Legacy Plane | Supabase |
| Tiger Contract Read Plane | Tiger / Timescale |

Environment variables: see `.env.example` files in `apps/admin/`, `packages/cube/`, `services/pics-service/`, and root `.env`.

---

## CLI Tools

| Tool | Use For |
|------|---------|
| `supabase` | Migrations, schema inspection, type generation |
| `psql` | Direct SQL queries (use full path: `/opt/homebrew/opt/libpq/bin/psql`) |

```bash
supabase gen types typescript --linked > packages/database/src/types.ts   # Type generation (safe)
supabase inspect db table-stats                                           # No Docker needed
supabase inspect db db-stats                                              # No Docker needed
```

**Docker required for:** `supabase db dump`, `supabase db push`, `supabase start`.

---

## Skills (loaded on demand)

Detailed domain knowledge is in `.claude/skills/` to keep this file focused on universal rules:

| Skill | When to use |
|-------|-------------|
| `.claude/skills/database-schema/` | Working on queries, schema changes, materialized views, RPC functions |
| `.claude/skills/chat-system/` | Working on AI chat, LLM tools, Cube.js integration, credit system |
| `.claude/skills/data-pipeline/` | Working on sync workers, ingestion, PICS service, rate limits |

Full documentation in `/docs/`.
