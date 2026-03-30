# Admin Dashboard Architecture

This document describes the admin dashboard and related analytics pages in PublisherIQ.

**Last Updated:** March 30, 2026

## Overview

The admin dashboard provides a comprehensive view of system health, sync status, catalog control, CCU quality, and data completion. Version 2.0 introduced the collapsible layout, and the current surface layers in the newer operational RPCs:

- **Single-page collapsible layout** (replaces tabbed interface)
- **66% query reduction** (from ~40 queries to ~12)
- **Optimized RPC functions** for aggregated data, catalog control, and CCU quality
- **Chat logs integration** within the dashboard, including quality/session context metadata
- **Mobile-responsive design**

---

## Architecture

### Component Hierarchy

```
AdminDashboard
├── StatusBar              # Top-level health indicators
├── CollapsibleSection     # Data Completion
│   └── SourceCompletionCard[] (6 sources)
├── CollapsibleSection     # Catalog Control
│   └── QueueMetric[]
├── CollapsibleSection     # CCU Quality
│   └── QueueMetric[]
├── CollapsibleSection     # Sync Queue
│   ├── Priority Distribution
│   └── Queue Status (QueueMetric[])
├── CollapsibleSection     # PICS Service
│   └── PICSMetric[]
├── CollapsibleSection     # Sync Errors
│   └── Error table/cards
├── CollapsibleSection     # Recent Jobs
│   └── JobRow[]
├── CollapsibleSection     # Last Sync Times
│   └── LastSyncItem[]
├── ChatLogsSection        # Chat query logs
│   └── Log table/cards
│
# New Admin Pages (v2.1+)
AdminUsersPage             # User management
├── UserTable              # List users, roles, credits
└── CreditAdjustment       # Grant/deduct credits

AdminWaitlistPage          # Waitlist approval
├── WaitlistTable          # Pending applications
└── ApprovalActions        # Approve/reject

AdminUsagePage             # Credit usage analytics
├── UsageStats             # Total usage metrics
└── TransactionLog         # Recent transactions

# Insights Dashboard (v2.2)
InsightsPage               # CCU analytics dashboard
├── InsightsTabs           # Tab management & state
├── TimeRangeSelector      # 24h / 7d / 30d toggle
├── TopGamesTab            # Top games by peak CCU
│   └── TopGameCard[]      # Game rows with sparklines
├── NewestGamesTab         # Recent releases with sort toggle
│   └── TopGameCard[]
└── TrendingGamesTab       # Fastest growing games
    └── TopGameCard[]

# Games Page (v2.6)
AppsPage                   # Game discovery dashboard
├── AppsPageClient         # Main client orchestrator
├── AppTypeToggle          # Games/DLC/Demos toggle
├── SearchBar              # Name search
├── UnifiedFilterBar       # Presets + quick filters
├── AdvancedFiltersPanel   # 9 filter categories
├── SummaryStatsBar        # Aggregate statistics
├── ColumnSelector         # Column visibility
├── SavedViews             # Filter presets
├── AppsTable              # Data table with cells
├── BulkActionsBar         # Selection actions
├── CompareMode            # Game comparison modal
└── ExportDialog           # CSV/JSON export
```

### Data Flow

```
page.tsx (Server Component)
    │
    ├── Parallel data fetching
    │   ├── supabase.rpc('get_priority_distribution')
    │   ├── supabase.rpc('get_queue_status')
    │   ├── supabase.rpc('get_source_completion_stats')
    │   ├── supabase.rpc('get_catalog_control_stats')
    │   ├── supabase.rpc('get_ccu_quality_stats')
    │   ├── supabase.rpc('get_pics_data_stats')
    │   ├── supabase.from('sync_jobs').select(...)
    │   └── supabase.from('chat_query_logs').select(...)
    │
    └── AdminDashboard (Client Component)
        └── Renders all sections
```

---

## Performance Optimizations

### Query Reduction

**Before v2.0:** ~40 separate database queries
**After v2.0:** ~12 queries using RPC functions

| Old Approach | New Approach | Savings |
|--------------|--------------|---------|
| 5 priority tier counts | 1 RPC call | 80% |
| 4 queue status counts | 1 RPC call | 75% |
| 11 source completion counts | 1 RPC call | 91% |
| 7 PICS data counts | 1 RPC call | 86% |
| catalog control rollups | 1 RPC call | avoids repeated applist scans |
| CCU quality counts | 1 RPC call | avoids repeated fallback scans |

### RPC Functions

Four new PostgreSQL functions consolidate counting operations:

#### get_priority_distribution()

Returns count of apps by priority tier in a single query.

```sql
CREATE FUNCTION get_priority_distribution()
RETURNS TABLE(
  high BIGINT,
  medium BIGINT,
  normal_priority BIGINT,
  low BIGINT,
  minimal BIGINT
)
```

