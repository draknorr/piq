# Chat Prompt Evals Runbook

This runbook covers the critique-suite workflows for the prompts called out in:

- `docs/chat-output-user-critique.md` section `1. Game Lookups and Filtered Discovery`
- `docs/chat-output-user-critique.md` section `2. Publisher, Developer, and Company Answers`
- `docs/chat-output-user-critique.md` section `3. Similarity and Comp-Finding Answers`
- `docs/chat-output-user-critique.md` section `4. Concept and Taste-Based Discovery`
- `docs/chat-output-user-critique.md` section `5. Trending and Time-Relative Answers`
- `docs/chat-output-user-critique.md` section `6. Change Intelligence and Strategic / Prospecting Answers`

Phase-1 quality work also adds a dedicated multi-turn suite for session-scoped carry-forward behavior.
The checked-in JSON inventory now feeds both the live eval wrapper and the deterministic admin-route tests in CI.

## What This Runner Does

Use one of the checked-in wrappers when you want a fresh live run against the production chat endpoint without rebuilding the prompt list by hand.

### Available Wrappers

| Scope | Script | Prompt Count |
|---|---|---:|
| Sections `1` and `2` | `scripts/chat-evals/run-critique-sections-1-2.mjs` | 23 |
| Sections `3` and `4` | `scripts/chat-evals/run-critique-sections-3-4.mjs` | 13 |
| Sections `5` and `6` | `scripts/chat-evals/run-critique-sections-5-6.mjs` | 18 |
| Multi-turn phase 1 | `scripts/chat-evals/run-multi-turn-phase1.mjs` | 6 scenarios |

Each wrapper:

- runs the exact hard-coded prompt set for its scope against `POST /api/chat/stream`
- reuses `scripts/chat-evals/run.mjs` for auth, transport, retries, SSE parsing, and raw capture
- writes a timestamped artifact folder under `/tmp/publisheriq-chat-evals/`
- generates a draft markdown run entry and a curation template so you can score the answers from the persona viewpoint

It does not try to auto-judge user quality. The raw results are machine-captured; the persona scoring in `docs/chat-prompt-evals.md` is curated after the run.

## Endpoint Quality Run

Use the full blended-persona endpoint run when you want the main quality ledger for
the old prompt inventory against the local Tigerdata-backed stack.

It differs from the wrapper scripts above in two ways:

- it runs the full old critique inventory plus the checked-in multi-turn phase-1 scenarios in one pass
- it writes draft blended-persona rankings for every old critique prompt and every checked-in multi-turn phase-1 scenario

Run it from the repo root:

```bash
pnpm chat-evals:full-blended-endpoint
```

Useful overrides:

```bash
pnpm chat-evals:full-blended-endpoint -- --max-prompts 3 --max-scenarios 1
```

```bash
pnpm chat-evals:full-blended-endpoint -- --manifest-only --out-dir /tmp/publisheriq-chat-evals/full-blended-manifest
```

Default behavior:

- targets the local admin chat endpoint at `http://127.0.0.1:3001` unless you pass `--origin`
- reuses the same `POST /api/chat/stream` path the chat UI calls
- authenticates with the same local bypass or magic-link flow used by the other endpoint eval wrappers
- scores the normalized final assistant text from SSE `text_delta` output; hidden Tiger metadata is saved only as diagnostics and is not used for ranking
- does not start `admin` or `query-api` for you in this first pass; if the origin is not reachable it fails fast with a preflight error

Artifacts include:

- `prompt-results.json`
- `scenario-results.json`
- `prompt-rankings.json`
- `scenario-rankings.json`
- `ledger-run-draft.md`
- `curation-template.json`
- `run-summary.json`
- `prompt-tool-traces.json`
- `scenario-tool-traces.json`
- `tool-usage-summary.json`
- `backend-usage-summary.json`
- `migration-matrix.json`
- `migration-matrix.md`

This is now the default quality pass for ranking the old prompt inventory on the new chat stack.
Keep using the older API/debug wrappers when you want lower-level transport, tool, or Tiger routing diagnostics.
The endpoint runner now also writes an answer-path audit for Tiger cutover work, including
which tools/contracts ran, which backends they hit, and which prompts still depend on
legacy Supabase or Cube reads.

