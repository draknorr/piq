# Personalized Dashboard Guide

This guide explains how to use the personalization features in PublisherIQ, including pinning items, viewing your dashboard, and configuring alerts.

---

## Overview

The personalized dashboard lets you:

- **Pin** games, publishers, and developers you care about
- **View at-a-glance metrics** for pinned items in one place
- **Receive automatic alerts** when significant changes occur
- **Customize alert preferences** to match your needs

---

## Pinning Items

### Where to Find the Pin Button

The **Pin** button appears on entity detail pages:

- **Games**: `/apps/{appid}` - Pin any game to track its metrics
- **Unreleased Games**: `/unreleased` - Use Watch from a row or the detail drawer to track upcoming games
- **Publishers**: `/publishers/{id}` - Pin publishers to track their portfolio
- **Developers**: `/developers/{id}` - Pin developers to track their releases

Use `/companies` to browse publishers and developers; pinning still happens from the entity detail pages.

### How to Pin

1. Navigate to a game, publisher, or developer detail page
2. Click the **Pin** button in the header area
3. The button changes to **Pinned** (blue) when active

### How to Unpin

1. Navigate to the pinned item's detail page
2. Click the **Pinned** button
3. The item is removed from your dashboard

### Requirements

- You must be signed in to pin items
- Each user has their own private pin list

---

## My Dashboard Tab

### Accessing the Dashboard

1. Go to the **Insights** page
2. Click the **My Dashboard** tab (first tab)

### What You'll See

#### Recent Alerts Section
Shows your 5 most recent alerts with:
- Alert type icon (color-coded by type)
- Alert title and description
- Entity name
- Time since alert was created
- Severity indicator (left border color)

Click an alert to navigate to the related entity.

#### Pinned Items Section
Displays all your pinned items in a responsive grid.

**For Games:**
| Metric | Description |
|--------|-------------|
| CCU | Current concurrent users with 24-hour change % |
| Reviews | Total review count with positive percentage |
| Price | Current price with discount if applicable |
| Trend | 30-day trend direction (Up/Down/Stable) |

**For Publishers/Developers:**
Currently shows entity name and type. Full metrics coming in a future update.

---

## How Alerts Work

### Alert Types

| Type | Trigger | Description |
|------|---------|-------------|
| **CCU Spike** | +50% above 7-day average | Significant increase in concurrent players |
| **CCU Drop** | -50% below 7-day average | Significant decrease in concurrent players |
| **Trend Reversal** | Direction changed | 30-day trend flipped from up to down or vice versa |
| **Review Surge** | 3x normal velocity | Unusually high review activity |
| **Sentiment Shift** | +/-5% change | Positive review ratio changed significantly |
| **Price Change** | Any change | Price or discount percentage changed |
| **New Release** | Publisher/developer ships game | A pinned publisher or developer released a new title |
| **Milestone** | Review count threshold | Crossed 10K, 50K, 100K, 500K, or 1M reviews |

### When Alerts Are Generated

- **Hourly**: CCU anomalies, trend reversals, review surges, sentiment shifts, milestones
- **Real-time**: Price changes (via database trigger)
- **Real-time**: New releases from pinned publishers/developers (via database trigger)

### Severity Levels

| Level | Visual Indicator | Examples |
|-------|-----------------|----------|
| **High** | Red left border | CCU spike >100%, discount >50%, 100K+ milestone |
| **Medium** | Yellow left border | Standard threshold breaches |
| **Low** | Subtle border | Minor price changes |

### Alert Deduplication

To prevent spam, each alert type can only fire once per day per entity per user. If a condition persists, you'll receive a new alert the next day.

### Viewing and Dismissing Alerts

- **View**: Click an alert to navigate to the entity and mark it as read
- **Dismiss**: Hover over an alert and click the X button to remove it
- **Badge**: The bell icon in the sidebar shows your unread alert count

---

## Configuring Preferences

### Accessing Preferences

1. Go to **Insights** > **My Dashboard**
2. Click the **gear icon** next to "Recent Alerts"

