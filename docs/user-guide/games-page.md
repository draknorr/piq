# Games Page Guide

This guide explains how to use the Games page in PublisherIQ to discover, filter, compare, and export game data.

> **Related Documentation:**
> - [Games Page Architecture](../developer-guide/features/games-page.md)
> - [v2.6 Release Notes](../releases/v2.6-games-page.md)

---

## Overview

The Games page at `/apps` lets you:

- **Discover** Steam games using powerful presets and filters
- **Filter** by metrics, growth, sentiment, engagement, and more
- **Compare** up to 5 games side-by-side
- **Export** data as CSV or JSON
- **Save** filter configurations as named views

> **Naming Note:** The page displays "Games" in the UI, but uses `/apps` as the URL route for technical consistency with the database.

---

## Getting Started

### Accessing the Page

Navigate to **Games** from the main navigation, or go directly to `/apps`.

### Default View

By default, you'll see:
- Games only (excludes DLC and demos)
- Sorted by **Peak CCU** (descending)
- 10 default columns visible (including Momentum and Sparkline)
- 50 games per page

## Pricing Notes

Price display on the Games and app-detail surfaces is storefront-first:

- the current effective price prefers storefront-backed `apps.current_price_cents` and falls back to the latest summary price only when storefront price is missing
- the sale badge only appears when the app is paid and a real current price is known
- free apps do not show a discount badge even if stale discount data exists

---

## Game Type Toggle

Switch between viewing different content types.

| Option | Description |
|--------|-------------|
| **All Types** | Shows all apps (games, DLC, demos) |
| **Games** | Games only (default) |
| **DLC** | Downloadable content only |
| **Demos** | Demos only |

**URL:** `?type=game`, `?type=all`, `?type=dlc`, or `?type=demo`

---

## Searching

Use the search bar to find games by name:

1. Click the search bar to focus
2. Type the game name
3. Results filter as you type (400ms debounce)

**Features:**
- Case-insensitive matching
- Partial name matching (e.g., "counter" matches "Counter-Strike 2")
- Clear button (×) to reset search

---

## Command Palette

The command palette provides unified filtering through a single interface. Press **⌘K** (Mac) or **Ctrl+K** (Windows/Linux) to open it.

### Home View

When opened, you'll see:
- **Search input** with filter syntax parsing
- **Presets** (6 visible, expandable to all 12)
- **Quick Filters** grouped by category
- **Genre chips** (8 visible, browse for more)
- **Browse navigation** to Tags, Genres, Categories

### Filter Syntax Examples

Type directly in the search input:

| Expression | Result |
|------------|--------|
| `ccu > 50000` | Games with 50K+ players |
| `score >= 90` | 90%+ positive reviews |
| `ccu 1000-50000` | CCU between 1K and 50K |
| `price < 20` | Under $20 |
| `free` | Free-to-play games |
| `genre:action` | Action games |
| `tag:roguelike` | Games with roguelike tag |
| `deck:verified` | Steam Deck verified |
| `rising stars` | Apply preset by name |

### Keyboard Navigation

| Key | Action |
|-----|--------|
| **↑** / **↓** | Navigate through options |
| **Enter** | Apply selection |
| **Escape** | Close or go back |
| **Backspace** (empty) | Return to home view |

### Active Filter Bar

Applied filters appear as color-coded chips below the filter bar:

| Color | Category |
|-------|----------|
| **Purple** | Presets (Rising Stars, High Momentum) |
| **Coral** | Quick Filters (Popular, Trending) |
| **Blue** | Metric filters (CCU, reviews, score) |
| **Green** | Content filters (tags, genres, categories) |
| **Orange** | Platform filters (Steam Deck, platforms) |
| **Amber** | Release filters (time periods, age) |
| **Pink** | Relationship filters (publisher, developer) |

Click any chip to modify, or click **X** to remove.

---

## Using Preset Views

Presets are pre-configured filter combinations for common discovery patterns.

### Available Presets

