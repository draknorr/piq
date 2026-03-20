# Chat Prompt Evals Runbook

This runbook covers the critique-suite workflows for the prompts called out in:

- `docs/chat-output-user-critique.md` section `1. Game Lookups and Filtered Discovery`
- `docs/chat-output-user-critique.md` section `2. Publisher, Developer, and Company Answers`
- `docs/chat-output-user-critique.md` section `3. Similarity and Comp-Finding Answers`
- `docs/chat-output-user-critique.md` section `4. Concept and Taste-Based Discovery`

## What This Runner Does

Use one of the checked-in wrappers when you want a fresh live run against the production chat endpoint without rebuilding the prompt list by hand.

### Available Wrappers

| Scope | Script | Prompt Count |
|---|---|---:|
| Sections `1` and `2` | `scripts/chat-evals/run-critique-sections-1-2.mjs` | 23 |
| Sections `3` and `4` | `scripts/chat-evals/run-critique-sections-3-4.mjs` | 13 |

Each wrapper:

- runs the exact hard-coded prompt set for its scope against `POST /api/chat/stream`
- reuses `scripts/chat-evals/run.mjs` for auth, transport, retries, SSE parsing, and raw capture
- writes a timestamped artifact folder under `/tmp/publisheriq-chat-evals/`
- generates a draft markdown run entry and a curation template so you can score the answers from the persona viewpoint

It does not try to auto-judge user quality. The raw results are machine-captured; the persona scoring in `docs/chat-prompt-evals.md` is curated after the run.

## Prerequisites

- Root `.env` must contain:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY`
  - `BYPASS_AUTH_EMAIL`
- Network access to `https://www.publisheriq.app`
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

The wrapper prints the artifact paths when it finishes.

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

If the critique doc changes, update the suite array in the corresponding wrapper:

- `scripts/chat-evals/run-critique-sections-1-2.mjs`
- `scripts/chat-evals/run-critique-sections-3-4.mjs`

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
