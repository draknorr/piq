# Unreleased Games Guide

This guide explains how to use the Unreleased Games page in PublisherIQ to find upcoming Steam games, inspect launch signals, and build a watchlist.

> **Related Documentation:**
> - [Unreleased Games Architecture](../developer-guide/features/unreleased-games.md)
> - [Personalization](./personalization.md)

---

## Overview

The Unreleased Games page at `/unreleased` is a launch-tracking workspace for Steam games that are not out yet.

Use it to:

- find upcoming, undated, and stale-date games
- sort by Opportunity Score, latest added, release date, latest update, news, tags, and media readiness
- filter by publisher/developer, adult content, release timing, tags, genres, features, platforms, and recent activity
- review screenshots, trailers, Steam news, and change timelines in the detail drawer
- watch games by pinning them to your PublisherIQ dashboard
- export selected or visible rows to CSV

## Table Layout

The left side of each row has selection and actions:

- checkbox: select the game for export
- Details: open the game detail drawer
- Watch: pin the game to your PublisherIQ dashboard

The default data columns are:

| Column | What It Shows |
|--------|---------------|
| Opp Score | 0-100 Opportunity Score |
| Game | title, Steam link, and PublisherIQ app link |
| Release | parsed release date, raw Steam text, and days until release |
| Added | when the app entered the upcoming-game dataset |
| Publisher / Developer | primary publisher and developer, with Steam links when available |
| Latest Update | latest captured storefront or metadata change |
| News | latest Steam news item |
| Tags / Features | primary tags and Steam feature categories |
| Media | screenshot and trailer counts |

## Opportunity Score

Opportunity Score is a 0-100 signal for games that may deserve publisher, BD, marketing, or investment review. It combines:

- release timing: near-term future dates score higher, undated games still receive a smaller timing signal
- recent activity: storefront changes and Steam announcements in the last 30 days
- store completeness: screenshots, trailers, tags, genres, categories, and pricing/free-state readiness
- publisher fit: no-publisher, self-published, and small-publisher games receive more opportunity weight

The column header includes an info tooltip with the short methodology.

## Filters

The page keeps filters in the URL so views are shareable.

Common filters:

| Filter | Use |
|--------|-----|
| Search | title, app ID, publisher, or developer |
| Adult content | exclude adult games by default, include them, or show only adult games |
| Release status | future dated, undated, or stale past-date records |
| Publisher status | no publisher, self-published, small publisher, or established publisher |
| Release window | minimum and maximum days until release |
| Activity | recent changes, 30d change counts, news recency, signal families |
| Media | has screenshots, has trailers |
| Commercial | free, purchase packages, Workshop support |
| Taxonomy | genres, tags, categories/features, platforms |

Taxonomy and platform filters support both all-match and any-match behavior.

## Presets

Preset chips apply useful starting points:

- Opportunity Radar: high scoring games with adult content hidden
- Launch Window: upcoming games with a near-term dated release
- News Active: games with recent Steam news
- No Publisher: games without a separate listed publisher
- Undated Watchlist: active games without a clean future release date
- Media Ready: games with captured screenshots or trailers

## Column Customization

Use the Columns control to choose which data columns appear and in what order.

Column settings:

- are stored in the `columns` URL parameter
- preserve the same sorting behavior when a visible column is sortable
- keep selection, row actions, and game identity locked outside the customization list
- control the order of exported CSV fields

Reset returns to the default column set.

## Export

Click Export Visible to download the current rows, or select rows and click Export Selected.

CSV exports always include:

- `appid`
- `name`
- `steam_url`
- `publisheriq_url`

Visible data columns are then exported in the same order shown in the table. If a visible column expands to multiple fields, such as Release or Activity Counts, those fields are exported together.

## Detail Drawer

Open Details from any row to inspect a game without leaving the list.

### Overview

Shows the header image, core stats, publisher/developer, tags, features, media counts, and quick actions.

### Media

Shows available screenshots and trailers. Images are contained inside fixed frames so unusually wide, tall, or cropped assets remain visible instead of being cut off.

### Timeline

Combines captured Steam change events and Steam news into one chronological view. Change events show readable summaries and expandable before/after payloads when available.

### News

Lists recent Steam news items. News links use the stable Steam store news route when a Steam GID is available, which avoids empty Steam community announcement pages.

## Watching Games

Click Watch from a row or the drawer header to pin the game. Watched games use the existing PublisherIQ pins system and appear in personalization surfaces such as Insights > My Dashboard.

Requirements:

- you must be signed in
- the watch state is private to your account
- `/unreleased` checks visible rows in bulk so table watch state loads quickly

## Troubleshooting

If the page shows a missing projection error, the Tiger projection has not been applied or refreshed for the environment:

```text
Tiger projection metrics.unreleased_games_projection is not available.
Apply 0084_unreleased_games_page_projection.sql before using /unreleased.
```

Ask an operator to apply the Tiger bootstrap SQL during an approved maintenance window. The page does not apply Tiger SQL automatically.

## Related Documentation

- [Unreleased Games Architecture](../developer-guide/features/unreleased-games.md)
- [Games Page](./games-page.md)
- [Change Feed](./change-feed.md)
- [Personalization](./personalization.md)
- [v2.14 Release Notes](../releases/v2.14-unreleased-games.md)