| Preset | What It Shows | Use Case |
|--------|---------------|----------|
| **Top Games** | Games with 1,000+ CCU, sorted by CCU | Find most-played games |
| **Rising Stars** | Growing games (25%+) under 500K owners | Find emerging hits |
| **Hidden Gems** | Highly rated (90%+) games under 50K owners | Discover undiscovered gems |
| **New Releases** | Games released in last 30 days | Stay current on launches |
| **Breakout Hits** | New games (90 days) with 50%+ growth | Catch explosive launches |
| **🔥 High Momentum** | Strong trajectory (15+ momentum, 500+ CCU) | Identify games "taking off" |
| **📈 Comeback Stories** | Improving sentiment (5%+) with 1K+ reviews | Find recovering games |
| **🌲 Evergreen** | Classic games (2+ years) still thriving | Find timeless hits |
| **💎 True Gems** | Highly rated with engaged community | Discover passionate fanbases |
| **💰 Best Value** | Most entertainment per dollar | Find value-for-money games |
| **🏆 Publisher's Best** | Outperforming publisher's average | Find publisher standouts |
| **🆓 F2P Leaders** | Top free-to-play games | Track F2P market |

### How to Use

1. Click a preset button in the filter bar
2. Filters and sort order are automatically applied
3. Click again to deactivate

**Note:** Presets are exclusive - selecting one clears other presets and filters.

---

## Quick Filters

Quick filters are stackable toggles that can be combined with AND logic:

| Filter | Criteria |
|--------|----------|
| **Popular** | 1,000+ concurrent players |
| **Trending ↑** | 10%+ weekly growth |
| **Well Reviewed** | 85%+ positive reviews |
| **Free** | Free-to-play games |
| **Indie** | Small publisher (<10 games) |
| **Steam Deck** | Verified or Playable on Steam Deck |
| **Momentum ↑** | Momentum score 10+ |
| **Sentiment ↑** | Sentiment improving (3%+ delta) |
| **Workshop** | Has Steam Workshop support |
| **Early Access** | Currently in Early Access |
| **On Sale** | Currently discounted |
| **This Week** | Released in last 7 days |

### How to Use

1. Click one or more quick filter buttons
2. Filters stack (e.g., "Popular" + "Trending" shows games with both)
3. Click an active filter to remove it

**Tip:** Combine quick filters with presets for powerful queries.

---

## Advanced Filters

Click **Advanced Filters** to expand the full filter panel with 9 categories.

### Metric Filters

Set minimum and/or maximum values for core metrics:

| Metric | Description |
|--------|-------------|
| Peak CCU | Highest concurrent users (24h) |
| Owners | Estimated total owners |
| Reviews | Total review count |
| Review Score | Positive review percentage |
| Price | Current effective price in dollars, using storefront-first fallback |
| Playtime | Average playtime in hours |

### Growth Filters

Filter by CCU growth percentage:

| Filter | Time Period |
|--------|-------------|
| CCU Growth (7d) | Week-over-week change |
| CCU Growth (30d) | Month-over-month change |
| Momentum | Combined growth + velocity signal |

**Preset Buttons:**
- **Growing**: 10%+ growth
- **Stable**: Between -10% and +10%
- **Declining**: Below -10%

### Sentiment Filters

Filter by review sentiment changes:

| Filter | Description |
|--------|-------------|
| Sentiment Delta | Change in positive review percentage |
| Velocity Tier | Review activity level (High/Medium/Low/Dormant) |

**Preset Buttons:**
- **Improving**: 3%+ sentiment increase
- **Stable**: Between -3% and +3%
- **Declining**: Below -3%
- **Bombing**: Below -10% (review bomb)

### Engagement Filters

Filter by engagement metrics:

| Metric | Description |
|--------|-------------|
| Active Player % | What % of owners are playing now |
| Review Rate | Reviews per 1,000 owners |
| Value Score | Hours of entertainment per dollar |

### Content Filters

Filter by game content characteristics:

#### Genres
- Select one or more genres
- Mode toggle: **Any** (OR) vs **All** (AND)

#### Tags
- Searchable dropdown with tag counts
- Shows how many games have each tag

#### Categories/Features
- Checkbox grid of Steam categories
- E.g., Single-player, Multiplayer, VR Support

#### Workshop
- Toggle to require Steam Workshop support

