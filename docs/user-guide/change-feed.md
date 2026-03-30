# Change Feed Guide

Steam Activity at `/changes` is the unified feed for recent storefront, PICS, media, and Steam news activity.

## What the Page Shows

The page has three modes:

- `All activity` mixes grouped change cards and announcement cards
- `Changes only` hides announcement-only cards
- `Announcements only` shows just Steam posts

It also has five views:

| View | What it emphasizes |
|------|--------------------|
| `Overview` | Most relevant recent activity across Steam |
| `Launch Watch` | Upcoming titles, recent launches, and release-date movement |
| `Commercial Moves` | Pricing, discount, package, and monetization shifts |
| `Store Refreshes` | Copy, artwork, screenshots, trailers, tags, and presentation changes |
| `All Activity` | The raw stream in recency order |

Each activity card includes:

- app name and app type
- whether the title is upcoming
- a readable headline and summary
- signal pills such as `Release`, `Pricing`, `Store page`, `Media`, `Platform`, `Build activity`, and `Announcement`
- expandable before / after detail when available

Expanding a card shows:

- the actual before / after evidence
- related announcements
- impact windows when enough response data exists

## Filters

You can narrow the feed by:

- time range: `24h`, `7d`, or `30d`
- mode
- view
- app type
- signal family
- search by app name, headline, or theme
- sort order

## Status Badge

The page shows a capture-health badge:

| State | Meaning |
|-------|---------|
| `healthy` | capture is current |
| `catching_up` | backlog or freshness needs attention |
| `delayed` | capture is materially behind |

The badge is a monitoring hint, not a guarantee that every event is present.

## Best Uses

- monitor unreleased games for launch-prep activity
- spot pricing, release-date, or merchandising changes quickly
- review announcement cadence alongside product changes
- scan the broader market as a live exploration surface

## Related Documentation

- [Getting Started](./getting-started.md)
- [Chat Interface Guide](./chat-interface.md)
- [Change Feed Developer Guide](../developer-guide/features/change-feed.md)
- [Steam Change Intelligence](../developer-guide/workers/steam-change-intelligence.md)