**Usage:**
```ts
const { data } = await supabase.rpc('get_priority_distribution');
// Returns: { high: 150, medium: 500, normal_priority: 2000, low: 5000, minimal: 10000 }
```

#### get_queue_status()

Returns count of apps due for sync at different intervals.

```sql
CREATE FUNCTION get_queue_status()
RETURNS TABLE(
  overdue BIGINT,
  due_in_1_hour BIGINT,
  due_in_6_hours BIGINT,
  due_in_24_hours BIGINT
)
```

**Usage:**
```ts
const { data } = await supabase.rpc('get_queue_status');
// Returns: { overdue: 50, due_in_1_hour: 200, due_in_6_hours: 1500, due_in_24_hours: 5000 }
```

#### get_source_completion_stats()

Returns sync completion stats for all data sources.

```sql
CREATE FUNCTION get_source_completion_stats()
RETURNS TABLE(
  source TEXT,
  total_apps BIGINT,
  synced_apps BIGINT,
  stale_apps BIGINT
)
```

**Returns rows for:** steamspy, storefront, reviews, histogram, page_creation

#### get_catalog_control_stats()

Returns catalog control and applist coverage stats.

```sql
CREATE FUNCTION get_catalog_control_stats()
RETURNS TABLE(
  current_catalog_apps BIGINT,
  historical_retained_apps BIGINT,
  latest_applist_started_at TIMESTAMPTZ,
  latest_applist_completed_at TIMESTAMPTZ,
  latest_live_app_count BIGINT,
  live_only_missing BIGINT,
  stale_running_applist_jobs BIGINT
)
```

#### get_ccu_quality_stats()

Returns CCU quality coverage and source distribution stats.

```sql
CREATE FUNCTION get_ccu_quality_stats()
RETURNS TABLE(
  current_catalog_apps BIGINT,
  tier_assigned BIGINT,
  no_tier_assignment BIGINT,
  confirmed_positive BIGINT,
  confirmed_zero BIGINT,
  suspect_zero BIGINT,
  skipped BIGINT,
  invalid BIGINT,
  unavailable BIGINT,
  steam_api BIGINT,
  steamspy BIGINT,
  legacy_unknown BIGINT,
  data_source TEXT,
  is_approximate BOOLEAN,
  updated_at TIMESTAMPTZ
)
```

#### get_pics_data_stats()

Returns PICS data completion statistics.

```sql
CREATE FUNCTION get_pics_data_stats()
RETURNS TABLE(
  total_apps BIGINT,
  with_pics_sync BIGINT,
  with_categories BIGINT,
  with_genres BIGINT,
  with_tags BIGINT,
  with_franchises BIGINT,
  with_parent_app BIGINT
)
```

---

## UI Components

### StatusBar

Top-level status indicator showing key health metrics.

```tsx
<StatusBar
  metrics={[
    { label: 'Running', value: 3, status: 'info' },
    { label: 'Jobs (24h)', value: 45, status: 'neutral' },
    { label: 'Success', value: '98.5%', status: 'success' },
    { label: 'Overdue', value: 12, status: 'warning' },
    { label: 'Errors', value: 0, status: 'success' },
    { label: 'PICS', value: '#1,234,567', status: 'info' },
  ]}
/>
```

**Status Colors:**
| Status | Color | Usage |
|--------|-------|-------|
| `success` | Green | Good state |
| `warning` | Yellow | Needs attention |
| `error` | Red | Critical issue |
| `info` | Teal/Cyan | Informational |
| `neutral` | Gray | No status |

### CollapsibleSection

Expandable section with badge and optional header content.

```tsx
<CollapsibleSection
  title="Data Completion"
  badge={{ value: '85%', variant: 'success' }}
  headerExtra={<span>1,234 / 1,500 complete</span>}
  defaultOpen={true}
>
  {/* Section content */}
</CollapsibleSection>
```

**Badge Variants:**
- `default` - Gray
- `success` - Green
- `warning` - Yellow
- `error` - Red
- `info` - Blue

### SourceCompletionCard

Displays sync completion for a data source.

```tsx
<SourceCompletionCard
  source="SteamSpy"
  icon="📊"
  synced={8500}
  total={10000}
  lastSync="2 hours ago"
/>
```

Features:
- Progress bar with percentage
- Last sync timestamp
- Source icon

### JobRow

Expandable row showing sync job details.

```tsx
<JobRow
  job={job}
  isExpanded={expandedJobIds.has(job.id)}
  onToggle={() => toggleJobExpanded(job.id)}
/>
```

Displays:
- Job status (running/completed/failed)
- Job type and batch size
- Success/processed/failed counts
- Duration
- Expandable details with timestamps and error messages

---

## Dashboard Sections

### Data Completion

Shows sync completion percentage for each data source:

