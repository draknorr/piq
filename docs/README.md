# PublisherIQ Documentation

PublisherIQ documentation is organized by audience and aligned with the current runtime behavior.

**New here?** Start with [START-HERE.md](START-HERE.md).

## Current-State Anchors

These docs describe the live May 2026 operating model and should be treated as canonical:

- **[System Overview](developer-guide/architecture/overview.md)** - high-level architecture and load sharing
- **[TigerData Operating Model](developer-guide/architecture/tigerdata-operating-model.md)** - current Supabase/TigerData/R2/Cube split and operational flow
- **[Query API README](../apps/query-api/README.md)** - live contract service, environments, and contract ownership
- **[YouTube Collector README](../packages/youtube/README.md)** - current Steam-scoped YouTube ingestion and rollup surface
- **[Tiger Chat Production](developer-guide/deployment/tiger-chat-production.md)** - preview/production deployment and refresh topology

Historical Tiger rollout/spec docs still exist under `docs/specs/`, but they are no longer the primary source of truth.

---

## Documentation Structure

| Section | Audience | Description |
|---------|----------|-------------|
| [User Guide](user-guide/) | End users | Product usage, navigation, auth, and workflows |
| [Admin Guide](admin-guide/) | Administrators | Operations, troubleshooting, and user management |
| [Developer Guide](developer-guide/) | Developers | Architecture, setup, workers, deployment, and feature internals |
| [API](api/) | Developers | Internal dashboard and streaming APIs |
| [Reference](reference/) | All | Data dictionaries, source notes, and research docs |
| [Releases](releases/) | All | Release notes and changelogs |
| [Specs](specs/) | Historical | Dated design records and implementation plans |
| [Reports](reports/) | Historical | Point-in-time analysis and research outputs |
| [Archive](archive/) | Historical | Older docs kept for reference |

---

## Latest Release

**[v2.13 - Tiger Primary Ingestion](releases/v2.13-tiger-primary-ingestion.md)** (May 1, 2026)

Highlights:
- Tiger/R2 are primary for accepted incoming ingestion and product-data paths
- Supabase is retained for auth/session/reference/legacy/product surfaces not proven Tiger-backed; no new product/ingestion writes should be added there
- PR #8/#9/#10 landed the Tiger change-intel startup fix, review claim fix, and embedding candidate repair, with successful embedding smoke runs on commit `7be82955`

---

## User Guide

- **[Getting Started](user-guide/getting-started.md)** - First run and navigation overview
- **[Change Feed](user-guide/change-feed.md)** - Track recent Steam storefront, PICS, media, and news changes
- **[Global Search](user-guide/search.md)** - Quick search with `⌘K`
- **[Keyboard Shortcuts](user-guide/keyboard-shortcuts.md)** - All keyboard shortcuts
- **[Insights Page](user-guide/insights-page.md)** - Top games, newest releases, trending, and personalized tabs
- **[Games Page](user-guide/games-page.md)** - Game discovery and analytics
- **[Companies Page](user-guide/companies-page.md)** - Unified publishers and developers
- **[Chat Interface](user-guide/chat-interface.md)** - Natural language queries
- **[Chat Query Examples](user-guide/chat-query-examples.md)** - Example prompts
- **[Search & Discovery](user-guide/search-discovery.md)** - Discovery styles and current chat capabilities
- **[Personalization](user-guide/personalization.md)** - Pins, alerts, and My Dashboard
- **[Account](user-guide/account.md)** - Sign-in, profile, and credits
- **[Credit System](user-guide/credit-system.md)** - How credits work
- **[Theming](user-guide/theming.md)** - Light and dark themes

---

## Admin Guide

- **[Overview](admin-guide/overview.md)** - Admin quick start
- **[Dashboard](admin-guide/dashboard.md)** - System health, queue status, and operational views
- **[Chat Logs](admin-guide/chat-logs.md)** - Query debugging, traces, and contract summaries
- **[Troubleshooting](admin-guide/troubleshooting.md)** - Common auth, runtime, query-api, and deployment fixes

---

## Developer Guide

### Setup

- **[Prerequisites](developer-guide/prerequisites.md)** - Required tools
- **[Installation](developer-guide/installation.md)** - Clone and install
- **[Environment Setup](developer-guide/setup.md)** - Configure variables

### Architecture

- **[System Overview](developer-guide/architecture/overview.md)** - High-level system design
- **[TigerData Operating Model](developer-guide/architecture/tigerdata-operating-model.md)** - current live data-plane split
- **[Database Schema](developer-guide/architecture/database-schema.md)** - Supabase schema plus TigerData schema slices
- **[Sync Pipeline](developer-guide/architecture/sync-pipeline.md)** - Worker and data-plane refresh flow
- **[Chat Data System](developer-guide/architecture/chat-data-system.md)** - current chat and contract runtime
- **[Design System](developer-guide/architecture/design-system.md)** - UI tokens and patterns
- **[Data Sources](developer-guide/architecture/data-sources.md)** - External and internal acquisition sources

