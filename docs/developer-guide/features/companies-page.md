# Companies Page Architecture

This document describes the technical architecture of the unified Companies page in PublisherIQ.

**Last Updated:** January 31, 2026

---

## Overview

The Companies page (`/companies`) is a unified analytics dashboard for browsing publishers and developers. It replaces the separate `/publishers` and `/developers` index pages with a single, feature-rich interface.

This page is still Supabase/RPC-backed today. The main reads come from stored functions and materialized views; Tiger/query-api does not serve this surface directly.

**Key Capabilities:**
- View publishers, developers, or both together
- 9 filter categories with 25+ parameters
- 17 customizable columns across 7 categories
- Side-by-side comparison of 2-5 companies
- CSV/JSON export with configurable columns
- Saved views for filter configurations

---

## Architecture

### Component Hierarchy

```
/companies/
├── page.tsx                          # Server component - data fetching, param parsing
├── error.tsx                         # Error boundary
├── loading.tsx                       # Loading skeleton
│
├── components/
│   ├── CompaniesPageClient.tsx       # Main client orchestrator
│   ├── CompaniesTable.tsx            # Desktop table + mobile cards (668 LOC)
│   ├── CompanyTypeToggle.tsx         # All/Publishers/Developers toggle
│   ├── UnifiedFilterBar.tsx          # Presets + quick filters
│   ├── SearchBar.tsx                 # Name search with focus tracking
│   ├── AdvancedFiltersPanel.tsx      # Collapsible filter panel
│   ├── ContextBar.tsx                # Aggregate stats display
│   ├── ColumnSelector.tsx            # Column visibility dropdown
│   ├── GrowthCell.tsx                # Color-coded growth indicator
│   ├── SparklineCell.tsx             # Lazy-loaded CCU sparklines
│   ├── MethodologyTooltip.tsx        # Column info tooltips
│   ├── BulkActionsBar.tsx            # Selection action bar
│   ├── CompareMode.tsx               # Side-by-side comparison modal
│   ├── ExportDialog.tsx              # Export options dialog
│   ├── SavedViews.tsx                # Save/load filter views
│   ├── DataFreshnessFooter.tsx       # Data sync status
│   ├── EmptyState.tsx                # No-results messaging
│   └── FilterPill.tsx                # Active filter display
│   │
│   └── filters/
│       ├── MetricRangeFilters.tsx    # 7 metric min/max ranges
│       ├── GrowthFilters.tsx         # Growth metric ranges
│       ├── GenreTagFilter.tsx        # Multi-select with counts (235 LOC)
│       ├── FeatureFilter.tsx         # Checkbox grid
│       ├── PlatformFilter.tsx        # Platform checkboxes
│       ├── SteamDeckFilter.tsx       # Steam Deck compatibility
│       ├── ActivityFilter.tsx        # Active/Dormant toggle
│       ├── RelationshipFilter.tsx    # Relationship type
│       ├── TimePeriodFilter.tsx      # Time period selector
│       ├── DualRangeSlider.tsx       # Dual-handle range input (412 LOC)
│       ├── MetricSliderGrid.tsx      # Grid layout for sliders
│       ├── GrowthSliderRow.tsx       # Growth metric range row
│       ├── RangeInput.tsx            # Single range input
│       └── SegmentedControl.tsx      # Toggle button group
│
├── hooks/
│   ├── useCompaniesFilters.ts        # URL-based filter state (777 LOC)
│   ├── useCompaniesSelection.ts      # Row selection with shift+click
│   ├── useCompaniesCompare.ts        # Compare mode state
│   ├── useSavedViews.ts              # localStorage view persistence
│   ├── useFilterCounts.ts            # Lazy-load filter option counts
│   └── useSparklineLoader.ts         # IntersectionObserver sparklines
│
└── lib/
    ├── companies-types.ts            # TypeScript interfaces (361 LOC)
    ├── companies-queries.ts          # RPC wrappers + formatters (324 LOC)
    ├── companies-columns.ts          # Column definitions (364 LOC)
    ├── companies-presets.ts          # Preset/quick filter definitions (421 LOC)
    ├── companies-ratios.ts           # Ratio computations
    ├── companies-methodology.ts      # Column methodology text
    ├── companies-compare.ts          # Comparison row building (320 LOC)
    └── companies-export.ts           # CSV/JSON export formatting (291 LOC)
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Server Component (page.tsx)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Parse URL search params                                                  │
│  2. Validate and type-cast all parameters                                    │
│  3. Build CompaniesFilterParams object                                       │
│  4. Parallel data fetching:                                                  │
│     ├── getCompanies(filterParams)        → Company[]                       │
│     ├── getAggregateStats(filterParams)   → AggregateStats                  │
│     └── getCompaniesByIds(compareIds)     → Company[] (if compare param)    │
│  5. Pass data to CompaniesPageClient                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Client Component (CompaniesPageClient)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  Hooks:                                                                      │
│  ├── useCompaniesFilters()    → Filter state, URL sync                      │
│  ├── useCompaniesSelection()  → Row selection state                         │
│  ├── useCompaniesCompare()    → Compare mode state                          │
│  ├── useSavedViews()          → Saved view management                       │
│  └── useFilterCounts()        → Filter dropdown counts (lazy)               │
│                                                                              │
│  Renders:                                                                    │
│  ├── CompanyTypeToggle                                                       │
│  ├── SearchBar                                                               │
│  ├── UnifiedFilterBar (presets + quick filters)                             │
│  ├── AdvancedFiltersPanel                                                    │
│  ├── ContextBar (aggregate stats)                                           │
│  ├── ColumnSelector                                                          │
│  ├── SavedViews                                                              │
│  ├── CompaniesTable                                                          │
│  ├── BulkActionsBar (when selections active)                                │
│  ├── CompareMode (when comparing)                                           │
│  └── ExportDialog (when exporting)                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## State Management

### URL-First Architecture

All filter state is persisted in URL parameters for bookmarking and sharing:

```
/companies?type=publisher&sort=revenue_estimate_cents&order=desc
         &minRevenue=1000000000&minGrowth7d=10
         &genres=1,2,3&genreMode=any
         &columns=hours,games,revenue,growth_7d
         &compare=pub:123,pub:456