| Source | Description |
|--------|-------------|
| SteamSpy | Player metrics and ownership data |
| Storefront | Game store page data |
| Reviews | Review counts and scores |
| Histogram | Review timeline data |
| Page Creation | Steam page creation dates |
| PICS | Real-time PICS data |

### Catalog Control

Shows applist coverage and catalog integrity:

- Current catalog app count
- Historical retained app count
- Latest applist start and completion timestamps
- Live-only missing apps
- Stale running applist jobs

### CCU Quality

Shows CCU coverage and source quality:

- Current catalog app count
- Tier-assigned versus unassigned apps
- Confirmed positive, confirmed zero, suspect zero, skipped, invalid, unavailable
- CCU source split across Steam API, SteamSpy, and legacy unknown
- Cached freshness timestamp and approximate fallback state

### Sync Queue

Displays priority distribution and queue status:

**Priority Tiers:**
| Tier | Score Range | Update Interval |
|------|-------------|-----------------|
| High | ≥150 | 6 hours |
| Medium | 100-149 | 12 hours |
| Normal | 50-99 | 24 hours |
| Low | 25-49 | 48 hours |
| Minimal | <25 | 7 days |

**Queue Status:**
- Overdue (past due time)
- Due in 1 hour
- Due in 6 hours
- Due in 24 hours

### PICS Service

Shows PICS sync state and data coverage:

- Change number (latest processed)
- Last update time
- Apps with PICS sync
- Coverage: tags, categories, genres, franchises, parent apps

### Sync Errors

Lists apps with consecutive sync errors:

- App name and ID
- Error count
- Error source
- Last error message
- Time since error

### Recent Jobs

Shows the most recent sync jobs with:

- Status badge (running/completed/failed)
- Job type
- Batch size
- Success/processed counts
- Duration
- Expandable details

### Last Sync Times

Quick view of when each source was last synced.

### Chat Logs

Integrated chat query logs with:

- Query statistics (total, avg response time, avg tools)
- Recent queries with tools used
- Session context summaries
- Guardrail traces and answer contract metadata when available
- Action buttons (Search, Copy)
- 7-day retention

### User Management (v2.1+)

Located at `/admin/users`. Allows admins to:
- View all registered users
- See credit balances and usage stats
- Grant or deduct credits
- Change user roles (user/admin)

### Waitlist Management (v2.1+)

Located at `/admin/waitlist`. Allows admins to:
- View pending signup requests
- Approve or reject applications
- See applicant details (name, org, intended use)
- Track approval history

### Usage Analytics (v2.1+)

Located at `/admin/usage`. Shows:
- Total credits consumed
- Average credits per chat
- Credit transaction history
- Per-user usage breakdown

---

## File Locations

| File | Purpose |
|------|---------|
| `apps/admin/src/app/(main)/admin/page.tsx` | Server component, data fetching |
| `apps/admin/src/app/(main)/admin/AdminDashboard.tsx` | Client component, UI |
| `apps/admin/src/lib/sync-queries.ts` | Query helpers and formatters |
| `supabase/migrations/20260328143000_phase3_catalog_control.sql` | Catalog control RPCs |
| `supabase/migrations/20260328224500_phase4a_ccu_confidence.sql` | CCU quality RPCs |
| `supabase/migrations/20260328235500_cache_ccu_quality_stats.sql` | CCU quality cache |
| `supabase/migrations/20260323110000_add_chat_phase1_quality_logs.sql` | Chat quality/session context columns |
| `supabase/migrations/20260327123000_add_app_capture_work_state.sql` | Work-state queue table |
| `apps/admin/src/app/(main)/admin/users/page.tsx` | User management (v2.1) |
| `apps/admin/src/app/(main)/admin/waitlist/page.tsx` | Waitlist approval (v2.1) |
| `apps/admin/src/app/(main)/admin/usage/page.tsx` | Usage analytics (v2.1) |
| `apps/admin/src/app/(main)/apps/page.tsx` | Games page (v2.6) |
| `apps/admin/src/app/(main)/apps/[appid]/page.tsx` | Game detail page (v2.6) |

---

## Mobile Responsiveness

The dashboard adapts to mobile screens:

- **StatusBar**: Wraps metrics to multiple rows
- **SourceCompletionCards**: 2 columns on mobile, 6 on desktop
- **Tables**: Switch to card layout on mobile
- **JobRow**: Stack info vertically on mobile
- **Collapsible sections**: All sections work on touch

---

## Data Types

### AdminDashboardData

```ts
interface AdminDashboardData {
  // Health metrics
  syncHealth: SyncHealthData;

  // Priority distribution
  priorityDistribution: PriorityDistribution;

  // Queue status
  queueStatus: QueueStatus;

  // Completion stats per source
  completionStats: SourceCompletionStats[];

  // PICS data
  picsDataStats: PICSDataStats;
  picsSyncState: PICSyncState;

  // Jobs
  runningJobs: SyncJob[];
  allJobs: SyncJob[];

  // Errors
  appsWithErrors: AppError[];

  // Chat logs
  chatLogs: ChatQueryLog[];

  // Counts
  fullyCompletedCount: number;
}
```