### Platform Filters

| Filter | Options |
|--------|---------|
| **Platforms** | Windows / Mac / Linux (with Any/All mode) |
| **Steam Deck** | Verified / Playable / Unsupported |
| **Controller** | Full / Partial support |

### Release Filters

| Filter | Description |
|--------|-------------|
| Period | Presets: 7d, 30d, 90d, year, 2024, 2023... |
| Age | Min/max days since release |
| Early Access | Filter by Early Access status |
| Hype Duration | Pre-release marketing period (days) |

### Relationship Filters

Filter by publisher/developer context:

| Filter | Description |
|--------|-------------|
| Publisher Search | Find games by publisher name |
| Developer Search | Find games by developer name |
| Self-Published | Publisher = Developer |
| vs Publisher Avg | Performance vs publisher's catalog average |
| Publisher Size | Indie (<5) / Mid (5-20) / Major (20+) |

### Activity Filters

| Filter | Description |
|--------|-------------|
| CCU Tier | Hot (Tier 1) / Active (Tier 2) / Quiet (Tier 3) |

---

## Customizing Columns

### Column Customizer

Click the **Columns** button to open a dropdown panel for toggling column visibility.

### How It Works

1. Click **Columns** button in the toolbar
2. A dropdown appears with checkboxes for each column
3. Check/uncheck to show/hide columns
4. Changes apply immediately to the table

### Closing the Customizer

- Click outside the dropdown
- Press **Escape**
- Click the **Columns** button again

### Column Visibility Persistence

Column selections are preserved:
- **In URL**: Refreshing keeps your choices, sharing URL shares configuration
- **In Saved Views**: Views remember which columns were visible

### Showing/Hiding Columns

1. Click the **Columns** button
2. Check/uncheck columns to show/hide by category
3. Changes apply immediately and persist in URL

### Available Columns (33 Total)

| Category | Columns |
|----------|---------|
| **Core** | Rank, Name |
| **Engagement** | Avg Playtime, Playtime 2w, Active Player % |
| **Reviews** | Reviews, Score %, Velocity 7d/30d, Velocity Tier, Sentiment Δ, Review Rate |
| **Growth** | Peak CCU, Growth 7d/30d, Momentum, Acceleration, Sparkline |
| **Financial** | Price, Discount, Owners, Value Score |
| **Context** | Publisher, Developer, vs Publisher Avg, Publisher Games |
| **Timeline** | Release Date, Days Live, Hype Duration |
| **Platform** | Steam Deck, Platforms, Controller |
| **Activity** | CCU Tier |

### Default Columns

Rank, Name, Peak CCU, Growth 7d, Momentum, Owners, Reviews, Price, Release, Sparkline

---

## Bulk Actions Bar

When you select one or more games, a floating action bar appears at the bottom of the screen.

### Appearance

The bar slides up from the bottom-center of the viewport with a subtle animation.

### Elements

| Element | Description |
|---------|-------------|
| **Selection count** | Blue badge showing number of selected games ("9+" if 9 or more) |
| **Compare button** | Opens compare mode (enabled for 2-5 selections) |
| **Export button** | Opens export dialog with "selected only" pre-selected |
| **Clear button** | Deselects all games |

### Button States

**Compare button:**
- Disabled if fewer than 2 games selected (tooltip: "Select at least 2 games to compare")
- Disabled if more than 5 games selected (tooltip: "Select up to 5 games to compare")
- Enabled for 2-5 selections

### Accessibility

- Selection count is announced to screen readers via `aria-live="polite"`
- Tooltips explain why buttons are disabled
- Focus management returns to table after actions

---

## Understanding Computed Metrics

### Momentum Score

Combined signal showing both player count AND review activity trajectory.

| Score | Display | Meaning |
|-------|---------|---------|
| ≥20 | 🚀🚀 | Explosive momentum |
| 10-19 | 🚀 | Strong momentum |
| 0-9 | ↗ | Positive trajectory |
| -9 to 0 | → | Flat |
| -19 to -10 | ↘ | Declining |
| ≤-20 | 📉 | Severe decline |

**Formula:** (CCU Growth 7d + Velocity Acceleration) / 2