```

### useCompaniesFilters Hook

Central state management hook (777 LOC):

```typescript
const {
  // Current filter state
  filters,
  columns,
  preset,
  quickFilters,

  // Actions
  setFilter,
  clearFilters,
  toggleQuickFilter,
  applyPreset,
  setColumns,

  // Derived
  activeFilterCount,
  hasActiveFilters,
} = useCompaniesFilters();
```

**Key Features:**
- URL synchronization via `useSearchParams`
- Debounced URL updates to prevent history spam
- Preset and quick filter state tracking
- Column visibility management
- Filter merging for stackable quick filters

### useCompaniesSelection Hook

Row selection management:

```typescript
const {
  selectedIds,      // Set<SerializedCompanyId>
  isSelected,       // (company) => boolean
  toggle,           // (company, shiftKey) => void
  selectAll,        // (companies) => void
  clearSelection,   // () => void
  selectedCount,    // number
} = useCompaniesSelection();
```

**Features:**
- Shift+click range selection
- SerializedCompanyId format: `pub:123` or `dev:456`
- Max 5 selections for compare mode

### useCompaniesCompare Hook

Compare mode state management:

```typescript
const {
  compareIds,       // CompanyIdentifier[]
  isComparing,      // boolean
  addToCompare,     // (company) => void
  removeFromCompare,// (company) => void
  clearCompare,     // () => void
  canCompare,       // boolean (2-5 selected)
} = useCompaniesCompare();
```

**URL Format:** `?compare=pub:123,dev:456,pub:789`

### useSavedViews Hook

localStorage-based view persistence:

```typescript
const {
  views,            // SavedView[]
  saveView,         // (name) => void
  loadView,         // (view) => void
  deleteView,       // (id) => void
  renameView,       // (id, name) => void
} = useSavedViews();
```

**Storage Key:** `publisheriq-companies-saved-views`
**Max Views:** 10

---

## Database Layer

### RPC Functions

| Function | Purpose | Performance |
|----------|---------|-------------|
| `get_companies_with_filters()` | Main query with all filters | Fast: ~214ms, Slow: ~4s |
| `get_companies_aggregate_stats()` | Summary for context bar | ~100ms |
| `get_company_sparkline_data()` | CCU time-series | ~50ms |
| `get_filter_option_counts()` | Filter dropdown counts | ~200ms |

### Two-Path Optimization

The main RPC uses conditional query paths based on filter requirements:

```sql
-- Check if expensive computations needed
v_needs_growth := (p_min_growth_7d IS NOT NULL OR p_max_growth_7d IS NOT NULL
                  OR p_sort_by IN ('ccu_growth_7d', 'ccu_growth_30d'));
