# Credit System Guide

This guide explains how chat billing works in PublisherIQ.

## Overview

Credits are consumed only when you use the AI chat. The final charge depends on:

- which chat tools ran
- how many model tokens were used
- the per-message minimum charge

Admins can add or remove credits from `/admin/users`.

## Current Tool Costs

These are the current per-tool charges in the chat runtime:

| Tool | Credits |
|------|---------|
| `lookup_publishers` | 4 |
| `lookup_developers` | 4 |
| `lookup_games` | 4 |
| `lookup_tags` | 4 |
| `query_analytics` | 8 |
| `query_change_activity` | 8 |
| `get_change_activity_detail` | 8 |
| `get_recent_news_detail` | 8 |
| `get_recent_news_digest` | 8 |
| `search_recent_news_topics` | 10 |
| `search_games` | 8 |
| `get_game_change_timeline` | 10 |
| `compare_change_before_after` | 12 |
| `search_by_concept` | 12 |
| `find_similar` | 12 |
| `discover_trending` | 12 |
| `screen_games` | 12 |
| `find_change_patterns` | 14 |

## Token Costs

| Token Type | Rate |
|------------|------|
| Input tokens | 2 credits per 1,000 tokens |
| Output tokens | 8 credits per 1,000 tokens |

Token costs are rounded up to whole credits.

## Minimum Charge And Reservation

| Setting | Value |
|---------|-------|
| Minimum charge per message | 4 credits |
| Default reservation | 25 credits |

PublisherIQ uses a reserve-then-finalize flow:

1. Reserve 25 credits before processing
2. Execute the chat request
3. Finalize the actual charge
4. Refund any unused reserved amount

If the request fails after reservation, the reservation is refunded.

## Final Cost Formula

```
total = tool credits + token credits
final charge = max(total, 4)
```

## Where You See Credit Usage

- Your current balance is visible on `/account`
- The chat stream can return `creditsCharged` in the final `message_end` event
- Admins can inspect aggregate usage on `/admin/usage`

## Common Outcomes

### Insufficient Credits

Chat requires at least 4 credits available before a request starts.

If the balance is too low, the API returns:

```json
{
  "error": "insufficient_credits",
  "message": "You don't have enough credits to use chat. Please contact your administrator.",
  "balance": 2
}
```

### Rate Limiting

If chat rate limiting blocks a request, the API returns:

```json
{
  "error": "rate_limited",
  "message": "Too many requests. Please try again later.",
  "retry_after": 60
}
```

The response also includes a `Retry-After` header.

## Credit Transaction Types

| Type | Description |
|------|-------------|
| `signup_bonus` | Initial credits on account creation |
| `admin_grant` | Manual credit addition |
| `admin_deduct` | Manual credit removal |
| `chat_usage` | Finalized chat charge |
| `refund` | Reservation refund after failure or cancellation |

## Getting More Credits

Administrators can adjust balances from `/admin/users` with an integer amount and a reason.

## Related Documentation

- [Account](./account.md)
- [Chat Interface](./chat-interface.md)
- [Admin Guide](../admin-guide/dashboard.md)
