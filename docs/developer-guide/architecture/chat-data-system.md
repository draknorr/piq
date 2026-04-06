# Chat Data System

This document describes the current PublisherIQ chat runtime after the Tiger/query-api cutover.

**Last Updated:** April 6, 2026

## Summary

The canonical `/chat` path is now contract-first:

- the admin app handles auth, rate limiting, credit reservation, streaming, and logging
- `query-api` is the contract boundary for TigerData-backed reads
- TigerData serves the current contract families for catalog discovery, momentum, semantic retrieval, change/news analysis, user context, and continuation
- Cube and direct Supabase reads still exist only as compatibility paths for prompt families that have not yet moved to typed contracts

## Current Architecture

```text
User
  -> /api/chat/stream
  -> prompt interpretation + rollout checks
  -> Tiger primary evaluation
  -> query-api contracts
  -> TigerData
  -> rendered answer + SSE metadata

Alongside:
  - Supabase for auth, credits, chat logs, and current page/control-plane data
  - optional compatibility reads through Cube or legacy Supabase helpers
```

## Request Lifecycle

### 1. Session and request setup

`/api/chat/stream` owns:

- authenticated session validation
- chat rate limiting
- credit reservation and finalize/refund billing
- session-context carry-forward
- SSE event emission

### 2. Prompt interpretation

The chat runtime interprets the user prompt into a contract-oriented path whenever possible.

That includes:

- entity resolution
- overview/detail questions
- broad catalog discovery
- momentum screens
- similarity and concept search
- change/news analysis
- portfolio or pinned-item context
- continuation prompts like `show me more` or `same set but ...`

### 3. Tiger primary evaluation

When the current rollout mode allows it, the request is evaluated against Tiger-backed contracts first.

Important rollout data captured in the stream and logs includes:

- matched intent
- route outcome
- attempted contract names
- primary/shadow reasons
- cohort / rollout mode

### 4. Compatibility fallback when needed

If a prompt family still depends on older logic, the route may use compatibility code that hits:

- Cube.js
- Supabase RPCs
- Supabase tables

This is no longer the preferred architecture. It is transitional behavior.

### 5. Rendering and logging

The final turn writes:

- streamed text deltas
- timing information
- quality metadata
- execution traces
- contract summaries
- follow-up suggestions
- updated session context
- token usage and credits charged when available

## Current Contract Surface

The live contract registry currently includes:

| Contract | Purpose |
|---------|---------|
| `resolveEntities` | resolve fuzzy game/publisher/developer references |
| `getEntityOverview` | current overview for one entity plus optional related games |
| `getRelatedEntities` | DLC, franchise, and related-entity expansion |
| `searchCatalog` | broad catalog discovery with typed filters |
| `discoverMomentum` | breakout, current-player, and momentum-style ranking |
| `searchChangeActivity` | cross-game change discovery |
| `discoverChangePatterns` | marketing/relaunch/response pattern discovery |
| `rankEntities` | ranking for games or companies |
| `compareEntities` | structured entity comparison |
| `traceMetricHistory` | bounded historical metric traces |
| `explainChanges` | single-entity change/news explanation |
| `searchDocuments` | news/document search |
| `semanticSearch` | concept and similarity search |
| `getUserContext` | pins, alerts, and portfolio-aware context |
| `continueResultSet` | contract-backed conversational continuation |

## Contract Families in Practice

### Entity and overview

Used for:

- title lookups
- company overview questions
- `tell me about X`
- portfolio/game-list follow-ups

### Catalog and momentum

Used for:

- broad game search
- ranked discovery
- current-player prompts
- breakout and momentum screens

### Semantic retrieval

Used for:

- `games like X`
- taste / concept prompts
- filtered semantic comparisons

### Change and news

Used for:

- what changed recently
- recent announcement and topic search
- cross-game change discovery
- change-pattern discovery

### User context and continuation

Used for:

- portfolio / pinned-item prompts
- alert-aware prompts
- `show me more`
- `same set but only ...`

## Current Compatibility Reality

The chat runtime still carries some compatibility logic around older internal tool families.

### Already Tiger-backed in practice

These prompt families are now intended to land on Tiger-backed contracts:

- similarity and concept search
- momentum discovery and screening
- cross-game change discovery
- change-pattern discovery
- document/news search
- result continuation

### Still transitional / compatibility-owned

These areas still have meaningful compatibility behavior or legacy traces:

- generic dashboard-style analytics prompts
- some single-title change timeline flows
- older Supabase or Cube-backed helper paths

The rule for documentation is:

- document the contract-first path as canonical
- mention compatibility only as legacy/transitional context

## Streaming Metadata

The `message_end` event now carries the current runtime summary, not just raw timing.

### Current important fields

| Field | Meaning |
|------|---------|
| `timing` | end-to-end timing summary |
| `debug` | stream iteration and delta counts |
| `quality` | turn-level quality and guardrail summary |
| `sessionContext` | carry-forward state for the next turn |
| `executionTrace` | backend and migration trace for tools/contracts used |
| `followUpSuggestions` | suggested next prompts |
| `renderData` | structured render metadata for the UI |
| `tigerPrimary` | primary-evaluation route and attempt data |
| `tigerShadow` | shadow-evaluation route and attempt data |
| `usage` | token usage when available |
| `creditsCharged` | finalized charge when available |

## Execution Trace Model

Execution traces are now one of the most important internal debugging surfaces.

They capture:

- whether a read happened
- which backend kinds were used
- which data sources were touched
- whether a path is already Tiger-backed or still compatibility-owned
- which Tiger contracts should own that prompt family

Backend kinds currently include:

- `tiger_query_api`
- `cube`
- `supabase_sql`
- `supabase_rpc`
- `supabase_table`

Migration dispositions include:

- `already_tiger`
- `cut_over_now`
- `needs_tiger_contract`
- `disable_instead_of_port`
- `keep_legacy_temporarily`

## Chat Logging

Chat logs in Supabase remain the admin-facing operational record for each turn.

Important stored fields include:

- query text
- tool names and counts
- timing summaries
- chat family
- quality flags
- session context summary
- guardrail trace
- answer contract summary

These logs are used for:

- regression debugging
- rollout validation
- latency analysis
- identifying prompts still hitting legacy reads

## Rate Limiting and Credits

The chat route still enforces:

- a database-backed rate limit check before reservation
- reserve-then-finalize credit billing
- refund on failure/cancellation

This is a Supabase/control-plane concern, not a TigerData concern.

## Operational Checks

When debugging the current chat stack, inspect these layers in order:

1. `/api/chat/stream` request and SSE metadata
2. query details panel in the UI
3. admin chat logs
4. `query-api` health, readiness, and contract registry
5. TigerData parity and refresh state
6. compatibility traces showing Cube/Supabase fallback

## Related Documentation

- [Streaming API](../../api/streaming-api.md)
- [Internal API](../../api/internal-api.md)
- [TigerData Operating Model](./tigerdata-operating-model.md)
- [System Overview](./overview.md)
- [Query API README](../../../apps/query-api/README.md)
