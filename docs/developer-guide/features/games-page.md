# Games Page Architecture

This document describes the technical architecture of the Games page in PublisherIQ.

**Last Updated:** May 7, 2026

---

## Overview

The Games page (`/apps`) is a powerful game discovery and analytics dashboard. It follows the architectural patterns established by the Companies page (v2.5) with game-specific features and novel computed insight metrics.

This page is Tiger-backed today. The admin server reads TigerData through `runTigerQuery`, preferring `metrics.apps_page_projection` when present and using direct Tiger SQL for supported fallback paths. It does not use Supabase RPCs for the main game list.

**Key Capabilities:**
- Browse games, DLC, and demos with type toggle
- 12 preset views for common discovery patterns
- 12 stackable quick filters
- 9 advanced filter categories with 40+ parameters
- 33 customizable columns across 9 categories
- 6 computed insight metrics
- Side-by-side comparison of 2-5 games
- CSV/JSON export with configurable columns
- Saved views for filter configurations

---

## Architecture

### Component Hierarchy

```
/apps/
├── page.tsx                          # Server component - data fetching, param parsing (~150 LOC)
├── error.tsx                         # Error boundary (~40 LOC)
├── loading.tsx                       # Loading skeleton (~60 LOC)
│
├── [appid]/
│   ├── page.tsx                      # Game detail page
│   └── AppDetailSections.tsx         # Detail page sections
│
├── components/
│   ├── AppsPageClient.tsx            # Main client orchestrator (~400 LOC)
│   ├── AppsTable.tsx                 # Desktop table + mobile cards (~600 LOC)
│   ├── AppTypeToggle.tsx             # All/Games/DLC/Demos toggle (~80 LOC)
│   ├── UnifiedFilterBar.tsx          # Presets + quick filters combined
│   ├── PresetViews.tsx               # Preset buttons row
│   ├── QuickFilters.tsx              # Quick filter toggles
│   ├── SearchBar.tsx                 # Name search with debounce
│   ├── AdvancedFiltersPanel.tsx      # Collapsible filter panel
│   ├── SummaryStatsBar.tsx           # Aggregate stats display
│   ├── ColumnSelector.tsx            # Column visibility dropdown
│   ├── MethodologyTooltip.tsx        # Column info tooltips
│   ├── BulkActionsBar.tsx            # Selection action bar
│   ├── CompareMode.tsx               # Side-by-side comparison modal
│   ├── ExportDialog.tsx              # Export options dialog
│   ├── SavedViews.tsx                # Save/load filter views
│   ├── DataFreshnessFooter.tsx       # Data sync status
│   ├── EmptyState.tsx                # No-results messaging
│   └── FilterPill.tsx                # Active filter display
│   │
│   ├── cells/
│   │   ├── GrowthCell.tsx            # Color-coded growth indicator
│   │   ├── MomentumCell.tsx          # Momentum score indicator
│   │   ├── SentimentCell.tsx         # Sentiment delta indicator
│   │   ├── SparklineCell.tsx         # Lazy-loaded CCU sparklines
│   │   ├── ValueScoreCell.tsx        # Value score display
│   │   ├── VsPublisherCell.tsx       # vs Publisher avg indicator
│   │   ├── VelocityCell.tsx          # Review velocity display
│   │   ├── ControllerCell.tsx        # Controller support badge
│   │   ├── CCUTierCell.tsx           # CCU tier badge
│   │   └── AccelerationCell.tsx      # Velocity acceleration indicator
│   │
│   └── filters/
│       ├── MetricRangeFilters.tsx    # 6 metric min/max ranges
│       ├── GrowthFilters.tsx         # Growth metric ranges with presets
│       ├── SentimentFilters.tsx      # Sentiment delta filters with presets
│       ├── EngagementFilters.tsx     # Engagement metric filters
│       ├── ContentFilters.tsx        # Genres/tags/categories
│       ├── PlatformFilters.tsx       # Platform/Steam Deck/controller
│       ├── ReleaseFilters.tsx        # Time period/age/early access
│       ├── RelationshipFilters.tsx   # Publisher/developer filters
│       ├── ActivityFilters.tsx       # CCU tier filters
│       ├── GenreTagFilter.tsx        # Multi-select with counts
│       └── DualRangeSlider.tsx       # Dual-handle range input
│
├── hooks/
│   ├── useAppsFilters.ts             # URL-based filter state (~1,320 LOC)
│   ├── useAppsSelection.ts           # Row selection with shift+click (~162 LOC)
│   ├── useAppsCompare.ts             # Compare mode state (~109 LOC)
│   ├── useSavedViews.ts              # localStorage view persistence (~139 LOC)
│   ├── useFilterCounts.ts            # Lazy-load filter option counts (~100 LOC)
│   └── useSparklineLoader.ts         # IntersectionObserver sparklines (~150 LOC)
│
└── lib/
    ├── apps-types.ts                 # TypeScript interfaces
    ├── apps-queries.ts               # Tiger query wrappers + formatters
    ├── apps-columns.ts               # 33 column definitions
    ├── apps-presets.ts               # 12 presets + 12 quick filter definitions
    ├── apps-methodology.ts           # Column methodology text
    ├── apps-compare.ts               # 17 comparison metric definitions
    ├── apps-compare-utils.ts         # URL parsing utilities
    └── apps-export.ts                # CSV/JSON export formatting
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Server Component (page.tsx)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Parse URL search params (type, sort, filters, columns, compare)          │
│  2. Validate and type-cast all parameters                                    │
│  3. Build AppsFilterParams object                                            │
│  4. Parallel data fetching:                                                  │
│     ├── getApps(filterParams)              → App[]                          │
│     ├── getAggregateStats(filterParams)    → AggregateStats                 │
│     └── getAppsByIds(compareIds)           → App[] (if compare param)       │
│  5. Pass data to AppsPageClient                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Client Component (AppsPageClient)                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  Hooks:                                                                      │
│  ├── useAppsFilters()       → Filter state, URL sync, 40+ params            │
│  ├── useAppsSelection()     → Row selection state (max 50)                  │
│  ├── useAppsCompare()       → Compare mode state (2-5 games)                │
│  ├── useSavedViews()        → Saved view management (max 10)                │
│  ├── useFilterCounts()      → Filter dropdown counts (5-min cache)          │
│  └── useSparklineLoader()   → Batch sparkline loading                       │
│                                                                              │
│  Renders:                                                                    │
│  ├── AppTypeToggle                                                           │
│  ├── SearchBar                                                               │
│  ├── PresetViews + QuickFilters (UnifiedFilterBar)                          │
│  ├── AdvancedFiltersPanel                                                    │
│  ├── SummaryStatsBar (aggregate stats)                                      │
│  ├── ColumnSelector + SavedViews                                            │
│  ├── AppsTable                                                               │
│  ├── BulkActionsBar (when selections active)                                │
│  ├── CompareMode (when comparing)                                           │
│  ├── ExportDialog (when exporting)                                          │
│  └── DataFreshnessFooter                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## State Management

### URL-First Architecture

All filter state is persisted in URL parameters for bookmarking and sharing:

```
/apps?type=game&sort=ccu_peak&order=desc
     &preset=rising_stars
     &filters=popular,trending
     &minCcu=1000&maxOwners=500000
     &minGrowth7d=10&minScore=85
     &genres=1,5&genreMode=all
     &platforms=windows,mac
     &steamDeck=verified
     &columns=rank,name,ccu_peak,momentum_score,reviews
     &compare=730,1245620
