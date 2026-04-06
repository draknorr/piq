# Admin Dashboard Architecture

This document describes the admin dashboard and related analytics pages in PublisherIQ.

**Last Updated:** April 6, 2026

## Overview

The admin dashboard is still Supabase-backed for its operational reads. It provides a comprehensive view of system health, sync status, catalog control, CCU quality, and data completion.

It also surfaces the current chat routing metadata for debugging, including route families, execution traces, and contract summaries.

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

The operational pages do not route through query-api. Tiger-backed routing appears only in the chat logs and the chat runtime itself.

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

Four PostgreSQL functions consolidate counting operations:

#### get_priority_distribution()

Returns count of apps by priority tier in a single query.

#### get_queue_status()

Returns count of apps due for sync at different intervals.

#### get_source_completion_stats()

Returns sync completion stats for all data sources.

**Returns rows for:** steamspy, storefront, reviews, histogram, page_creation

#### get_catalog_control_stats()

Returns catalog control and applist coverage stats.

#### get_ccu_quality_stats()

Returns CCU quality coverage and source distribution stats.

#### get_pics_data_stats()

Returns PICS data completion statistics.

---

## UI Components

### StatusBar

Top-level status indicator showing key health metrics.

## Chat Logs

The chat logs section shows the last seven days of queries plus the route summary fields used by the current chat runtime:

- query text
- tools used
- execution timing
- iteration counts
- quality flags
- session context summary
- answer contract summary
- Tiger primary/shadow routing summary when present

## Related Documentation

- [Admin Guide](../../admin-guide/dashboard.md)
- [Chat Logs](../../admin-guide/chat-logs.md)
- [Change Feed Feature](./change-feed.md)