### Sentiment Delta

Change in review sentiment over time.

| Change | Display | Meaning |
|--------|---------|---------|
| ≥+10% | ⬆ Surging | Major improvement |
| +3% to +9% | ↑ Improving | Getting better |
| -3% to +3% | → Stable | No change |
| -9% to -3% | ↓ Declining | Getting worse |
| ≤-10% | ⬇ Review Bomb | Major decline |

### Other Insight Metrics

| Metric | What It Shows |
|--------|---------------|
| **Active Player %** | Engagement depth (CCU ÷ Owners × 100) |
| **Review Rate** | Community engagement (Reviews per 1K owners) |
| **Value Score** | Entertainment per dollar (Playtime ÷ Price) |
| **vs Publisher Avg** | Performance vs publisher's catalog |

---

## Sorting

### How to Sort

1. Click any sortable column header
2. Click again to reverse sort direction
3. Arrow indicates current sort: ↑ (ascending) / ↓ (descending)

### Sortable Columns

Most columns support server-side sorting:
- Name, Peak CCU, Owners, Reviews, Score, Price, Release Date
- Growth 7d/30d, Momentum, Sentiment Delta
- Active %, Review Rate, Value Score, vs Publisher Avg

---

## Comparing Games

Compare 2-5 games side-by-side to analyze differences and make informed decisions.

### Selecting Games

1. Check the checkbox next to each game you want to compare
2. Select between 2 and 5 games
3. A floating **Bulk Actions Bar** appears at the bottom

**Selection limits:**
- Minimum: 2 games (compare button disabled with fewer)
- Maximum: 5 games for comparison
- Maximum: 50 games total selection (for export)

### Shift+Click Range Selection

Speed up selection with range clicks:
1. Click a checkbox to select the first game
2. Hold **Shift** and click another checkbox
3. All games between the two clicks are selected

### Opening Compare Mode

1. Select 2-5 games
2. Click **Compare** in the bulk actions bar
3. A full-screen comparison modal opens

### Understanding the Comparison Table

The comparison displays games as columns and metrics as rows.

#### Column Layout

| Column | Description |
|--------|-------------|
| **Metric** | Row labels for each metric |
| **Game 1** | First selected game (baseline for % calculations) |
| **Game 2-5** | Additional games with % difference from baseline |
| **vs Avg** | How the baseline compares to the group average |

#### Visual Indicators

| Indicator | Meaning |
|-----------|---------|
| **Green background** | Best value in the row |
| **Red background** | Worst value in the row |
| **Green % text** | Better than baseline |
| **Red % text** | Worse than baseline |
| **"Baseline" badge** | First game used for % calculations |

#### Metrics Compared

The comparison shows metrics grouped by category:

**Engagement:**
- Peak CCU, Owners, Active Player %

**Reviews:**
- Total Reviews, Score %, Velocity 7d/30d, Review Rate

**Growth:**
- Growth 7d/30d, Momentum, Sentiment Delta

**Financial:**
- Price, Discount %, Value Score

### Managing the Comparison

- **Remove a game**: Click the **X** next to any game name
- **Close modal**: Click **Close** button, **X** icon, or press **Escape**
- **Click outside**: Clicking the backdrop closes the modal

### Sharing Comparisons

Comparisons are URL-encoded for sharing:

```
/apps?compare=730,1245620,553850
```

This URL will:
1. Load the games page
2. Automatically open compare mode with those games
3. Show the exact same comparison to anyone with the link

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Escape** | Close compare mode |
| **Shift+Click** | Range select multiple games |

---

## Exporting Data

### Opening the Export Dialog

Two ways to access export:
1. **Toolbar**: Click **Export** button in the main toolbar (exports filtered results)
2. **Bulk Actions Bar**: When games are selected, click **Export** (option to export selected only)

### Export Options

The export dialog provides four settings:

#### Format
| Option | Description |
|--------|-------------|
| **CSV** | Comma-separated values, opens in Excel/Sheets |
| **JSON** | JavaScript Object Notation, for programmatic use |

#### Export Scope
| Option | Description |
|--------|-------------|
| **All filtered results** | Exports all games matching current filters |
| **Selected only** | Exports only checked games (requires selection) |