```

### useAppsFilters Hook

Central state management hook (~1,320 LOC):

```typescript
const {
  // Current filter state
  isPending,
  type,
  sort,
  order,
  search,
  activePreset,
  activeQuickFilters,

  // Metric filter values (40+ parameters)
  minCcu, maxCcu, minOwners, maxOwners,
  minReviews, minScore, minPrice, maxPrice,
  minGrowth7d, maxGrowth7d, minMomentum,
  minSentimentDelta, maxSentimentDelta,
  minActivePct, minReviewRate, minValueScore,

  // Content filters
  genres, genreMode, tags, tagMode,
  categories, hasWorkshop,

  // Platform filters
  platforms, platformMode, steamDeck, controller,

  // Release filters
  minAge, maxAge, releaseYear, earlyAccess, minHype, maxHype,

  // Relationship filters
  publisherSearch, developerSearch,
  selfPublished, minVsPublisher, publisherSize,

  // Activity filters
  ccuTier, velocityTier,

  // Column state
  visibleColumns,

  // Aggregated state
  advancedFilters,
  advancedFilterCount,
  isAdvancedOpen,

  // Actions (50+ setters)
  setType, setSort, setSearch,
  toggleQuickFilter, applyPreset, clearPreset,
  clearAllFilters, setAdvancedFilter, clearAdvancedFilters,
  toggleAdvanced, setVisibleColumns,
} = useAppsFilters();
```

**Key Features:**
- URL synchronization via `useSearchParams` and `useRouter`
- Debounced URL updates (400ms) to prevent history spam
- Preset and quick filter state tracking
- Quick filter merging logic (AND semantics)
- Column visibility management
- Advanced filter count badge tracking

### useAppsSelection Hook

Ephemeral row selection management (~162 LOC):

```typescript
const {
  selectedAppIds,       // Set<number>
  selectedCount,        // number
  isSelected,           // (appid) => boolean
  isAllVisibleSelected, // boolean
  isIndeterminate,      // boolean (for header checkbox)
  toggleSelection,      // (appid, shiftKey, allAppIds) => void
  toggleAllVisible,     // (allAppIds) => void
  clearSelection,       // () => void
  getSelectedApps,      // (apps) => App[]
} = useAppsSelection();
```

**Features:**
- Shift+click range selection (tracks `lastSelectedIndexRef`)
- Max 50 selections with cap enforcement
- NOT persisted to URL (too volatile)
- Indeterminate state detection for header checkbox

### useAppsCompare Hook

Compare mode state management (~109 LOC):

```typescript
const {
  compareAppIds,        // number[]
  isCompareOpen,        // boolean
  isPending,            // boolean
  openCompare,          // (appIds) => void
  closeCompare,         // () => void
  removeFromCompare,    // (appid) => void
} = useAppsCompare();
```

**URL Format:** `?compare=730,1245620,553850`
**Constraints:** Min 2, max 5 games

### useSavedViews Hook

localStorage-based view persistence (~139 LOC):

```typescript
const {
  views,                // SavedView[]
  isLoaded,             // boolean (prevents hydration mismatch)
  saveView,             // (name) => void
  deleteView,           // (id) => void
  renameView,           // (id, name) => void
  getView,              // (id) => SavedView | undefined
} = useSavedViews();
```

**Storage Key:** `publisheriq-apps-saved-views`
**Max Views:** 10
**View ID Format:** `view-{timestamp}-{random}`

---

## Database Layer

### Tiger Query Surfaces

The page reads TigerData from `apps-queries.ts`.

| Surface | Purpose |
|---------|---------|
| `metrics.apps_page_projection` | Fast default list, filtered list, and aggregate reads when the projection is present |
| `legacy.apps` | fallback catalog rows and app identity |
| `legacy.latest_daily_metrics` | current reviews, owners, prices, playtime, and metric date |
| `metrics.review_velocity_stats` | 7d/30d review velocity and velocity tier |
| `metrics.app_trends` | sentiment and trend inputs |
| `ops.ccu_tier_assignments` | CCU tier and growth signals |
| `legacy.app_publishers` / `legacy.app_developers` | primary publisher/developer context |

### Projection Path

When `metrics.apps_page_projection` exists, the list and aggregate stats query that projection directly:

```sql
SELECT p.*
FROM metrics.apps_page_projection p
WHERE ...
ORDER BY p.ccu_peak DESC NULLS LAST, p.appid ASC
LIMIT $1 OFFSET $2;
```

The query layer caches aggregate stats for 5 minutes per normalized filter set and caps list reads at 250 rows.

### Fallback Path

If the projection is missing, the page can still use direct Tiger SQL for supported paths. This fallback is for resilience and local bootstrap states; production should keep `metrics.apps_page_projection` present and refreshed.

### Array Filters And Search

Content and platform filters use Tiger-side arrays and indexed predicates where available:

```sql
WHERE p.genre_ids @> $1::int[]      -- all selected genres
WHERE p.genre_ids && $1::int[]      -- any selected genre
WHERE p.platform_array @> $2::text[]
```

Name and entity search stay server-side and parameterized.

---

## Filtering System

### Filter Categories

| Category | Filters | Backend Support |
|----------|---------|-----------------|
| Type | game, dlc, demo, all | Yes |
| Search | Name ILIKE | Yes |
| Metrics | ccu, owners, reviews, score, price, playtime | Yes |
| Growth | 7d growth, 30d growth, momentum | Yes |
| Sentiment | sentiment_delta, velocity_tier | Yes |
| Engagement | active_pct, review_rate, value_score | Yes |
| Content | genres, tags, categories, workshop | Yes |
| Platform | Windows, Mac, Linux, Steam Deck, controller | Yes |
| Release | age, year, early_access, hype_duration | Yes |
| Relationship | publisher, developer, self_published, vs_publisher, publisher_size | Partial (slow path) |
| Activity | ccu_tier | Yes |

### URL Parameter Schema

```typescript
interface AppsSearchParams {
  // Core
  type?: 'game' | 'dlc' | 'demo' | 'all';
  sort?: SortField;
  order?: 'asc' | 'desc';
  search?: string;