## Browser Quality Run

Use the browser run when you specifically want a smaller user-visible smoke pass
through the real `/chat` UI.

```bash
pnpm chat-evals:full-blended-ui
```

Useful overrides:

```bash
pnpm chat-evals:full-blended-ui -- --max-prompts 3 --max-scenarios 1 --headed
```

Default behavior:

- starts its own local admin dev server on `http://127.0.0.1:3003`
- reuses local `query-api` if it is already healthy, otherwise starts one on the configured local base URL
- enables Tiger primary/shadow eval mode plus local browser bypass for the spawned admin server
- scores only the final assistant text rendered in the browser UI

Use this when you want UI-level confirmation. Keep the endpoint runner as the primary full-suite quality harness.

## Deterministic Coverage

The multi-turn phase-1 scenarios also have deterministic route tests under `apps/admin/src/app/api/chat/stream/`.
Those tests stub provider/tool behavior and assert session-context carry-forward without calling live OpenAI, Supabase, Qdrant, or production chat.
Keep `scripts/chat-evals/multi-turn-phase1-scenarios.json` as the canonical scenario inventory for both layers.

## Prerequisites

- Root `.env` must contain:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY`
  - `BYPASS_AUTH_EMAIL`
- `apps/admin/.env.local` should contain the local Tiger eval settings when you target localhost:
  - `CHAT_EVAL_LOCAL_BYPASS_ENABLED=true`
  - `CHAT_EVAL_SECRET`
  - `CHAT_EVAL_BYPASS_EMAIL` or `BYPASS_AUTH_EMAIL`
  - `CHAT_TIGER_PRIMARY_MODE=eval`
  - `QUERY_API_BASE_URL=http://127.0.0.1:4318`
- Local `admin` and `query-api` should already be running for `pnpm chat-evals:full-blended-endpoint` unless you point `--origin` at another reachable target
- Node `>=20`

## Run A Fresh Live Suite

From the repo root:

```bash
node scripts/chat-evals/run-critique-sections-1-2.mjs
```

Or for sections `3` and `4`:

```bash
node scripts/chat-evals/run-critique-sections-3-4.mjs
```

Or for sections `5` and `6`:

```bash
node scripts/chat-evals/run-critique-sections-5-6.mjs
```

Or for multi-turn phase-1 scenarios:

```bash
node scripts/chat-evals/run-multi-turn-phase1.mjs
```

Optional overrides:

```bash
CHAT_EVAL_ORIGIN=https://www.publisheriq.app \
CHAT_EVAL_CONCURRENCY=1 \
CHAT_EVAL_DELAY_MS=3000 \
node scripts/chat-evals/run-critique-sections-1-2.mjs --out-dir /tmp/publisheriq-chat-evals/manual-run
```

```bash
CHAT_EVAL_ORIGIN=https://www.publisheriq.app \
CHAT_EVAL_CONCURRENCY=1 \
CHAT_EVAL_DELAY_MS=3000 \
node scripts/chat-evals/run-critique-sections-3-4.mjs --out-dir /tmp/publisheriq-chat-evals/manual-run-3-4
```

```bash
CHAT_EVAL_ORIGIN=https://www.publisheriq.app \
CHAT_EVAL_CONCURRENCY=1 \
CHAT_EVAL_DELAY_MS=3000 \
node scripts/chat-evals/run-critique-sections-5-6.mjs --out-dir /tmp/publisheriq-chat-evals/manual-run-5-6
```

```bash
CHAT_EVAL_ORIGIN=https://www.publisheriq.app \
CHAT_EVAL_DELAY_MS=1000 \
node scripts/chat-evals/run-multi-turn-phase1.mjs --out-dir /tmp/publisheriq-chat-evals/manual-run-multi-turn
```

The wrapper prints the artifact paths when it finishes.

## Run The Local Tiger Shadow Expanded Pack

Use this when you want to validate the current Tiger shadow coverage for:

- catalog search
- entity ranking
- entity compare
- metric history
- news search
- change explanation
- semantic search

This pack stays on the real `/api/chat/stream` route, but it expects the local
admin app and local `query-api` to be running with Tiger shadow mode enabled.

