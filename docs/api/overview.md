# API Documentation

This section covers the product-facing internal APIs and the external data sources PublisherIQ consumes.

## Internal APIs

| API | Purpose | Primary Backend |
|-----|---------|-----------------|
| Chat JSON and streaming | AI responses, contract execution, follow-up context, and turn metadata | Query API + Tiger-backed contracts |
| Dashboard internals | Pins, alerts, auth validation, and user state | Supabase session + tables/RPCs |
| Change Feed internals | Activity, detail, news, and status surfaces | Supabase RPCs and read surfaces |

## External Source APIs

| Source | Purpose | Guide |
|--------|---------|-------|
| Steam Web / Storefront / Reviews / CCU | Official Steam data | [Steam API](./steam-api.md) |
| SteamSpy | Owner and playtime enrichment | [Steam API](./steam-api.md) |

## Auth Model

Most internal APIs use the signed-in Supabase session cookie. Chat streaming also relies on an internal bearer-authenticated query-api hop for Tiger-backed contracts.

Common failure response:

```json
{
  "error": "unauthorized",
  "message": "Authentication required"
}
```

## Routing Split

- `/api/chat/*` is the system contract boundary for chat and related query workflows.
- `/api/change-feed/*` is Supabase-backed and serves the `/changes` experience.
- `/api/pins/*`, `/api/alerts/*`, and admin data routes remain Supabase-backed.

## Related Documentation

- [Internal API](./internal-api.md)
- [Streaming API](./streaming-api.md)
- [Sync Pipeline](../developer-guide/architecture/sync-pipeline.md)