### SyncJob

```ts
interface SyncJob {
  id: string;
  job_type: string;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at: string | null;
  batch_size: number | null;
  items_processed: number | null;
  items_succeeded: number | null;
  items_failed: number | null;
  items_created: number | null;
  items_updated: number | null;
  error_message: string | null;
  github_run_id: string | null;
}
```

---

## Insights Dashboard (v2.2)

The Insights page (`/insights`) provides CCU analytics with sparkline visualizations, built on the tiered CCU tracking system.

### File Structure

```
apps/admin/src/app/(main)/insights/
├── page.tsx                    # Server component, parallel data fetch
├── InsightsTabs.tsx            # Tab management & state (client)
├── lib/
│   ├── insights-types.ts       # TypeScript type definitions
│   └── insights-queries.ts     # Data fetching functions
└── components/
    ├── TopGamesTab.tsx         # Top games by CCU
    ├── NewestGamesTab.tsx      # Recent releases
    ├── TrendingGamesTab.tsx    # Fastest growing games
    ├── TopGameCard.tsx         # Game row with sparklines
    ├── TimeRangeSelector.tsx   # 24h / 7d / 30d toggle
    └── InsightsSkeleton.tsx    # Loading skeleton
```

### Three Tabs

| Tab | Data Source | Sorting | Description |
|-----|-------------|---------|-------------|
| **Top Games** | ccu_snapshots (peak CCU) | By peak CCU | Top 50 games by CCU in selected time range |
| **Newest** | apps (release date) | By Release / By CCU Growth | Games released in past year with CCU data |
| **Trending** | ccu_snapshots (growth %) | By growth % | Top 50 games by CCU growth, min 10 avg CCU |

### Sparklines

Each game displays an inline CCU sparkline:

- **Data**: Downsampled to 12-15 points from ccu_snapshots
- **Size**: 70x24 pixels
- **Colors**: Green (up >5%), Red (down >5%), Blue (stable)
- **Component**: `TrendSparkline` from `/components/data-display/Sparkline.tsx`

### Metrics Displayed

| Column | Data Source | Description |
|--------|-------------|-------------|
| CCU | ccu_snapshots | Peak CCU with sparkline and growth % |
| Reviews | latest_daily_metrics | Total reviews, positive %, velocity/day |
| Price | latest_daily_metrics | Price with discount badge |
| Playtime | latest_daily_metrics | Average playtime in hours |

### Time Range Options

| Range | Sparkline Points | Granularity |
|-------|------------------|-------------|
| 24h | 12 points | Hourly |
| 7d | 14 points | Daily |
| 30d | 15 points | Daily |

### URL Parameters

- `?timeRange=7d` - Time period (24h, 7d, 30d)
- `?tab=top` - Active tab (top, newest, trending)
- `?sort=growth` - Newest tab sort (release, growth)

### Data Fetching

All three tabs fetch data in parallel on page load:

```ts
// page.tsx - Server Component
const [topGamesData, newestGamesData, trendingGamesData] = await Promise.all([
  getTopGames(timeRange),
  getNewestGames(timeRange, sortBy),
  getTrendingGames(timeRange),
]);
```

### GameInsight Type

```ts
interface GameInsight {
  appid: number;
  name: string;
  releaseDate: string | null;
  currentCcu: number;
  peakCcu?: number;
  avgCcu?: number;
  growthPct?: number;
  ccuSparkline?: number[];
  ccuTrend?: 'up' | 'down' | 'stable';
  totalReviews?: number;
  positivePercent?: number;
  reviewVelocity?: number;
  priceCents?: number | null;
  discountPercent?: number | null;
  isFree?: boolean;
  avgPlaytimeHours?: number | null;
}
```

### Responsive Design

Columns hide on smaller screens:
- **xs**: Game + CCU only
- **sm**: + Reviews
- **md**: + Price
- **lg**: + Playtime

---

## Related Documentation

- [Design System Architecture](../architecture/design-system.md) - UI components and theming
- [Games Page Architecture](./games-page.md) - Games page technical details (v2.6)
- [Chat Interface Guide](../../user-guide/chat-interface.md) - Chat system documentation
- [Games Page User Guide](../../user-guide/games-page.md) - Games page usage guide (v2.6)
- [v2.0 Release Notes](../../releases/v2.0-new-design.md) - Complete changelog
- [v2.2 Release Notes](../../releases/v2.2-ccu-steamspy.md) - CCU tiered tracking
- [v2.6 Release Notes](../../releases/v2.6-games-page.md) - Games page release (v2.6)