### Required local env

In `apps/admin/.env.local`:

- `CHAT_TIGER_SHADOW_MODE=eval`
- `QUERY_API_BASE_URL=http://127.0.0.1:4318`
- `QUERY_API_BEARER_TOKEN`
- `CHAT_EVAL_LOCAL_BYPASS_ENABLED=true`
- `CHAT_EVAL_SECRET`
- `CHAT_EVAL_BYPASS_EMAIL` or `BYPASS_AUTH_EMAIL`

Note:

- the local eval loaders read root `.env` and `apps/admin/.env.local`
- they do not automatically read `.env.tiger.local`
- if your Tiger/query-api values currently live only in `.env.tiger.local`, copy or export `QUERY_API_BASE_URL`, `QUERY_API_BEARER_TOKEN`, and the local eval bypass vars before running the suite

### Preflight

1. Validate the current Tiger docs/events parity gate:

```bash
EVENTS_NEWS_SYNC_MODE=validate pnpm tiger:reconcile-events-news
```

2. Build the server surfaces used by the eval:

```bash
pnpm query-api:build
pnpm --filter @publisheriq/admin build
```

3. Start the local Tiger `query-api`:

```bash
pnpm query-api:dev
```

4. Start the local admin app in a second shell:

```bash
pnpm --filter @publisheriq/admin dev
```

### Run the bounded Tiger shadow pack

In a third shell:

```bash
pnpm chat-evals:tiger-shadow-expanded
```

Optional override:

```bash
CHAT_EVAL_ORIGIN=http://localhost:3001 \
CHAT_EVAL_DELAY_MS=1000 \
node scripts/chat-evals/run-tiger-shadow-expanded.mjs --out-dir /tmp/publisheriq-chat-evals/manual-tiger-shadow
```

### Expected outcomes

Positive prompts should end with Tiger shadow metadata showing:

- `matchedIntent=catalog_search`
- `matchedIntent=entity_ranking`
- `matchedIntent=entity_compare`
- `matchedIntent=metric_history`
- `matchedIntent=news_search`
- `matchedIntent=change_explanation`
- `matchedIntent=semantic_search`
- `route=shadow_success_legacy_answer`

Negative controls should stay:

- `route=unmatched`, or
- `route=skipped`

Use the `Tiger Shadow Coverage` section in the generated report to confirm
which families routed successfully and which prompts still need classifier or
translation fixes.

## Run The Local Tiger Primary Expanded Pack

Use this when you want Tiger to own the visible answer for the bounded eval-only
prompt family set:

- catalog search
- entity ranking
- entity compare
- metric history
- news search
- change explanation
- semantic search

This pack still goes through the real `/api/chat/eval` and `/api/chat/stream`
route, but it enables Tiger-primary eval mode and gates on `message_end.tigerPrimary`.

### Required local env

In `apps/admin/.env.local`:

- `CHAT_TIGER_PRIMARY_MODE=eval`
- `CHAT_TIGER_PRIMARY_TIMEOUT_MS=8000`
- `CHAT_TIGER_SHADOW_MODE=eval`
- `QUERY_API_BASE_URL=http://127.0.0.1:4318`
- `QUERY_API_BEARER_TOKEN`
- `CHAT_EVAL_LOCAL_BYPASS_ENABLED=true`
- `CHAT_EVAL_SECRET`
- `CHAT_EVAL_BYPASS_EMAIL` or `BYPASS_AUTH_EMAIL`

### Preflight

1. Validate the current Tiger docs/events parity gate:

```bash
EVENTS_NEWS_SYNC_MODE=validate pnpm tiger:reconcile-events-news
```

2. Build the server surfaces used by the eval:

```bash
pnpm query-api:build
pnpm --filter @publisheriq/admin build
```

3. Start local `query-api`:

```bash
pnpm query-api:dev
```

4. Start the local admin app in a second shell:

```bash
pnpm --filter @publisheriq/admin dev
```

### Run the bounded Tiger primary pack

In a third shell:

```bash
pnpm chat-evals:tiger-primary-expanded
```

Optional override:

```bash
CHAT_EVAL_ORIGIN=http://localhost:3001 \
CHAT_EVAL_DELAY_MS=1000 \
node scripts/chat-evals/run-tiger-primary-expanded.mjs --out-dir /tmp/publisheriq-chat-evals/manual-tiger-primary
```

### Expected outcomes

Positive prompts should end with Tiger primary metadata showing:

- `matchedIntent=catalog_search`
- `matchedIntent=entity_ranking`
- `matchedIntent=entity_compare`
- `matchedIntent=metric_history`
- `matchedIntent=news_search`
- `matchedIntent=change_explanation`
- `matchedIntent=semantic_search`
- `route=primary_success`

Negative controls should stay:

- `route=unmatched`

Use the `Tiger Primary Coverage` section in the generated report to confirm
which prompts are ready for Tiger-owned visible answers in eval mode and which
still need fallback.

## Rebuild Draft Artifacts From An Existing Run

If the raw run already exists and you only want the draft markdown plus curation template again:

```bash
node scripts/chat-evals/run-critique-sections-1-2.mjs \
  --from-results /tmp/publisheriq-chat-evals/critique-sections-1-2-<timestamp>
```

```bash
node scripts/chat-evals/run-critique-sections-3-4.mjs \
  --from-results /tmp/publisheriq-chat-evals/critique-sections-3-4-<timestamp>
```

## Re-Test Only The Prompts You Changed

Use the generic runner when you want a targeted verification pass instead of a full wrapper suite.

1. Create a temporary include file in the same `critiqueId | prompt` format:

```text
89 | Which indie developers have multiple hit games?
140 | Publishers with 5+ games averaging 85%+ reviews in the past 3 years
141 | Highly rated games under $10 released in the past year
152 | What tags exist for colony sim games?
170 | What publishers are similar to Devolver Digital?
```

2. Run the subset against the target environment:

```bash
env \
  CHAT_EVAL_ORIGIN=https://www.publisheriq.app \
  CHAT_EVAL_INCLUDE_PROMPTS_FILE=/tmp/publisheriq-chat-evals/fix-under-5/include-prompts.txt \
  CHAT_EVAL_OUT_DIR=/tmp/publisheriq-chat-evals/fix-under-5/run \
  CHAT_EVAL_DOC_PATH=/tmp/publisheriq-chat-evals/fix-under-5/report.md \
  CHAT_EVAL_CONCURRENCY=1 \
  CHAT_EVAL_DELAY_MS=3000 \
  node scripts/chat-evals/run.mjs
```

3. For app-code verification before deploy, point the runner at local Next instead:

```bash
pnpm --filter @publisheriq/admin dev
```

Then in a second shell:

```bash
env \
  CHAT_EVAL_ORIGIN=http://localhost:3001 \
  CHAT_EVAL_INCLUDE_PROMPTS_FILE=/tmp/publisheriq-chat-evals/fix-under-5/include-prompts.txt \
  CHAT_EVAL_OUT_DIR=/tmp/publisheriq-chat-evals/fix-under-5/local-run \
  CHAT_EVAL_DOC_PATH=/tmp/publisheriq-chat-evals/fix-under-5/local-report.md \
  CHAT_EVAL_CONCURRENCY=1 \
  CHAT_EVAL_DELAY_MS=1000 \
  node scripts/chat-evals/run.mjs
```

4. If you only want the first prompt in the include file, add:

```bash
CHAT_EVAL_MAX_PROMPTS=1
```

## What Gets Written

Each run folder contains:

- `include-prompts.txt`: the exact prompts sent to the generic runner
- `manifest.json`: the generic runner manifest
- `results.json`: full structured results, tool calls, timings, and raw assistant text
- `report.md`: the generic runner's raw markdown report
- `ledger-run-draft.md`: scope-specific draft with persona metadata and placeholder curation fields
- `curation-template.json`: blank score/rationale template for manual evaluation
- `run-summary.json`: condensed metadata and timings for quick inspection

Multi-turn scenario runs also record per-turn carried `sessionContext` summaries and guardrail/quality payloads inside `results.json`.

## Updating docs/chat-prompt-evals.md

Use this process after a fresh run:

1. Run the wrapper and note the artifact folder.
2. Review `ledger-run-draft.md` and `results.json`.
3. Score each prompt from the assigned primary persona's standpoint using the critique rubric:
   - `Directness`
   - `Completeness`
   - `Relevance`
   - `Trustworthiness`
   - `Decision value / usefulness`
   - `Grace under ambiguity`
4. Append a new run section to `docs/chat-prompt-evals.md` and update the run index at the top.
5. Keep the full assistant output and tool calls for each prompt so later runs can be compared directly.

Use `docs/chat-prompt-evals.md` for live-environment ledger entries.
Use local targeted reruns as implementation verification and only promote them into the live ledger after the corresponding deployment is live.

## Current Suite Inventory

The checked-in wrappers hard-code these prompt IDs:

- Section 1: `2`, `10`, `21`, `138`, `141`, `219`, `242`
- Section 2: `89`, `97`, `127`, `130`, `140`, `151`, `152`, `155`, `156`, `157`, `161`, `170`, `171`, `175`, `178`, `179`
- Section 3: `51`, `49`, `132`, `134`, `170`, `171`, `190`
- Section 4: `18`, `195`, `19`, `186`, `42`, `229`
- Section 5: `158`, `181`, `102`, `244`, `248`
- Section 6: `87`, `88`, `139`, `221`, `222`, `20`, `46`, `48`, `54`, `253`, `254`, `255`, `256`

If the critique doc changes, update the suite array in the corresponding wrapper:

- `scripts/chat-evals/run-critique-sections-1-2.mjs`
- `scripts/chat-evals/run-critique-sections-3-4.mjs`
- `scripts/chat-evals/run-critique-sections-5-6.mjs`

If the multi-turn follow-up scenarios change, update:

- `scripts/chat-evals/multi-turn-phase1-scenarios.json`
- `scripts/chat-evals/run-multi-turn-phase1.mjs`

## Current Quality Guardrails

When you re-run the weak prompts, judge them against these product decisions:

- `indie` company screens:
  - treat `indie` as a heuristic, not a legal ownership claim
  - prefer mostly self-published studios with small catalogs
  - use a small-catalog cap around `10` games
  - use the Steam `Indie` tag only as supporting weight or a tie-breaker
- company trailing release windows:
  - recent company release-window screens only support the trailing past year today
  - if a prompt asks for `past 2 years`, `past 3 years`, etc., the answer should say that limitation directly instead of bluffing a broader screen
- broad filtered discovery with quality language:
  - start at `>=1000` reviews
  - relax once to `>=100` reviews if needed
  - do not drop below `100` reviews just to fill the table
  - when the relaxed floor is used, say so briefly
- tag-discovery answers:
  - answer with the canonical tag first
  - add adjacent tags the user would likely explore next
- company similarity:
  - one peer is not a complete peer set
  - if semantic peers are sparse, prefer a labeled heuristic portfolio fallback
  - if the final peer set is still sparse, say it is limited instead of padding with weak matches
- game similarity:
  - hard constraints like `better reviews`, `under 10K reviews`, and `Steam Deck` must be visibly obeyed
  - add a short per-row fit reason when the answer claims similarity
  - avoid lexical contamination from title words like `Hades`, `Hollow`, or `Souls`
- franchise / same-series answers:
  - stay inside the franchise first
  - if adjacent `Souls-like` or neighbor titles are added, split them into a clearly labeled secondary section
  - never blur `same series` into `similar to` without saying so
- concept and taste discovery:
  - treat prompts like `beautiful art`, `tactical deck building`, and `investigation horror` as concept interpretation tasks, not keyword matching
  - prefer quality floors and representative titles over filling the table with low-signal lexical matches
  - if the semantic set is weak, say that directly instead of padding with `Deck`, `Rogue`, `Pixel`, or `Investigation` title collisions

## Deployment Notes

- Changes in `apps/admin/src/lib/chat/**` affect the app layer immediately in local Next, but not production until the admin app is deployed.
- Changes in `packages/cube/model/ChatCatalog.js` affect company-screen query availability only after the Cube service is deployed.
- If a local targeted rerun still shows old company-screen behavior on production-backed data, check whether the app deploy, Cube deploy, or both are still pending before re-scoring the live ledger.
