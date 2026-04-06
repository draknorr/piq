# Credit System Guide

This guide explains how chat billing works in PublisherIQ.

## Overview

Credits are consumed only when you use the AI chat. The final charge depends on:

- which chat capabilities ran
- how many model tokens were used
- the per-message minimum charge

Admins can add or remove credits from `/admin/users`.

## Current Capability Costs

These are the current per-capability charges in the chat runtime:

| Capability | Credits |
|------------|---------|
| Title or entity lookup | 4 |
| Structured analytics | 8 |
| Change activity summary | 8 |
| Change detail | 8 |
| Recent news detail | 8 |
| Recent news digest | 8 |
| Recent news topic search | 10 |
| Games search and discovery | 8 |
| Game timeline | 10 |
| Before/after comparison | 12 |
| Concept search | 12 |
| Similarity search | 12 |
| Trend discovery | 12 |
| Change-pattern discovery | 14 |

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
total = capability credits + token credits
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