  // Presets/Quick Filters
  preset?: PresetId;
  filters?: string; // comma-separated QuickFilterId

  // Metric Ranges
  minCcu?: string; maxCcu?: string;
  minOwners?: string; maxOwners?: string;
  minReviews?: string; maxReviews?: string;
  minScore?: string; maxScore?: string;
  minPrice?: string; maxPrice?: string;
  minPlaytime?: string; maxPlaytime?: string;

  // Growth
  minGrowth7d?: string; maxGrowth7d?: string;
  minGrowth30d?: string; maxGrowth30d?: string;
  minMomentum?: string; maxMomentum?: string;

  // Sentiment
  minSentimentDelta?: string; maxSentimentDelta?: string;
  velocityTier?: 'high' | 'medium' | 'low' | 'dormant';

  // Engagement
  minActivePct?: string;
  minReviewRate?: string;
  minValueScore?: string;

  // Content
  genres?: string;      // comma-separated IDs
  genreMode?: 'any' | 'all';
  tags?: string;
  tagMode?: 'any' | 'all';
  categories?: string;
  hasWorkshop?: 'true' | 'false';

  // Platform
  platforms?: string;   // comma-separated: windows,mac,linux
  platformMode?: 'any' | 'all';
  steamDeck?: 'verified' | 'playable' | 'unsupported';
  controller?: 'full' | 'partial';