### Global Toggle

**Enable Alerts** - Master switch to turn all alerts on or off.

### Alert Type Toggles

Enable or disable specific alert types:

- CCU Spikes
- CCU Drops
- Trend Reversals
- Review Surges
- Sentiment Shifts
- Price Changes
- New Releases
- Milestones

### Sensitivity Sliders

Adjust how sensitive the detection is for certain alert types:

| Setting | Range | Effect |
|---------|-------|--------|
| **CCU Changes** | 0.5x - 2.0x | Lower = fewer alerts, Higher = more alerts |
| **Review Surges** | 0.5x - 2.0x | Lower = fewer alerts, Higher = more alerts |
| **Sentiment Shifts** | 0.5x - 2.0x | Lower = fewer alerts, Higher = more alerts |

**How sensitivity works:**
- **0.5x (Less)**: Requires 2x the normal change to trigger an alert
- **1.0x (Default)**: Standard threshold behavior
- **2.0x (More)**: Triggers alerts on half the normal change

### Saving Preferences

Click **Save Changes** to apply your settings. Changes take effect immediately for new alerts.

---

## Per-Pin Settings

Override global preferences for individual pinned items:

### Accessing Per-Pin Settings

1. Go to **Insights** > **My Dashboard**
2. Find the pinned item you want to customize
3. Click the **gear icon** on the card

### What You Can Customize

- Enable/disable alerts for this specific item
- Adjust sensitivity sliders (CCU, review, sentiment)
- Toggle specific alert types on/off

### Inheritance

- Fields left at "Inherit" use your global preferences
- Custom settings override global values
- Reset to defaults by toggling off custom settings

---

## Toast Notifications

Throughout PublisherIQ, toast notifications provide feedback for user actions.

### How They Work

Toasts appear in the bottom-right corner of the screen and automatically dismiss after 4 seconds.

### Toast Types

| Type | Appearance | Example Messages |
|------|------------|------------------|
| **Success** | Green icon, green tint | "Pinned to dashboard", "Export complete" |
| **Error** | Red icon, red tint | "Failed to pin", "Export failed" |
| **Info** | Blue icon, blue tint | "10 games selected", "Loading..." |

### Behavior

- **Auto-dismiss**: Toasts disappear after 4 seconds
- **Manual dismiss**: Click the X button to close immediately
- **Stacking**: Multiple toasts stack vertically
- **Animation**: Toasts slide in from the right

### When You'll See Toasts

| Action | Toast Type | Message |
|--------|------------|---------|
| Pin an item | Success | "Pinned to dashboard" |
| Unpin an item | Success | "Removed from dashboard" |
| Pin fails | Error | "Failed to pin" |
| Export completes | Success | "Export downloaded" |
| Bulk pin | Success | "{n} items pinned" |
| Save view | Success | "View saved" |

---

## Tips and Best Practices

### What to Pin

- **Competitors**: Track games in your market segment
- **Your titles**: Monitor your own games' performance
- **Trending discoveries**: Pin interesting finds from the Insights tabs
- **Upcoming opportunities**: Watch promising games from `/unreleased`
- **Key publishers**: Stay informed about major players in your space

### Managing Alerts

- Start with default sensitivity, adjust based on alert volume
- Disable alert types you don't care about to reduce noise
- Check the dashboard daily to stay informed

### Performance

- Pinned items load metrics in a single query for fast performance
- Alert detection runs hourly without affecting dashboard speed
- The alert badge polls every 60 seconds

---

## Related Documentation

- [Insights Page](./insights-page.md) - My Dashboard and analytics tabs
- [Games Page](./games-page.md) - Bulk pin from game lists
- [Unreleased Games](./unreleased-games.md) - Watch upcoming games
- [Companies Page](./companies-page.md) - Bulk pin companies
- [Architecture Documentation](../developer-guide/features/personalization.md) - Technical details
- [v2.4 Release Notes](../releases/v2.4-personalization.md) - Full feature changelog