#### Column Options
| Option | Description |
|--------|-------------|
| **Visible columns only** | Only columns currently shown in the table |
| **All columns** | All 33 available metrics regardless of visibility |

#### Filter Metadata
When enabled for CSV exports, adds header comments with:
- Timestamp of export
- Applied filters description
- Total record count

### File Naming

Files are automatically named:
- **Filtered**: `games-filtered-2024-01-15.csv`
- **Selected**: `games-selected-2024-01-15.csv`

### Keyboard Shortcuts

- **`Escape`**: Close export dialog without exporting

### Tips

- Export visible columns when creating focused reports
- Export all columns when doing comprehensive analysis
- Use JSON format for importing into databases or scripts
- CSV metadata is useful for audit trails

---

## Saving Views

Save your current filter configuration for later reuse.

### What Gets Saved

When you save a view, the following settings are preserved:
- All applied filters (quick filters and advanced filters)
- Visible columns and their order
- Sort field and direction
- Content type (All/Games/DLC/Demos)

### Saving a View

1. Set up your desired filters, columns, and sort
2. Click **Saved Views** dropdown
3. Click **Save Current View**
4. Enter a name (e.g., "My Watchlist")
5. Click **Save**

### Loading a View

1. Click **Saved Views** dropdown
2. Click on a saved view name
3. All settings are restored: filters, columns, sort, and type

### Managing Views

| Action | How To |
|--------|--------|
| **Rename** | Click the pencil icon, edit inline, press Enter |
| **Delete** | Click the trash icon |

### Storage Details

| Setting | Value |
|---------|-------|
| **Storage location** | Browser localStorage |
| **Storage key** | `publisheriq-apps-saved-views` |
| **Maximum views** | 10 per browser |
| **Data persistence** | Survives browser restart |

**Important limitations:**
- Views are **browser-specific** (not synced across devices)
- Views are **user-specific** (not shared between accounts in same browser)
- Clearing browser data will delete saved views

### Tips

- Name views descriptively: "Indie RPGs under $20" instead of "View 1"
- Save frequently-used filter combinations to avoid rebuilding them
- Export view data via browser DevTools if you need to back up views

---

## Understanding Sparklines

The CCU Sparkline column shows a 7-day CCU trend visualization:

- **Green line:** Upward trend (>5% increase)
- **Red line:** Downward trend (>5% decrease)
- **Blue line:** Stable

Sparklines load as you scroll (lazy loading).

---

## Tips & Best Practices

### Finding Breakout Games
1. Apply **Breakout Hits** preset, OR
2. Set **Min Growth 7d** to 50% and **Max Age** to 90 days

### Finding Hidden Gems
1. Apply **Hidden Gems** preset, OR
2. Set **Min Score** to 90%, **Max Owners** to 50K, **Min Reviews** to 100

### Finding Games to Cover (Content Creators)
1. Apply **High Momentum** preset
2. Add **Well Reviewed** quick filter
3. Focus on Momentum and Sentiment columns

### Finding Comeback Stories
1. Apply **Comeback Stories** preset
2. Sort by Sentiment Delta descending
3. Look for games with positive sentiment and high review counts

### Finding Best Value Games
1. Apply **Best Value** preset
2. Add **Well Reviewed** quick filter
3. Sort by Value Score

### Competitive Analysis
1. Search for competitor games by name
2. Select them with checkboxes
3. Click **Compare** to see side-by-side metrics

### For Export Reports
1. Apply filters to narrow down games
2. Customize columns for the metrics you need
3. Export as CSV for spreadsheet analysis

### For Recurring Analysis
1. Set up your filters once
2. Save as a named view
3. Load the view each time you return

---

## URL Parameters Reference

All filters are stored in the URL for bookmarking and sharing. This enables:
- **Bookmarks**: Save complex queries as browser bookmarks
- **Sharing**: Send the full URL to colleagues for the exact same view
- **Deep linking**: Link directly to filtered results from external tools

### Core Parameters