  // Release
  minAge?: string; maxAge?: string;
  releaseYear?: string;
  earlyAccess?: 'true' | 'false';
  minHype?: string; maxHype?: string;

  // Relationship
  publisherSearch?: string;
  developerSearch?: string;
  selfPublished?: 'true';
  minVsPublisher?: string;
  publisherSize?: 'indie' | 'mid' | 'major';

  // Activity
  ccuTier?: '1' | '2' | '3';

  // Columns & Compare
  columns?: string;     // comma-separated ColumnId
  compare?: string;     // comma-separated appids: 730,1245620,553850
}
```

### Preset Definitions

```typescript
const PRESETS = [
  {
    id: 'top_games',
    label: 'Top Games',
    filters: { minCcu: 1000 },
    sort: 'ccu_peak',
    order: 'desc',
  },
  {
    id: 'rising_stars',
    label: 'Rising Stars',
    filters: { minGrowth7d: 25, maxOwners: 500000 },
    sort: 'ccu_growth_7d_percent',
    order: 'desc',
  },
  {
    id: 'high_momentum',
    label: '🔥 High Momentum',
    filters: { minMomentum: 15, minCcu: 500 },
    sort: 'momentum_score',
    order: 'desc',
  },
  // ... 9 more presets
];
```

### Quick Filter Merging Logic

When multiple quick filters are active, values are merged with AND semantics:

```typescript
function mergeQuickFilters(filters: QuickFilterId[]): MergedFilters {
  // Min values: Take MAX (more restrictive)
  // Max values: Take MIN (more restrictive)
  // Booleans: OR logic
  // Arrays: Combined and deduplicated
}
```

---

## Column System

### Column Categories

| Category | Columns | Count |
|----------|---------|-------|
| Core | rank, name | 2 |
| Engagement | avg_playtime, playtime_2w, active_player_pct | 3 |
| Reviews | reviews, score, velocity_7d, velocity_30d, velocity_tier, sentiment_delta, review_rate | 7 |
| Growth | ccu_peak, growth_7d, growth_30d, momentum, acceleration, sparkline | 6 |
| Financial | price, discount, owners, value_score | 4 |
| Context | publisher, developer, vs_publisher_avg, publisher_games | 4 |
| Timeline | release_date, days_live, hype_duration | 3 |
| Platform | steam_deck, platforms, controller | 3 |
| Activity | ccu_tier | 1 |
| **Total** | | **33** |

### Sort Field Mapping

```typescript
// Server-side sortable (passed to Tiger SQL)
const SERVER_SORTS = [
  'name', 'ccu_peak', 'owners_midpoint', 'total_reviews',
  'review_score', 'price_cents', 'release_date',
  'ccu_growth_7d_percent', 'ccu_growth_30d_percent',
  'momentum_score', 'sentiment_delta', 'velocity_7d',
  'active_player_pct', 'review_rate', 'value_score',
  'vs_publisher_avg', 'days_live',
];
```

### Column Definition Structure

```typescript
interface ColumnDefinition {
  id: ColumnId;
  label: string;
  shortLabel?: string;
  category: ColumnCategory;
  width: number | string;
  sortable: boolean;
  sortField?: SortField;
  defaultVisible: boolean;
  methodology?: string;
  getValue: (app: App) => number | string | null;
  renderCell?: (app: App, value: any) => React.ReactNode;
}
```

### Pricing Semantics

- The current Games page price field is storefront-first: Tiger queries prefer `apps.current_price_cents` and fall back to latest summary pricing only when needed.
- Sale state is only rendered when the app is paid and the effective price is non-null.
- This prevents stale summary pricing from surfacing `$0.00` or orphaned discount badges on paid titles.

---

## Computed Metrics

The Games page features 6 novel computed insight metrics calculated in the Tiger query/projection layer:

### Metric Formulas

| Metric | Formula | Insight |
|--------|---------|---------|
| **Momentum Score** | `(ccu_growth_7d_pct + velocity_acceleration) / 2` | Combined CCU + review velocity signal. High momentum = game is taking off. |
| **Sentiment Delta** | `current_positive_pct - previous_positive_pct` | Review sentiment change. Positive = improving, negative = declining (review bomb detection). |
| **Active Player %** | `(ccu_peak / owners_midpoint) × 100` | Engagement depth vs historical reach. High % = engaged community. |
| **Review Rate** | `(total_reviews / owners_midpoint) × 1000` | Reviews per 1K owners. Measures community engagement level. |
| **Value Score** | `(avg_playtime_forever / 60) / (price_cents / 100)` | Hours of entertainment per dollar spent. Excludes free games. |
| **vs Publisher Avg** | `game_review_score - publisher_avg_score` | Performance relative to publisher's catalog average. |

### Implementation Details

**Momentum Score:**
```sql
momentum_score := COALESCE(ccu_growth_7d_pct, 0) +
  CASE
    WHEN velocity_7d > velocity_30d * 1.2 THEN 10  -- Accelerating
    WHEN velocity_7d < velocity_30d * 0.8 THEN -10 -- Decelerating
    ELSE 0
  END
) / 2
```

**Velocity Acceleration:**
- Accelerating: `velocity_7d > velocity_30d × 1.2` (+10 to momentum)
- Stable: within 20% variance (0 to momentum)
- Decelerating: `velocity_7d < velocity_30d × 0.8` (-10 to momentum)

**Value Score Notes:**
- Only calculated for paid games (`price_cents > 0`)
- Uses average playtime in hours (`avg_playtime_forever / 60`)
- Higher scores indicate better value per dollar

**vs Publisher Avg Notes:**
- Only computed on slow query path (triggers ~4s query)
- Requires publisher_metrics materialized view JOIN
- Returns NULL on fast path to maintain <200ms performance

### Indicator Thresholds

**Momentum Indicators:**

| Score | Indicator | Color | Meaning |
|-------|-----------|-------|---------|
| >= 20 | 🚀🚀 | Bright green | Explosive growth |
| 10-19 | 🚀 | Green | Strong momentum |
| 0-9 | ↗ | Light green | Slight momentum |
| -9 to 0 | → | Gray | Stable |
| -19 to -10 | ↘ | Orange | Declining |
| <= -20 | 📉 | Red | Sharp decline |

**Sentiment Delta Indicators:**

| Change | Indicator | Color | Label |
|--------|-----------|-------|-------|
| >= +10% | ⬆ | Bright green | Surging |
| +3% to +9% | ↑ | Green | Improving |
| -3% to +3% | → | Gray | Stable |
| -9% to -3% | ↓ | Orange | Declining |
| <= -10% | ⬇ | Red | Review Bomb |

**Growth Indicators:**

| Growth | Indicator | Color |
|--------|-----------|-------|
| >= 50% | 🚀 | Bright green |
| 10-49% | ↑ | Green |
| -10% to 10% | → | Gray |
| -49% to -10% | ↓ | Orange |
| <= -50% | 📉 | Red |

---

## Performance Considerations

### Query Optimization

| Strategy | Impact |
|----------|--------|
| `metrics.apps_page_projection` | Fast default and filtered reads when present |
| Direct Tiger fallback SQL | Keeps local/bootstrap states usable while projection is being prepared |
| Aggregate stats cache | Avoids repeated count/summary work for the same filter set |
| GIN indexes | Fast array containment |
| Trigram indexes | Fast title and entity search |
| 3-day growth windows | Works with limited CCU history |
| LATERAL join for playtime | Efficient playtime data fetch |

### Lazy Loading

| Feature | Strategy |
|---------|----------|
| Sparklines | IntersectionObserver triggers batch fetch |
| Filter counts | Fetched on panel open, cached 5 min |
| Compare data | Fetched only when compare param present |

### Caching

| Data | Cache Strategy |
|------|----------------|
| Filter option counts | 5-minute client-side cache |
| Saved views | localStorage persistence |
| Column preferences | URL parameter persistence |
| Sparkline data | In-memory Map cache |

---

## File Reference

| File | LOC | Purpose |
|------|-----|---------|
| `page.tsx` | ~150 | Server component, param parsing |
| `AppsPageClient.tsx` | ~400 | Main client orchestrator |
| `AppsTable.tsx` | ~600 | Desktop table + mobile cards |
| `useAppsFilters.ts` | ~1,320 | URL-based filter state (40+ params) |
| `apps-presets.ts` | ~300 | 12 presets + 12 quick filter definitions |
| `apps-columns.ts` | ~450 | 33 column definitions |
| `apps-types.ts` | ~200 | TypeScript interfaces |
| `apps-queries.ts` | ~200 | Tiger query wrappers + formatters |
| `apps-compare.ts` | ~250 | 17 comparison metric definitions |
| `apps-export.ts` | ~280 | CSV/JSON export formatting |
| `useAppsSelection.ts` | ~162 | Row selection with shift+click |
| `useAppsCompare.ts` | ~109 | Compare mode state |
| `useSavedViews.ts` | ~139 | localStorage view persistence |
| `useSparklineLoader.ts` | ~150 | Batch sparkline loading |

---

## Command Palette Integration (v2.7)

The Games page integrates with the Command Palette for unified filtering.

### Architecture

```
/apps/
├── components/
│   └── command-palette/
│       ├── CommandPalette.tsx            # Main wrapper, keyboard handling
│       ├── CommandPaletteHome.tsx        # Home view with search, presets, quick filters
│       ├── CommandPaletteTags.tsx        # Tags browser with counts
│       ├── CommandPaletteGenres.tsx      # Genres browser with counts
│       └── CommandPaletteCategories.tsx  # Categories browser
│
├── lib/
│   ├── filter-registry.ts                # 40+ filter definitions with metadata
│   └── filter-syntax-parser.ts           # Syntax parsing and validation
│
├── hooks/
│   ├── useCommandPalette.ts              # Palette state management
│   └── useKeyboardShortcut.ts            # ⌘K keyboard listener
│
└── components/
    └── ActiveFilterBar.tsx               # Color-coded filter chip display