v_needs_relationship := (p_relationship IS NOT NULL);

IF NOT v_needs_growth AND NOT v_needs_relationship THEN
  -- Fast path: Simple join, NULL for growth columns
  RETURN QUERY SELECT ... FROM publishers/developers
    JOIN metrics WHERE filters...
ELSE
  -- Slow path: Full computation with growth/relationship data
  RETURN QUERY SELECT ... WITH growth_calculation ...
END IF;
```

**Fast Path (~214ms):**
- Used when no growth filters and not sorting by growth
- Returns NULL for growth/relationship columns
- Sufficient for most browsing scenarios

**Slow Path (~4s):**
- Used when growth filters active or sorting by growth
- Computes CCU growth percentages
- Computes relationship flags

### Pre-Computed Content Arrays

Materialized view columns for O(1) filtering:

```sql
-- On publisher_metrics and developer_metrics views
genre_ids INT[]                    -- Array of genre IDs
tag_ids INT[]                      -- Array of tag IDs
category_ids INT[]                 -- Array of category IDs
best_steam_deck_category TEXT      -- 'verified', 'playable', 'unsupported'
has_windows BOOLEAN
has_mac BOOLEAN
has_linux BOOLEAN
```

**Query Pattern:**
```sql
-- Instead of expensive EXISTS subquery
WHERE genre_ids @> ARRAY[1,2,3]::INT[]   -- Contains all (ALL mode)
WHERE genre_ids && ARRAY[1,2,3]::INT[]   -- Overlaps any (ANY mode)
```

### GIN Indexes

```sql
CREATE INDEX idx_publisher_metrics_genres ON publisher_metrics USING GIN (genre_ids);
CREATE INDEX idx_publisher_metrics_tags ON publisher_metrics USING GIN (tag_ids);
CREATE INDEX idx_publisher_metrics_categories ON publisher_metrics USING GIN (category_ids);
-- Repeated for developer_metrics
```

---

## Filtering System

### Filter Categories

| Category | Filters | Backend Support |
|----------|---------|-----------------|
| Type | all, publisher, developer | Yes |
| Search | Name ILIKE | Yes |
| Metrics | games, owners, ccu, hours, revenue, score, reviews | Yes |
| Growth | 7d growth, 30d growth | Yes (slow path) |
| Content | genres, tags, categories | Yes |
| Platform | Windows, Mac, Linux | Yes |
| Steam Deck | verified, playable | Yes |
| Status | active, dormant | Yes |
| Relationship | self_published, external_devs, multi_publisher | Yes (slow path) |
| Time Period | 2023, 2024, 2025, last_12mo, etc. | UI only |

### URL Parameter Schema

```typescript
interface CompaniesSearchParams {
  // Core
  type?: 'all' | 'publisher' | 'developer';
  sort?: SortField;
  order?: 'asc' | 'desc';
  search?: string;

  // Presets/Quick Filters
  preset?: PresetId;
  filters?: string; // comma-separated QuickFilterId

  // Metric Ranges
  minGames?: string; maxGames?: string;
  minOwners?: string; maxOwners?: string;
  minCcu?: string; maxCcu?: string;
  minHours?: string; maxHours?: string;
  minRevenue?: string; maxRevenue?: string;
  minScore?: string; maxScore?: string;
  minReviews?: string; maxReviews?: string;

