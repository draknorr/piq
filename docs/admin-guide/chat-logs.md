# Admin: Chat Query Logs

This guide covers the chat query logs section in the `/admin` dashboard.

## Access

Open `/admin` and expand the `Chat Logs` section.

The logs are visible to admins only.

## What It Shows

The dashboard shows the last 7 days of chat queries, including:

- query text
- tools used
- performance timing
- iteration counts
- phase-1 chat family
- quality flags
- guardrail trace summaries
- compact session carry-forward summaries
- answer contract summaries

## Log Fields

| Field | Description |
|-------|-------------|
| `Query` | The user’s original question |
| `Tools` | Which tools were called |
| `Tool Count` | Total number of tool calls |
| `Iterations` | How many LLM loops occurred |
| `Timing` | LLM, tools, and total runtime |
| `Family` | Route-level answer family |
| `Quality Flags` | Sparse/no-match/clarification/fallback signals |
| `Contract Summary` | The terminal answer contract for the turn |
| `Session Context` | Compact entity/constraint/candidate summary carried forward |
| `Guardrail Trace` | Why a follow-up tool call was allowed, blocked, or observed |
| `Timestamp` | When the query was made |

## How To Read the Timing

| Metric | What It Measures |
|--------|------------------|
| `LLM Time` | Time spent waiting for model responses |
| `Tools Time` | Time spent executing tools and queries |
| `Total Time` | End-to-end request time |

If a query is slow, check for:

- high iteration counts
- long-running tool calls
- sparse results that force follow-up tool calls
- repeated guardrail blocks

## Common Tool Patterns

| Pattern | Meaning |
|---------|---------|
| `lookup_publishers` → `query_analytics` | Specific publisher question |
| `lookup_games` → `get_game_change_timeline` | One-title change timeline |
| `get_recent_news_detail` | Latest news item for one title |
| `get_recent_news_digest` | Bounded recent-news summary |
| `search_recent_news_topics` | Cross-game topic search in stored news text |

## Retention

Chat logs are retained for 7 days and then cleaned up automatically.

If you need to clear them manually, run:

```sql
SELECT cleanup_old_chat_logs();
```

## Related Documentation

- [Chat Interface Guide](../user-guide/chat-interface.md)
- [Chat Data System Architecture](../developer-guide/architecture/chat-data-system.md)
- [Database Schema](../developer-guide/architecture/database-schema.md)