```

### Filter Registry

Defines 40+ filters across 9 categories:

```typescript
interface FilterDefinition {
  id: string;                    // Unique identifier
  label: string;                 // Display name
  shortLabel?: string;           // Compact display name
  category: FilterCategory;      // metric, growth, sentiment, engagement,
                                 // content, platform, release, relationship, activity
  type: FilterType;              // range, boolean, content, select
  shortcuts: string[];           // CLI-style shortcuts: ['ccu', 'players']
  urlParam: string;              // URL parameter name
  chipColor: ChipColor;          // Active filter bar color
  rangeConfig?: RangeConfig;     // Min/max, step, format for range filters
}
```

### Filter Syntax Parser

Converts user input to structured filter objects:

```typescript
// Input parsing examples
parseSyntax('ccu > 50000')      // → { field: 'minCcu', value: 50000 }
parseSyntax('ccu 1000-50000')   // → { field: 'minCcu', value: 1000 }, { field: 'maxCcu', value: 50000 }
parseSyntax('free:yes')         // → { field: 'isFree', value: true }
parseSyntax('genre:action')     // → { field: 'genres', value: [genreId] }
parseSyntax('rising stars')     // → { preset: 'rising_stars' }
```

**Parser Features:**
- Fuzzy matching for shortcuts and presets
- Error recovery with suggestions
- Case-insensitive matching
- Number parsing with K/M suffixes (e.g., `50K` → `50000`)

### Active Filter Bar

Displays applied filters as color-coded chips:

| Category | Color Token | Examples |
|----------|-------------|----------|
| preset | `--accent-purple` | Rising Stars, High Momentum |
| quickFilter | `--accent-primary` | Popular, Trending, Free |
| metric | `--accent-blue` | CCU > 1,000, Score >= 90 |
| content | `--accent-green` | Genre: Action, Tag: Roguelike |
| platform | `--accent-orange` | Steam Deck: Verified |
| release | `--accent-yellow` | Released: Last 30 days |
| relationship | `--accent-pink` | Publisher: Valve |
| activity | `--text-tertiary` | CCU Tier: Hot |

### Keyboard Handling

```typescript
// useKeyboardShortcut.ts
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setIsOpen(true);
    }
    if (e.key === 'Escape' && isOpen) {
      if (currentView !== 'home') {
        setCurrentView('home');
      } else {
        setIsOpen(false);
      }
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [isOpen, currentView]);
```

---

## TigerData Read Pattern

The Games page reads product data from TigerData on the server:

```typescript
import { runTigerQuery } from '@publisheriq/database';

const { rows } = await runTigerQuery<AppRpcRow>(sql, values);
```

Environment requirements:

| Variable | Context | Use |
|----------|---------|-----|
| `TIGER_PRIMARY_URL` | server only | primary TigerData read target |
| `CHANGE_INTEL_TIGER_URL` | server only | fallback Tiger URL accepted by the shared helper |

Do not expose Tiger connection strings through `NEXT_PUBLIC_` variables. Supabase clients still matter for auth, pins, alerts, and user-control flows, but they are not the `/apps` product-data read path.

---

## Related Documentation

- [v2.6 Release Notes](../../releases/v2.6-games-page.md) - Full changelog
- [v2.7 Release Notes](../../releases/v2.7-design-command-palette.md) - Command Palette and Design System
- [v2.8 Release Notes](../../releases/v2.8-security-fixes.md) - Security fixes and client patterns
- [Games Page User Guide](../../user-guide/games-page.md) - Usage instructions
- [Games Page Spec](../../specs/archived/apps-page-spec.md) - Original specification
- [Games Page Progress](../../specs/archived/apps-page-progress.md) - Implementation log
- [Companies Page Architecture](./companies-page.md) - Similar architecture reference
- [Database Schema](../architecture/database-schema.md) - Full schema reference