  // Growth
  minGrowth7d?: string; maxGrowth7d?: string;
  minGrowth30d?: string; maxGrowth30d?: string;

  // Content
  genres?: string;      // comma-separated IDs
  genreMode?: 'any' | 'all';
  tags?: string;
  categories?: string;
  steamDeck?: 'verified' | 'playable';
  platforms?: string;   // comma-separated: windows,mac,linux
  platformMode?: 'any' | 'all';

  // Status & Relationship
  status?: 'active' | 'dormant';
  relationship?: 'self_published' | 'external_devs' | 'multi_publisher';

  // Columns & Compare
  columns?: string;     // comma-separated ColumnId
  compare?: string;     // pub:123,dev:456,pub:789
}
```

### Preset Definitions

```typescript
const PRESETS = [
  {
    id: 'market_leaders',
    filters: { minRevenue: 1_000_000_000 },  // $10M
    sort: 'revenue_estimate_cents',
    order: 'desc',
  },
  {
    id: 'rising_indies',
    filters: { maxGames: 10, minGrowth7d: 10 },
    sort: 'ccu_growth_7d',
    order: 'desc',
  },
  // ...
];
```

---

## Column System

### Column Categories

| Category | Columns | Sortable |
|----------|---------|----------|
| Engagement | hours, owners, ccu | Yes (server) |
| Content | games, unique_developers, role | Partial |
| Reviews | reviews, avg_score, review_velocity | Yes |
| Financial | revenue | Yes (server) |
| Growth | growth_7d, growth_30d, trending | Partial |
| Ratios | revenue_per_game, owners_per_game, reviews_per_1k_owners | Yes (client) |
| Visualization | sparkline | No |

### Sort Field Mapping

```typescript
// Server-side sortable (passed to RPC)
const SERVER_SORTS = [
  'name', 'estimated_weekly_hours', 'game_count',
  'total_owners', 'total_ccu', 'avg_review_score',
  'total_reviews', 'revenue_estimate_cents',
  'games_trending_up', 'ccu_growth_7d',
];

// Client-side sortable (computed ratios)
const CLIENT_SORTS = [
  'revenue_per_game', 'owners_per_game',
  'reviews_per_1k_owners', 'growth_30d', 'review_velocity',
];
```

### Column Definition Structure

```typescript
interface ColumnDefinition {
  id: ColumnId;
  label: string;
  shortLabel?: string;
  category: ColumnCategory;
  width: number;
  sortable: boolean;
  sortField?: SortField;      // For server-side sorting
  isRatio?: boolean;          // For client-side sorting
  isVisualization?: boolean;
  methodology?: string;       // Tooltip text
  getValue: (company: Company) => number | string | null;
}
```

---

## Performance Considerations

### Query Optimization

| Strategy | Impact |
|----------|--------|
| Two-path queries | 19x faster for common operations |
| Pre-computed arrays | 39x faster for tag filtering |
| GIN indexes | Sub-ms array containment |
| Parallel data fetching | 3 queries concurrent |

### Lazy Loading

| Feature | Strategy |
|---------|----------|
| Sparklines | IntersectionObserver triggers fetch |
| Filter counts | Fetched on panel open, cached 5 min |
| Compare data | Fetched only when compare param present |

### Caching

| Data | Cache Strategy |
|------|----------------|
| Filter option counts | 5-minute client-side cache |
| Saved views | localStorage persistence |
| Column preferences | URL parameter persistence |

---

## File Reference

| File | LOC | Purpose |
|------|-----|---------|
| `page.tsx` | 324 | Server component, param parsing |
| `CompaniesPageClient.tsx` | ~400 | Main client orchestrator |
| `CompaniesTable.tsx` | 668 | Desktop table + mobile cards |
| `useCompaniesFilters.ts` | 777 | URL-based filter state |
| `companies-presets.ts` | 421 | Preset/quick filter definitions |
| `companies-columns.ts` | 364 | Column definitions |
| `companies-types.ts` | 361 | TypeScript interfaces |
| `companies-queries.ts` | 324 | RPC wrappers + formatters |
| `companies-compare.ts` | 320 | Comparison logic |
| `companies-export.ts` | 291 | Export formatting |
| `DualRangeSlider.tsx` | 412 | Dual-handle range input |
| `GenreTagFilter.tsx` | 235 | Multi-select with counts |

---

## Command Palette Integration (v2.7)

The Companies page integrates with the Command Palette for unified filtering.

### Architecture

The Command Palette is shared between Games and Companies pages:

```
/companies/
├── components/
│   └── command-palette/              # Shared with /apps
│       ├── CommandPalette.tsx        # Main wrapper
│       ├── CommandPaletteHome.tsx    # Home view (company-specific presets)
│       └── ...
│
└── lib/
    └── companies-filter-registry.ts  # Company-specific filter definitions
