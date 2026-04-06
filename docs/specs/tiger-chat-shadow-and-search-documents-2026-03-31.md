# Tiger Search Documents and Chat Shadow Routing

Date: March 31, 2026

> Historical note: this was the shadow-routing milestone before `searchDocuments` became ready and before Tiger-backed primary chat coverage expanded. Keep it as a milestone record, not as the current runtime description.

This note records the first Tiger-backed `/chat` shadow milestone after the
events/news reconciliation tooling landed.

## Scope

This implementation adds:

- `POST /v1/contracts/search-documents`
- a Tiger shadow evaluator inside `/api/chat/stream`
- end-of-stream SSE metadata so existing eval tooling can report whether a
  prompt matched a Tiger shadow path

This implementation does not yet:

- replace the legacy `/chat` answer path
- expose `searchDocuments` as a fully ready contract in `/v1/contracts`
- route rankings, catalog search, or metric history through Tiger shadow mode
- cut over the website or chat UI to Tiger-first answers

## SearchDocuments contract

Current request shape:

- `query`
- `entityUid?`
- `startTime?`
- `endTime?`
- `feedScopes?`
- `limit?`

Current behavior:

- searches `docs.steam_news_search_projection` with `websearch_to_tsquery`
- joins `docs.steam_news_items` for URL and feed metadata
- joins `apps` for game names
- optionally filters to a resolved Steam game entity
- returns metadata-first results with ranking and provenance

Current limits:

- default window: last `30` days
- maximum window: `90` days
- default limit: `8`
- maximum limit: `10`
- entity filter scope: Steam games only

Reason `searchDocuments` remains `planned` in `/v1/contracts`:

- the query implementation exists and is usable for shadow evals
- but the contract is intentionally not promoted to fully ready until the
  recurring `docs.steam_news_search_projection` reconcile loop is validated at
  exact parity during runtime checks

## Chat shadow routing

Current `/api/chat/stream` behavior:

- the user-visible answer still comes from the legacy tool stack
- after the answer is produced, the route can optionally run a Tiger shadow pass
- shadow execution is controlled by:
  - `CHAT_TIGER_SHADOW_MODE=off|eval|all`
  - `QUERY_API_BASE_URL`
  - `QUERY_API_BEARER_TOKEN`
  - `CHAT_TIGER_SHADOW_TIMEOUT_MS`

Current covered shadow families:

- `change_explanation`
  - resolves a Steam game entity from session context, recent tool results, or
    simple prompt extraction
  - calls Tiger `resolveEntities`
  - then calls Tiger `explainChanges`
- `news_search`
  - resolves a Steam game entity when possible
  - calls Tiger `resolveEntities` when an entity hint exists
  - then calls Tiger `searchDocuments`

Current SSE metadata:

- `message_end.tigerShadow`
  - `enabled`
  - `mode`
  - `matchedIntent`
  - `route`
  - `attempts[]`

Current route values:

- `disabled`
- `unmatched`
- `skipped`
- `shadow_success_legacy_answer`
- `shadow_failed_legacy_answer`

This makes the existing eval harness capable of measuring Tiger shadow coverage
without changing the browser-visible response path yet.

## Validation expectations

Repo validation for this milestone:

- `@publisheriq/data-plane` typecheck
- `@publisheriq/query-api` typecheck
- `@publisheriq/query-api` build
- `@publisheriq/admin` build

Runtime validation for this milestone should use:

- Tiger-backed `searchDocuments` requests against the live dev service
- `EVENTS_NEWS_SYNC_MODE=validate pnpm tiger:reconcile-events-news`
- end-to-end chat eval runs with `CHAT_TIGER_SHADOW_MODE=eval`

## Next step

The next step after this milestone is not another schema change. It is
operational validation:

1. run the new reconcile validate flow until docs projection parity is exact
2. exercise `searchDocuments` directly against Tiger
3. run end-to-end chat evals with Tiger shadow mode enabled
4. only then decide whether to promote `searchDocuments` from `planned` to
   `ready`
