# Internal API Reference

This document describes the internal endpoints used by the PublisherIQ dashboard.

## Authentication

Most dashboard endpoints require an authenticated Supabase session cookie.

The chat runtime also uses an internal bearer-authenticated hop to the query-api for Tiger-backed contracts.

Typical unauthenticated response:

```json
{
  "error": "unauthorized",
  "message": "Authentication required"
}
```

## Chat

### `POST /api/chat`

JSON response endpoint for callers that do not need SSE streaming.

### `POST /api/chat/stream`

Streaming chat endpoint using Server-Sent Events.

The route can combine:

- Tiger-backed query-api contracts for supported prompts
- legacy compatibility paths for unsupported prompts
- session carry-forward data for follow-up turns

The stream returns:

- `text_delta`
- `tool_start`
- `tool_result`
- `message_end`
- `error`

`message_end` includes timing data and may include:

- `debug`
- `quality`
- `sessionContext`
- `executionTrace`
- `followUpSuggestions`
- `renderData`
- `tigerPrimary`
- `tigerShadow`
- `usage`
- `creditsCharged`

### `POST /api/chat/eval`

Internal evaluation endpoint used by chat smoke tests and eval tooling.

## Change Feed

### `GET /api/change-feed/activity`

Returns the unified Steam activity stream used by `/changes`.

Important query params:

- `days`
- `view`
- `mode`
- `appTypes`
- `signals`
- `sort`
- `search`
- `cursor`
- `limit`

### `GET /api/change-feed/activity/[activityId]`

Returns expanded detail for one activity card, including:

- before / after diffs when available
- related announcements
- impact windows for grouped change activity

### `GET /api/change-feed/bursts`

Returns grouped change bursts.

Important query params:

- `days`
- `preset`
- `appTypes`
- `source`
- `search`
- `cursorTime`
- `cursorKey`
- `limit`

### `GET /api/change-feed/bursts/[burstId]`

Returns detail for one burst, including:

- individual change events
- related news
- impact windows

### `GET /api/change-feed/news`

Returns recent Steam news rows.

Important query params:

- `days`
- `appTypes`
- `search`
- `cursorTime`
- `cursorKey`
- `limit`

### `GET /api/change-feed/status`

Returns change-capture health state:

- `healthy`
- `catching_up`
- `delayed`

## Pins

### `GET /api/pins`

Fetch current user pins.

### `POST /api/pins`

Create a pin.

### `DELETE /api/pins/[id]`

Remove a pin.

### `GET /api/pins/check`

Check whether a specific entity is pinned.

### `GET` / `PUT` `/api/pins/[id]/alert-settings`

Read or update per-pin alert settings.

## Alerts

### `GET /api/alerts`

Fetch alerts for the current user.

### `GET /api/alerts/count`

Fetch unread alert count.

### `PUT /api/alerts/[id]/read`

Mark an alert as read.

### `DELETE /api/alerts/[id]`

Delete an alert.

### `GET` / `PUT` `/api/alerts/preferences`

Read or update global alert preferences.

## Auth Support

### `POST /api/auth/validate-email`

Checks whether an email is approved for sign-in before OTP delivery is attempted.

### `GET /api/auth/callback`

Server-side callback router that validates origin handling and forwards callback state to the client callback surface.

## Notes

- Change Feed endpoints return `503` when the required SQL read surfaces are not available yet.
- The unified activity list uses server-side cursor pagination when the new read surface is available and a legacy fallback when it is not.
- Chat endpoints should be debugged from the query details panel and execution trace when a Tiger-backed contract is involved.
- Protected-route UX redirects through `/login?next=...`; APIs return JSON errors instead of redirects.

## Related Documentation

- [Change Feed Feature](../developer-guide/features/change-feed.md)
- [Steam Change Intelligence](../developer-guide/workers/steam-change-intelligence.md)