| Parameter | Type | Values | Description |
|-----------|------|--------|-------------|
| `type` | string | `all`, `game`, `dlc`, `demo` | Content type filter (default: `game`) |
| `sort` | string | See sortable columns | Sort field |
| `order` | string | `asc`, `desc` | Sort direction (default: `desc`) |
| `search` | string | any text | Name search filter |
| `limit` | number | 1-100 | Results per page (default: 50) |
| `offset` | number | 0+ | Pagination offset |

### Metric Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `minCcu` / `maxCcu` | number | Peak concurrent users range |
| `minOwners` / `maxOwners` | number | Estimated owners range |
| `minReviews` / `maxReviews` | number | Total review count range |
| `minScore` / `maxScore` | number | Review score percentage (0-100) |
| `minPrice` / `maxPrice` | number | Current price in dollars |
| `minPlaytime` / `maxPlaytime` | number | Average playtime in hours |

### Growth Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `minGrowth7d` / `maxGrowth7d` | number | 7-day CCU growth percentage |
| `minGrowth30d` / `maxGrowth30d` | number | 30-day CCU growth percentage |
| `minMomentum` / `maxMomentum` | number | Momentum score |

### Sentiment Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `minSentimentDelta` / `maxSentimentDelta` | number | Sentiment change percentage |
| `velocityTier` | string | `high`, `medium`, `low`, `dormant` |

### Engagement Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `minActivePct` | number | Minimum active player percentage |
| `minReviewRate` | number | Minimum reviews per 1K owners |
| `minValueScore` | number | Minimum entertainment value score |

### Content Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `genres` | string | Comma-separated genre IDs (e.g., `1,2,3`) |
| `genreMode` | string | `any` (OR) or `all` (AND, default) |
| `tags` | string | Comma-separated tag IDs |
| `tagMode` | string | `any` (OR) or `all` (AND, default) |
| `categories` | string | Comma-separated category IDs |
| `hasWorkshop` | boolean | `true` to require Workshop support |

### Platform Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `platforms` | string | Comma-separated: `windows`, `mac`, `linux` |
| `platformMode` | string | `any` (OR) or `all` (AND, default) |
| `steamDeck` | string | `verified`, `playable`, `unsupported` |
| `controller` | string | `full`, `partial` |

### Release Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `minAge` / `maxAge` | number | Days since release |
| `releaseYear` | number | Specific release year (e.g., `2024`) |
| `earlyAccess` | boolean | `true` for Early Access only |
| `minHype` / `maxHype` | number | Pre-release hype duration in days |

### Relationship Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `publisherSearch` | string | Filter by publisher name (partial match) |
| `developerSearch` | string | Filter by developer name (partial match) |
| `selfPublished` | boolean | `true` for self-published games |
| `minVsPublisher` | number | Minimum vs publisher average % |
| `publisherSize` | string | `indie` (<5), `mid` (5-20), `major` (20+) |

### Activity Filters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ccuTier` | number | `1` (Hot), `2` (Active), `3` (Quiet) |

### Compare Mode

| Parameter | Type | Description |
|-----------|------|-------------|
| `compare` | string | Comma-separated appids (e.g., `730,1245620,553850`) |

### Example URLs

**Top free-to-play games:**
```
/apps?minCcu=1000&maxPrice=0&sort=ccu_peak&order=desc
```

**Steam Deck verified indie games with high ratings:**
```
/apps?steamDeck=verified&publisherSize=indie&minScore=85
```

**Rising games released this year:**
```
/apps?releaseYear=2024&minGrowth7d=25&sort=momentum_score
```

**Compare specific games:**
```
/apps?compare=730,1245620,553850
```

---

## Related Documentation

- [Keyboard Shortcuts](./keyboard-shortcuts.md) - All application shortcuts
- [Global Search](./search.md) - Quick search with ⌘K
- [Companies Page](./companies-page.md) - Publisher and developer analytics
- [Personalization](./personalization.md) - Pinning and alerts
- [Games Page Architecture](../developer-guide/features/games-page.md) - Technical details
- [v2.6 Release Notes](../releases/v2.6-games-page.md) - Full feature list
- [v2.7 Release Notes](../releases/v2.7-design-command-palette.md) - Command Palette and Design System