```

### Filter Registry (Companies)

Company-specific filters:

| Filter | Shortcut | Type | Description |
|--------|----------|------|-------------|
| Game Count | `games` | range | Number of published games |
| Total Owners | `owners` | range | Total estimated owners |
| Peak CCU | `ccu` | range | Total concurrent users |
| Revenue | `revenue` | range | Estimated gross revenue |
| Growth 7d | `growth` | range | Weekly CCU growth % |
| Genres | `genre` | content | Games with genre |
| Tags | `tag` | content | Games with tag |
| Steam Deck | `deck` | select | Deck compatibility |
| Status | `active` | boolean | Active vs dormant |

### Filter Syntax Examples

```
games > 10          # Companies with 10+ games
revenue > 1000000   # Over $1M estimated revenue
growth > 10         # 10%+ weekly growth
genre:action        # Companies with action games
deck:verified       # Companies with Deck-verified games
market leaders      # Apply Market Leaders preset
```

### Active Filter Bar

Company-specific category colors:

| Category | Color | Examples |
|----------|-------|----------|
| preset | Purple | Market Leaders, Rising Indies |
| quickFilter | Coral | Major 10+, Prolific 5+ |
| metric | Blue | Games > 10, Revenue > $1M |
| content | Green | Genre: Action |
| platform | Orange | Steam Deck: Verified |
| status | Gray | Status: Active |

---

## Supabase Client Patterns (v2.8+)

The Companies page follows the same client patterns as the Games page.

### Server Component (page.tsx)

Uses service role for initial data fetch:

```typescript
import { createServiceClient } from '@/lib/supabase/server';

export default async function CompaniesPage() {
  const supabase = createServiceClient();

  const { data } = await supabase.rpc('get_companies_with_filters', params);

  return <CompaniesPageClient initialData={data} />;
}
```

### Client Hooks

Use `createBrowserClient` for session-aware fetching:

```typescript
// hooks/useSparklineLoader.ts
import { createBrowserClient } from '@supabase/ssr';

export function useSparklineLoader() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data } = await supabase.rpc('get_company_sparkline_data', {
    p_company_ids: companyIds,
    p_days: 7
  });
}
```

### Pattern Summary

| Pattern | Context | Use Case |
|---------|---------|----------|
| `createServiceClient()` | Server Component | Initial page data |
| `createBrowserClient()` | Client hooks | Interactive features (sparklines, filter counts) |

**Important:** Client hooks that previously used `getSupabase()` were updated in v2.8 to use `createBrowserClient()`. This fixes auth failures where RPC calls would fail silently and cache empty results.

---

## Related Documentation

- [v2.5 Release Notes](../../releases/v2.5-companies-page.md) - Full changelog
- [v2.7 Release Notes](../../releases/v2.7-design-command-palette.md) - Command Palette and Design System
- [v2.8 Release Notes](../../releases/v2.8-security-fixes.md) - Security fixes and client patterns
- [Companies Page User Guide](../../user-guide/companies-page.md) - Usage instructions
- [Companies Page Spec](../../specs/archived/companies-page-spec.md) - Original specification
- [Publishers & Developers Pages](../../archive/publishers-developers-pages.md) - Legacy pages (deprecated)
- [Database Schema](../architecture/database-schema.md) - Full schema reference