### Features

- **[Change Feed](developer-guide/features/change-feed.md)** - `/changes` feature internals
- **[Games Page](developer-guide/features/games-page.md)** - Technical details
- **[Companies Page](developer-guide/features/companies-page.md)** - Implementation
- **[Admin Dashboard](developer-guide/features/admin-dashboard.md)** - Architecture
- **[Personalization](developer-guide/features/personalization.md)** - Pins and alerts
- **[Smart Query Suggestions](developer-guide/features/smart-query-suggestions.md)** - Search assistance

### Workers

- **[Overview](developer-guide/workers/overview.md)** - Worker system
- **[Running Workers](developer-guide/workers/running-workers.md)** - Manual execution
- **[Adding Workers](developer-guide/workers/adding-workers.md)** - Create new workers
- **[Steam Change Intelligence](developer-guide/workers/steam-change-intelligence.md)** - Change-intel operations

### Deployment

- **[Vercel](developer-guide/deployment/vercel.md)** - Dashboard deployment
- **[Tiger Chat](developer-guide/deployment/tiger-chat-production.md)** - Tiger/query-api preview and production rollout
- **[Fly.io](developer-guide/deployment/fly-io.md)** - Cube.js deployment
- **[Railway](developer-guide/deployment/railway.md)** - PICS service and query-api deployment notes
- **[Supabase](developer-guide/deployment/supabase.md)** - Supabase write/control-plane setup
- **[GitHub Actions](developer-guide/deployment/github-actions.md)** - Scheduled syncs and Tiger refresh workflows

---

## API Documentation

- **[Overview](api/overview.md)** - API navigation
- **[Streaming API](api/streaming-api.md)** - Chat SSE protocol
- **[Internal API](api/internal-api.md)** - Dashboard and Change Feed endpoints
- **[Steam API](api/steam-api.md)** - External API specs
- **[Rate Limits](api/rate-limits.md)** - Rate limiting reference

---

## Reference

- **[PICS Data Fields](reference/pics-data-fields.md)** - PICS field reference and authority rules
- **[SQL Examples](reference/sql-examples.md)** - Query patterns
- **[Data Gaps Analysis](reference/data-gaps-analysis.md)** - Coverage analysis
- **[Data Sources Comprehensive](reference/data-sources-comprehensive.md)** - Broader source inventory
- **[Steam Game Change Intelligence Research](reference/steam-game-change-intelligence-research.md)** - Research and roadmap context
- **[Tiger Target Baselines](reference/tiger-target-baseline/)** - captured TigerData baseline and parity artifacts

---

## Previous Releases

- **[v2.12 - YouTube Coverage, Tiger Recovery, and Price Reliability](releases/v2.12-youtube-tiger-price-refresh.md)** - per-game YouTube chat coverage and Tiger recovery/pricing docs
- **[v2.11 - Chat Contract Cutover and TigerData Operating Model](releases/v2.11-chat-contract-cutover.md)** - contract-first Tiger/query-api cutover baseline
- **[v2.10 - Chat News, CCU Quality, and Ops Refresh](releases/v2.10-chat-news-ops-refresh.md)** - recent-news and ops baseline before the broader contract cutover doc refresh
- **[v2.9 - Change Feed, Auth Hardening, and Change Intelligence](releases/v2.9-change-feed-auth-intelligence.md)** - Change Feed, auth, and change-intel baseline
- **[v2.8 - Security Fixes](releases/v2.8-security-fixes.md)** - OTP auth and security hardening baseline
- **[v2.7 - Command Palette](releases/v2.7-design-command-palette.md)** - Filter syntax and command palette
- **[v2.6 - Games Page](releases/v2.6-games-page.md)** - Game discovery dashboard
- **[v2.5 - Companies Page](releases/v2.5-companies-page.md)** - Unified publishers/developers
- **[v2.4 - Personalization](releases/v2.4-personalization.md)** - Pins and alerts
- **[v2.3 - Embedding Optimization](releases/v2.3-embedding-optimization.md)** - Faster sync
- **[v2.2 - CCU & SteamSpy](releases/v2.2-ccu-steamspy.md)** - Tiered CCU tracking
- **[v2.1 - Velocity & Auth](releases/v2.1-velocity-auth.md)** - Auth and velocity sync
- **[v2.0 - New Design](releases/v2.0-new-design.md)** - Design system overhaul
