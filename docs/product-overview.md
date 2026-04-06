# PublisherIQ - Product Overview

> **Steam Data Analytics Platform with AI Chat Interface**

PublisherIQ is an enterprise-grade analytics platform for Steam game data. It consolidates real-time data from Steam, SteamSpy, Steam News, and PICS into a single dashboard with advanced filtering, AI-powered natural language querying, change-intelligence monitoring, and personalized alerting. Built on Next.js 15, Supabase, Cube.js, and a TigerData-backed query-api, the platform tracks 200,000+ games, 15M+ daily metric records, and 5M+ concurrent user snapshots to deliver deep insight into game performance, publisher portfolios, and market trends.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Platform Features](#2-platform-features)
   - [Games Page](#21-games-page)
   - [Companies Page](#22-companies-page)
   - [Insights Dashboard](#23-insights-dashboard)
   - [Change Feed](#24-change-feed)
   - [Command Palette & Search](#25-command-palette--search)
   - [AI Chat Interface](#26-ai-chat-interface)
   - [Personalization & Alerts](#27-personalization--alerts)
   - [Credit System](#28-credit-system)
   - [Account & Authentication](#29-account--authentication)
   - [Admin Dashboard](#210-admin-dashboard)
3. [Data Sources & Collection](#3-data-sources--collection)
4. [Metrics & Analytics](#4-metrics--analytics)
5. [Architecture & Infrastructure](#5-architecture--infrastructure)
6. [Performance & Reliability](#6-performance--reliability)
7. [Security](#7-security)
8. [Design System](#8-design-system)
9. [Product Evolution](#9-product-evolution)
10. [Data Coverage & Future Opportunities](#10-data-coverage--future-opportunities)

---

## 1. Executive Summary

### What is PublisherIQ?

PublisherIQ is a data analytics platform purpose-built for the Steam gaming ecosystem. It transforms raw data from Steam's APIs, SteamSpy, and Valve's Product Info Cache Server (PICS) into actionable intelligence for game publishers, developers, investors, and market analysts.

### Core Value Proposition

- **Unified View**: All Steam game data consolidated into a single, searchable platform
- **Real-Time Tracking**: Hourly concurrent user monitoring for top games, with tiered polling for the full catalog
- **Change Intelligence**: Track grouped storefront, media, PICS, and news changes in a unified Steam Activity feed, plus recent-news and before/after detail in chat
- **AI-Powered Analysis**: Ask natural language questions and receive structured, data-backed answers across analytics, discovery, and change-intel tools
- **Deep Discovery**: 12 preset views, 40+ filter parameters, and 6 computed insight metrics for finding hidden gems, tracking trends, and comparing games
- **Personalized Monitoring**: Pin games and companies, receive alerts on CCU spikes, trend reversals, review surges, and more

### Current Serving Model

PublisherIQ now runs with a split serving model:

- **Supabase** remains the write authority and control plane for ingestion, queues, auth, operational state, and the current page-serving RPCs
- **TigerData (Timescale)** powers the contract-serving read plane through `query-api`
- **Cube.js** remains in the stack for compatibility and legacy analytics reads that have not yet moved onto typed Tiger-backed contracts

This means the system should be understood as a multi-plane runtime, not a single-database application.

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TailwindCSS |
| Write / Control Plane | Supabase (PostgreSQL) with materialized views and RPC read surfaces |
| Semantic Layer | Cube.js (27 cubes across 9 model files, now primarily compatibility-focused) |
| Contract Read Plane | TigerData-backed `query-api` contracts for chat, semantic retrieval, momentum, change/news, user context, and continuation |
| Semantic Retrieval | Tiger-backed retrieval tables with OpenAI embeddings |
| LLM | GPT-4o-mini (default), streaming via SSE |
| Ingestion | TypeScript workers, repair scripts, and change-intel runtime |
| PICS Service | Python microservice (SteamKit2; bulk, first-pass, and change-monitor modes) |

### Scale

| Table | Approximate Rows |
|-------|-----------------|
| `apps` | 200,000 |
| `daily_metrics` | 15,000,000+ |
| `ccu_snapshots` | 5,000,000+ |
| `review_deltas` | 3,000,000+ |
| `app_steam_tags` | 1,500,000+ |

---

## 2. Platform Features

### 2.1 Games Page

The Games page (`/apps`) is the primary discovery and analysis interface, offering the most comprehensive game filtering system available for Steam data.

#### Game Type Toggle

Browse by content type:
- **All Types** - All apps (games, DLC, demos)
- **Games** - Games only (default)
- **DLC** - Downloadable content
- **Demos** - Demo versions

#### 12 Preset Views

One-click discovery patterns:

| Preset | Description | Key Filters |
|--------|-------------|-------------|
| Top Games | Most popular by players | CCU >= 1,000 |
| Rising Stars | Growing with limited reach | Growth 7d >= 25%, Owners < 500K |
| Hidden Gems | Highly rated undiscovered | Score >= 90%, Owners < 50K, Reviews >= 100 |
| New Releases | Recently launched | Age <= 30 days |
| Breakout Hits | New games exploding | Growth >= 50%, Age <= 90 days |
| High Momentum | Strong upward trajectory | Momentum >= 15, CCU >= 500 |
| Comeback Stories | Improving sentiment | Sentiment Delta >= 5%, Reviews >= 1,000 |
| Evergreen | Classics still thriving | Age >= 730d, CCU >= 1,000, Score >= 80% |
| True Gems | Highly rated, engaged community | Score >= 90%, Owners < 50K, Review Rate >= 5 |
| Best Value | Most entertainment per dollar | Value Score >= 2, Score >= 75% |
| Publisher's Best | Outperforming publisher average | vs Publisher >= +10 |
| F2P Leaders | Top free-to-play games | Free = true, CCU >= 5,000 |

#### 12 Stackable Quick Filters

Combinable toggle filters with AND logic:

| Filter | Criteria |
|--------|----------|
| Popular | CCU >= 1,000 |
| Trending | Growth 7d >= 10% |
| Well Reviewed | Score >= 85% |
| Free | is_free = true |
| Indie | Publisher game count < 10 |
| Steam Deck | Verified or Playable |
| Momentum | Momentum Score >= 10 |
| Sentiment | Sentiment Delta >= 3% |
| Workshop | has_workshop = true |
| Early Access | release_state = prerelease |
| On Sale | Discount > 0% |
| This Week | Age <= 7 days |

#### 9 Advanced Filter Categories (40+ Parameters)

- **Metrics**: Peak CCU, Owners, Reviews, Review Score, Price, Playtime (all min/max ranges)
- **Growth**: CCU Growth 7d/30d with presets (Growing/Stable/Declining), Momentum Score range
- **Sentiment**: Sentiment Delta with presets (Improving/Stable/Declining/Review Bomb), Velocity Tier
- **Engagement**: Active Player %, Review Rate, Value Score
- **Content**: Genres (multi-select, Any/All mode), Tags (searchable with counts), Categories, Workshop toggle
- **Platform**: Platforms (Windows/Mac/Linux, Any/All mode), Steam Deck (Verified/Playable/Unsupported), Controller Support
- **Release**: Period presets (7d/30d/90d/year), Age range, Early Access toggle, Hype Duration
- **Relationship**: Publisher/Developer search, Self-Published toggle, vs Publisher Avg presets, Publisher Size (Indie/Mid/Major)
- **Activity**: CCU Tier (Hot/Active/Quiet)

#### 33 Customizable Columns Across 9 Categories

| Category | Columns |
|----------|---------|
| Core (2) | Rank, Name |
| Engagement (3) | Avg Playtime, Playtime 2w, Active Player % |
| Reviews (7) | Reviews, Score %, Velocity 7d, Velocity 30d, Velocity Tier, Sentiment Delta, Review Rate |
| Growth (6) | Peak CCU, Growth 7d, Growth 30d, Momentum, Acceleration, Sparkline |
| Financial (4) | Price, Discount, Owners, Value Score |
| Context (4) | Publisher, Developer, vs Publisher Avg, Publisher Games |
| Timeline (3) | Release Date, Days Live, Hype Duration |
| Platform (3) | Steam Deck, Platforms, Controller |
| Activity (1) | CCU Tier |

#### Comparison Mode

Select 2-5 games for side-by-side comparison:
- 17 metrics across Engagement, Reviews, Growth, and Financial categories
- Percentage difference from baseline (first selected game)
- "vs Average" column comparing to the selected games' average
- Best/worst values highlighted per row (green/red)
- Shareable URL format: `?compare=730,1245620,553850`
- Export comparison as CSV

#### Export

Export data in CSV or JSON format:
- Scope: All filtered results or selected games only
- Columns: Visible columns only or all metrics
- Filter metadata included as CSV comments

#### Saved Views

Save up to 10 named filter/column/sort configurations per browser. Saved views persist in localStorage with unique IDs.

#### Inline Sparklines

70x24px CCU trend visualizations:
- 7-day data with 12-15 points
- Color-coded: Green (up >5%), Red (down >5%), Blue (stable)
- Lazy-loaded via IntersectionObserver with batch fetching

---

### 2.2 Companies Page

The Companies page (`/companies`) provides a unified view of publishers and developers with portfolio-level analytics.

#### Company Type Toggle

- **All** - All publishers and developers with role badge
- **Publishers** - Publishers only
- **Developers** - Developers only

#### 4 Preset Views

| Preset | Description | Key Filters |
|--------|-------------|-------------|
| Market Leaders | Top companies by revenue | $10M+ revenue |
| Rising Indies | Small studios with growth | <= 10 games, 10%+ 7d growth |
| Breakout | Rapid growth, smaller scale | 50%+ growth, <1M owners |
| Growing Publishers | Publishers with momentum | Publishers only, 10%+ growth |

#### 7 Quick Filters

| Filter | Criteria |
|--------|----------|
| Major 10+ | >= 10 games |
| Prolific 5+ | >= 5 games |
| Active | Released in last 12 months |
| Trending | Any positive CCU growth |
| $1M+ | >= $1M estimated revenue |
| $10M+ | >= $10M estimated revenue |
| 100K+ | >= 100K total owners |

#### 9 Advanced Filter Categories (25+ Parameters)

Metric ranges (Game Count, Total Owners, Peak CCU, Weekly Hours, Revenue, Avg Review Score, Total Reviews), growth filters (CCU Growth 7d/30d), content filters (Genres, Tags, Categories, Steam Deck, Platforms), and status/relationship filters (Activity Status, Relationship Type: Self-Published/External Devs/Multi-Publisher).

#### 17 Columns Across 7 Categories

| Category | Columns |
|----------|---------|
| Engagement | Est. Weekly Hours, Total Owners, Peak CCU |
| Content | Games, Unique Devs, Role |
| Reviews | Reviews, Avg Score, Review Velocity |
| Financial | Est. Gross Revenue |
| Growth | CCU Growth (7d), CCU Growth (30d), Trending |
| Ratios | Revenue/Game, Owners/Game, Reviews/1K Owners |
| Visualization | CCU Sparkline |

#### Computed Ratio Columns

| Ratio | Formula | Insight |
|-------|---------|---------|
| Revenue/Game | Total Revenue / Game Count | Average revenue per title |
| Owners/Game | Total Owners / Game Count | Average game reach |
| Reviews/1K Owners | (Reviews / Owners) x 1,000 | Audience engagement rate |

#### Comparison, Export, Saved Views

Same capabilities as the Games page: 2-5 company comparison with baseline calculations, CSV/JSON export, and up to 10 saved views. Company comparison uses serialized IDs (e.g., `pub:123`, `dev:456`).

#### Growth Indicators

Color-coded growth display:

| Growth | Indicator | Color |
|--------|-----------|-------|
| >= 50% | Rocket | Bright green |
| 10-49% | Up arrow | Green |
| -10% to 10% | Right arrow | Gray |
| -49% to -10% | Down arrow | Orange |
| <= -50% | Chart down | Red |

---

### 2.3 Insights Dashboard

The Insights page (`/insights`) provides a curated analytics overview with four tabs.

#### My Dashboard (Personalized)

- **Recent Alerts**: 5 most recent alerts with severity indicators
- **Pinned Items**: Responsive grid of all pinned games, publishers, and developers with live metrics
- **Settings modal** for alert preferences
- Empty state with browse links for new users

#### Top Games Tab

Top 50 games sorted by peak CCU in the selected time range. Each row displays:
- Peak CCU with trend sparkline
- Total reviews with positive percentage (color-coded)
- Review velocity (reviews per day)
- Price with discount badge
- Average playtime in hours

#### Newest Tab

Recently released games with CCU data. Two sort modes:
- **By Release** - Newest games first
- **By CCU Growth** - Highest growth percentage first

#### Trending Tab

Top 50 games sorted by CCU growth percentage. Highlights games experiencing the fastest growth.

#### Time Range Selector

| Range | Granularity | Sparkline Points |
|-------|-------------|-----------------|
| 24h | Hourly | 12 |
| 7d | Daily | 14 (default) |
| 30d | Daily | 15 |

#### Responsive Design

Columns hide progressively on smaller screens:
- xs: Game name + CCU only
- sm: + Reviews
- md: + Price
- lg: + Playtime

---

### 2.4 Change Feed

The Change Feed (`/changes`) is a unified Steam Activity surface that combines grouped bursts, announcement cards, and news drill-downs in one place.

#### Views and Modes

- **Views**: Overview, Launch Watch, Commercial Moves, Store Refreshes, and All Activity
- **Modes**: All activity, Changes only, or Announcements only
- **Status**: healthy, catching_up, or delayed capture health states

#### Feed Presets

| Preset | Purpose |
|--------|---------|
| High Signal | Higher-value non-trivial bursts |
| Upcoming Radar | Upcoming games and recent launches |
| All Changes | Full recency stream |

#### Filters

- time range: `24h`, `7d`, `30d`
- app type
- signal family
- search by app name, headline, or theme
- sort by relevance, recency, or commercial/launch emphasis

#### Detail View

Each activity card can expand into:

- individual change events
- related announcements
- before / after diffs when available
- impact windows showing pre/post movement in key metrics

---

### 2.5 Command Palette & Search

#### Command Palette

Open with `Cmd+K` (macOS) or `Ctrl+K` (Windows/Linux) on the Games or Companies pages.

**Views:**
- **Home**: Search, presets, quick filters, genre shortcuts
- **Tags**: Browse all Steam tags with counts
- **Genres**: Browse all genres with counts
- **Categories**: Browse Steam categories

**Filter Syntax** - Type expressions directly:

| Format | Example | Description |
|--------|---------|-------------|
| `shortcut > value` | `ccu > 50000` | Greater than |
| `shortcut min-max` | `ccu 1000-50000` | Between range |
| `shortcut:yes/no` | `workshop:yes` | Boolean filter |
| `genre:value` | `genre:action` | Content filter |
| Preset name | `rising stars` | Apply preset |

**17 Available Shortcuts**: `ccu`, `owners`, `reviews`, `score`, `price`, `growth`, `momentum`, `playtime`, `free`, `ea`, `workshop`, `sale`, `indie`, `genre`, `tag`, `deck`, `platform`

#### Active Filter Bar

Applied filters displayed as color-coded chips grouped by category:

| Category | Color |
|----------|-------|
| Preset | Purple |
| Quick Filter | Coral |
| Metric | Blue |
| Content | Green |
| Platform | Orange |
| Release | Amber |
| Relationship | Pink |

Chips are clickable (modify filter) and dismissible (remove filter).

#### Global Search

Open with `Cmd+K` / `Ctrl+K` from any page:
- 2-character minimum, 150ms debounce
- Searches games, publishers, and developers simultaneously
- Results grouped by entity type with key metrics
- Smart ordering (exact matches first, then by relevance)
- Chat integration: "Ask in Chat" and "Find Similar" quick actions

---

### 2.6 AI Chat Interface

The AI chat interface (`/chat`) enables natural language querying of all platform data.

#### Architecture

1. **Natural Language Understanding**: User query interpreted by the LLM
2. **Contract Routing**: The runtime resolves the request into typed query contracts and only falls back to compatibility paths when needed
3. **Query Execution**: The app routes requests into Tiger-backed contracts, Supabase-backed read surfaces, and limited compatibility analytics paths
4. **Entity Linking**: Results enriched with clickable links to game/company pages
5. **Streaming Response**: Results streamed via Server-Sent Events (SSE)

#### Current Contract Families

The chat runtime is now contract-first. The live serving surface centers on these typed query contracts:

| Contract family | Current contracts |
|-----------------|------------------|
| Entity resolution and context | `resolveEntities`, `getEntityOverview`, `getRelatedEntities`, `getUserContext` |
| Catalog search and ranking | `searchCatalog`, `rankEntities`, `compareEntities`, `discoverMomentum` |
| History, change, and news | `traceMetricHistory`, `searchChangeActivity`, `explainChanges`, `discoverChangePatterns`, `searchDocuments` |
| Semantic retrieval and continuation | `semanticSearch`, `continueResultSet` |

The older tool-era naming still exists in some compatibility traces and historical documents, but the current system should be understood in terms of contracts and capability families rather than individual ad hoc tool labels.

#### Query Capabilities

The chat supports a wide range of queries across categories:

- **Game Information**: "Tell me about Elden Ring", "What's the CCU for Counter-Strike 2?"
- **Discovery by Tags & Genres**: "Top roguelike games by review score", "Action RPGs with Steam Workshop"
- **Concept Search**: "Games like Stardew Valley but darker", "Tactical roguelikes with deck building"
- **Trend Discovery**: "What games are gaining momentum?", "Breaking out hidden gems", "Games losing players"
- **Similar Games**: "Find games similar to Hades", "Games like Celeste under $20"
- **Publisher & Developer Analysis**: "How many games has Devolver Digital published?", "Top publishers by revenue"
- **Recent News**: "What actually changed in the latest Steam news for ARC Raiders?" / "Which games posted patch notes lately?"
- **Change Patterns**: "Find under-marketed games" / "Which games look like signable candidates?"
- **Steam Deck & Platform**: "Best Steam Deck verified games", "Linux-compatible games with multiplayer"
- **Price & Deals**: "Top rated games under $10", "Best free-to-play games"
- **Historical & Time-Based**: "Games released this month with best reviews", "CCU trends for Terraria over 30 days"
- **Review & Velocity Analysis**: "Games with accelerating review velocity", "Recent review bombs"
- **Advanced Multi-Criteria**: "Indie roguelikes under $20 with 90%+ reviews and Steam Deck verified"

#### Query Details Panel

Every chat response includes an expandable details panel showing:
- Contract calls and routing decisions (name, parameters, duration)
- Execution traces and backend source summaries
- LLM iteration details
- Structured result data
- Session carry-forward context and guardrail/quality metadata

#### Streaming Protocol

Responses stream via SSE with these event types:
- `text_delta` - Incremental text content
- `tool_start` - Tool execution beginning
- `tool_result` - Tool execution results
- `message_end` - Response complete with usage stats, plus `quality` and `sessionContext` when phase-1 chat quality is enabled
- `error` - Error information

#### Smart Suggestions

Two complementary features assist users:
- **Type-Ahead Autocomplete**: Instant client-side filtering (<50ms) + debounced API calls for entity names
- **Post-Response Suggestions**: Clickable follow-up query chips generated from tool results (zero LLM cost)

---

### 2.7 Personalization & Alerts

#### Pin System

Pin any game, publisher, or developer from its detail page to track it on your personalized dashboard:
- Optimistic UI with rollback on error
- Pin button available on `/apps/{appid}`, `/publishers/{id}`, `/developers/{id}`

#### 8 Alert Types

| Alert Type | Trigger | Default Severity |
|------------|---------|-----------------|
| CCU Spike | +50% above 7-day average | Medium (High if >100%) |
| CCU Drop | -50% below 7-day average | Medium (High if >75%) |
| Trend Reversal | 30-day trend direction changed | Medium |
| Review Surge | Velocity >3x normal | Medium (High if >5x) |
| Sentiment Shift | Positive ratio changed >5% | Medium |
| Price Change | Any price/discount change | Low (High if >50% discount) |
| New Release | Pinned publisher/developer released a game | High |
| Milestone | Crossed 10K/50K/100K/500K/1M reviews | Medium (High if >100K) |

#### Alert Detection

- **Hourly Worker**: Runs hourly via scheduled job, detects CCU anomalies, trend changes, review surges, sentiment shifts, milestones
- **Database Triggers**: Real-time detection for price changes and new releases
- **Deduplication**: Maximum one alert per type per entity per user per day

#### Alert Preferences

- **Global toggles**: Enable/disable all alerts or specific alert types
- **Sensitivity sliders**: Adjust detection thresholds (0.5x to 2.0x multiplier)
- **Per-pin overrides**: Customize sensitivity for individual pinned items with inheritance from global settings

---

### 2.8 Credit System

The credit system manages AI chat usage with transparent cost tracking.

#### Capability Costs

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

#### Token Costs

- **Input tokens**: 2 credits per 1,000 tokens
- **Output tokens**: 8 credits per 1,000 tokens
- **Minimum charge**: 4 credits per message

#### Reservation Pattern

Credits are reserved before chat execution and finalized after completion. If a server error occurs, the reservation is automatically refunded.

#### Rate Limits

- 10 requests per minute
- 100 requests per hour

#### Getting Credits

- **Signup bonus**: Initial credit grant upon account approval
- **Admin grants**: Administrators can grant or deduct credits with optional descriptions

---

### 2.9 Account & Authentication

#### OTP-First Authentication with Compatibility Callbacks

| Setting | Value |
|---------|-------|
| Code format | 8-digit numeric |
| Code expiry | 10 minutes |
| Rate limit | 3 attempts per 15 minutes |
| Resend cooldown | 60 seconds |

**Login Flow:**
1. Enter email on `/login`
2. System validates against approved waitlist
3. OTP email sent with 8-digit code
4. Enter code to complete sign-in
5. Session established with secure cookies
6. Redirect back to the requested route via `?next=...`

**Operational Notes:**
- `/auth/callback` and `/auth/confirm` remain for callback compatibility
- browser redirects are normalized through `NEXT_PUBLIC_SITE_URL`
- the browser waits for an authoritative authenticated user before redirecting

#### Invite-Only Access

New users apply via a waitlist form. Administrators review and approve applications. Upon approval, the user receives an invitation and signup bonus credits.

---

### 2.10 Admin Dashboard

The admin dashboard provides system health monitoring and user management across four pages.

#### Main Dashboard (`/admin`)

**Status Bar** - 6 real-time metrics:
- Running (active sync jobs)
- Jobs 24h (completed in last 24 hours)
- Success % (completion rate)
- Overdue (past-due syncs)
- Errors (recent failures)
- PICS (service status)

**Data Completion** - Progress tracking across 5 sources: SteamSpy, Storefront, Reviews, Histogram, and PICS

**Sync Queue** - Priority distribution across 5 tiers with sync intervals:

| Tier | Interval |
|------|----------|
| High | 6 hours |
| Medium | 12 hours |
| Normal | 24 hours |
| Low | 48 hours |
| Minimal | 7 days |

**PICS Service** - Change number, last update, data coverage breakdown

**Catalog Control** - Current catalog coverage, historical retention, and live-app coverage gaps

**CCU Quality** - Confirmed positive/zero counts, suspect zeroes, source mix, and confidence state

**Sync Errors** - Filterable error list with app name, error count, source, message, timestamp

**Recent Jobs** - 10 most recent sync jobs with expandable details

**Chat Logs** - Query analytics with tool usage, timing metrics, iteration counts, quality flags, session context, and guardrail traces

#### User Management (`/admin/users`)

- User table: Email, Name, Role, Credits, Created, Last Sign-In
- Actions: Change role (user/admin), adjust credits with optional description
- Search by email or name

#### Waitlist Management (`/admin/waitlist`)

- Application table: Email, Name, Organization, Intended Use, Submitted, Status
- Actions: Approve (sends invite + signup bonus) or Reject (silent)
- Status filtering: Pending/Approved/Rejected/All

#### Usage Analytics (`/admin/usage`)

- Summary cards: Credits in System, Total Credits Used, Total Messages, and recent-window activity
- Time range selector: 7d/30d/90d
- Transaction history with type/amount/description
- Top users breakdown and tool usage frequency

---

## 3. Data Sources & Collection

### 3.1 Seven Data Sources

PublisherIQ consolidates data from seven external sources organized in a three-tier hierarchy.

#### Tier 1 - Authoritative Steam APIs

| Source | Data Provided | Rate Limit | Update Frequency |
|--------|--------------|------------|-----------------|
| **Steam App List** | Master inventory of all Steam apps (appid, name, type) | 100K requests/day | Daily |
| **Steam Storefront API** | Developers, publishers, pricing, release dates, categories, genres, platforms (AUTHORITATIVE for developer/publisher names) | ~200 requests/5 min | Every 6-12 hours |
| **Steam News API** | Public announcements, update posts, and recent-news history for change-intelligence search | App-dependent / recent only | Continuous / near real-time |
| **Steam Reviews API** | Review counts, positive/negative totals, review score | 60 requests/min | 4-72 hours (velocity-based) |
| **Steam Review Histogram** | Monthly review aggregates for trend analysis | 60 requests/min | Weekly |
| **Steam CCU API** | Exact concurrent player counts (replaced SteamSpy estimates in v2.2) | 1 request/sec | Hourly to daily (tiered) |

#### Tier 2 - Enrichment

| Source | Data Provided | Rate Limit | Update Frequency |
|--------|--------------|------------|-----------------|
| **SteamSpy API** | Owner estimates, average/median playtime, tags with vote counts | 1 req/60s (bulk), 1 req/s (detail) | Daily |

#### Tier 3 - Specialized

| Source | Data Provided | Rate Limit | Update Frequency |
|--------|--------------|------------|-----------------|
| **PICS Service** | Tags, genres, categories, franchises, Steam Deck compatibility, controller support, review score/percentage, store_asset_mtime, parent app relationships | N/A (SteamKit2 connection) | Continuous monitoring |

The PICS service runs in `bulk_sync`, `first_pass`, or `change_monitor` mode depending on whether the goal is a full backfill, prioritized new-app backfill, or continuous change monitoring.

### 3.2 Sync Pipeline

#### Worker Schedule

| Worker | Schedule | Batch Size | Duration |
|--------|----------|------------|----------|
| App List Sync | Daily 00:15 UTC | Full catalog | 2-5 min |
| SteamSpy Sync | Daily 01:00 UTC | Full catalog | 4-6 hours |
| Storefront Sync | 3x daily | Priority-based | 1-2 hours per 10K apps |
| Reviews Sync | 3x daily | Velocity-based | 30-60 min per 10K apps |
| Histogram Sync | Weekly | Full catalog | 15-30 min |
| Trends Calculation | Daily 04:30 UTC | All apps | 5-10 min |
| Priority Calculation | Daily 04:45 UTC | All apps | 5-10 min |
| Velocity Calculation | 3x daily | All apps | 1-2 min |
| Interpolation | Daily 05:00 UTC | Gap-fill | 5-10 min |
| CCU Tiered Sync | Hourly | Tier 1+2 | 15-30 min |
| CCU Daily Sync | 3x daily (04:30, 12:30, 20:30 UTC) | Tier 3 rotation | 6 hours |
| Alert Detection | Hourly at :15 | All pinned entities | <10 min |
| Embedding Sync | Daily | All entities | 15-30 min |
| Materialized View Refresh | Daily 05:00 UTC | All views | 5-10 min |
| CCU Cleanup | Weekly Sun 3 AM UTC | Old snapshots | <5 min |

#### Priority-Based Scheduling

Games are assigned to refresh tiers based on a scoring algorithm:

| Factor | Points |
|--------|--------|
| CCU 10,000+ | 100 |
| CCU 1,000+ | 50 |
| CCU 100+ | 25 |
| 10+ reviews/day | 40 |
| Trend change detected | 10% |
| Dead game penalty | -50 |
| Never-synced | 25 (base) |

Tiers determine sync frequency: Active (6-12h), Moderate (24-48h), Dormant (weekly), Dead (monthly).

#### Velocity-Based Review Sync

Reviews are synced at intervals determined by review velocity:

| Tier | Reviews/Day | Sync Interval |
|------|-------------|---------------|
| High | >= 5 | 4 hours |
| Medium | 1-5 | 12 hours |
| Low | 0.1-1 | 24 hours |
| Dormant | < 0.1 | 72 hours |

#### Tiered CCU Tracking

| Tier | Criteria | Polling Frequency | ~Games |
|------|----------|-------------------|--------|
| Tier 1 | Top 500 by 7-day peak CCU | Hourly | ~500 |
| Tier 2 | Top 1,000 newest releases (past year) | Every 2 hours | ~1,000 |
| Tier 3 | All other games | 3x daily (rotation) | ~120,000 |

Tier 3 uses rotation tracking (`last_ccu_synced`) with oldest-first ordering to achieve full catalog coverage every ~2 days. Invalid app IDs are automatically skipped for 30 days to reduce wasted API calls. The PICS service also supports a bounded `first_pass` mode for newly discovered unsynced apps.

### 3.3 Data Freshness

| Data Type | Freshness Guarantee |
|-----------|-------------------|
| CCU (Tier 1) | < 1 hour |
| CCU (Tier 2) | < 2 hours |
| CCU (Tier 3) | < 2 days |
| Reviews (High velocity) | < 4 hours |
| Reviews (Dormant) | < 72 hours |
| Storefront metadata | < 48 hours |
| SteamSpy estimates | < 24 hours |
| PICS data | Near real-time (continuous monitoring) |
| Materialized views | < 24 hours |

---

## 4. Metrics & Analytics

### 4.1 Game-Level Metrics

#### Engagement Metrics

| Metric | Source | Description |
|--------|--------|-------------|
| Peak CCU | Steam CCU API | Highest concurrent players in tracking period |
| Average Playtime | SteamSpy | Average playtime across all owners (hours) |
| Median Playtime | SteamSpy | Median playtime across all owners (hours) |
| Playtime 2 Weeks | SteamSpy | Average playtime in last 2 weeks (hours) |
| Est. Weekly Played Hours | Computed | SUM(7-day CCU) x (avg_playtime_2weeks / 2 / 60) |

#### Review Metrics

| Metric | Source | Description |
|--------|--------|-------------|
| Total Reviews | Steam Reviews API | Total review count |
| Positive Reviews | Steam Reviews API | Positive review count |
| Review Score (%) | Steam Reviews API | Positive / Total x 100 |
| Review Score (1-9) | PICS | Steam's internal review score scale |
| Velocity 7d | Computed | Reviews per day (7-day average) |
| Velocity 30d | Computed | Reviews per day (30-day average) |
| Velocity Tier | Computed | High/Medium/Low/Dormant |
| Velocity Trend | Computed | Accelerating/Stable/Decelerating |

#### Growth Metrics

| Metric | Source | Description |
|--------|--------|-------------|
| CCU Growth 7d (%) | Computed | 3-day average comparison (recent vs prior) |
| CCU Growth 30d (%) | Computed | 3-day average vs 30-day baseline |
| Trend Direction | Computed | Up/Down/Stable (30/90-day analysis, 2% threshold) |

#### Financial Metrics

| Metric | Source | Description |
|--------|--------|-------------|
| Price (cents) | Storefront API | Current price |
| Discount (%) | Storefront API | Current discount percentage |
| Owners (midpoint) | SteamSpy | Estimated owners (range midpoint) |
| Est. Gross Revenue | Computed | Price x Owners (midpoint) |

#### Platform Metrics

| Metric | Source | Description |
|--------|--------|-------------|
| Platforms | Storefront/PICS | Windows/Mac/Linux support |
| Steam Deck | PICS | Unknown/Unsupported/Playable/Verified |
| Controller Support | PICS | Full/Partial/None |

### 4.2 Computed Insight Metrics

Six novel metrics provide deeper analytical value:

| Metric | Formula | Insight |
|--------|---------|---------|
| **Momentum Score** | (CCU Growth 7d + Velocity Acceleration) / 2 | Combined signal: "Is this game taking off?" |
| **Sentiment Delta** | Current positive % - Previous positive % | Catch comeback stories and review bombs |
| **Active Player %** | (Peak CCU / Owners) x 100 | Engagement depth vs historical reach |
| **Review Rate** | (Reviews / Owners) x 1,000 | Community engagement level |
| **Value Score** | Avg Playtime (hours) / Price (dollars) | Entertainment per dollar (excludes free games) |
| **vs Publisher Avg** | Game Score - Publisher Avg Score | Performance relative to publisher's catalog |

#### Momentum Score Indicators

| Score | Indicator | Meaning |
|-------|-----------|---------|
| >= 20 | Double rocket | Very strong momentum |
| 10-19 | Rocket | Strong momentum |
| 0-9 | Up-right arrow | Moderate positive |
| -9 to 0 | Right arrow | Stable |
| -19 to -10 | Down-right arrow | Declining |
| <= -20 | Chart down | Significant decline |

#### Sentiment Delta Indicators

| Change | Label |
|--------|-------|
| >= +10% | Surging |
| +3% to +9% | Improving |
| -3% to +3% | Stable |
| -9% to -3% | Declining |
| <= -10% | Review Bomb |

### 4.3 Publisher & Developer Aggregates

Publishers and developers have portfolio-level metrics computed via materialized views:

| Metric | Description |
|--------|-------------|
| Game Count | Total games published/developed |
| Total Owners | Sum of owner estimates across all games |
| Total Reviews | Sum of reviews across all games |
| Avg Review Score | Average positive percentage across games |
| Peak CCU | Highest CCU across all games |
| Est. Weekly Hours | Sum of estimated weekly played hours |
| Est. Gross Revenue | Sum of estimated revenue across games |
| CCU Growth 7d/30d (%) | Portfolio-level growth calculations |
| Review Velocity | Portfolio-level review rate |

**Materialized Views Used**: `publisher_metrics`, `developer_metrics`, `publisher_year_metrics`, `developer_year_metrics`, `publisher_game_metrics`, `developer_game_metrics`

### 4.4 Velocity Tiers & Trend Detection

#### Velocity Tiers

Games are classified by review activity:

| Tier | Reviews/Day | Proportion |
|------|-------------|-----------|
| High | >= 5 | ~1% of active games |
| Medium | 1-5 | ~5% |
| Low | 0.1-1 | ~15% |
| Dormant | < 0.1 | ~79% |

#### Trend Calculation

- **30-day analysis**: Compare current 30-day metrics to prior 30-day period
- **90-day analysis**: Longer-term trend confirmation
- **Stability threshold**: 2% change required to register a trend direction change
- **Velocity trend**: Accelerating (7d > 30d x 1.2), Decelerating (7d < 30d x 0.8), Stable (otherwise)

#### Momentum Discovery (Chat)

The current momentum discovery contract supports four main discovery modes:
- **Highest review activity**: titles with the most active review momentum
- **Accelerating**: games where recent review rate is improving
- **Breaking out**: hidden gems gaining attention without already being mainstream
- **Declining**: games losing momentum relative to their prior window

### 4.5 Estimated Weekly Played Hours

A novel engagement metric available at game, publisher, and developer levels:

**Formula**: SUM(7-day CCU) x (avg_playtime_2weeks / 2 / 60)

**Example**: A game with 50,000 total CCU over 7 days and 120 min avg playtime in 2 weeks = 50,000 x (120 / 2 / 60) = 50,000 hours

Available via Cube.js cubes: `MonthlyGameMetrics`, `MonthlyPublisherMetrics`

**Caveats**: This is an estimation based on CCU and average playtime data. Actual played hours may vary.

---

## 5. Architecture & Infrastructure

### 5.1 System Architecture

```
Data Sources                Ingestion Layer         Data Layer              Presentation
-----------                 ---------------         ----------              ------------
Steam App List API    ──┐
Steam Storefront API  ──┤                         ┌──────────────┐
Steam Reviews API     ──┼── TypeScript Workers ──▶│  Supabase    │──┐
Steam Histogram API   ──┤   + PICS Service        │  PostgreSQL  │  │     ┌─────────────┐
Steam CCU API         ──┘                         └──────────────┘  ├────▶│  Next.js 15  │
                                                        │           │     │  Dashboard   │
SteamSpy API          ──── TypeScript Workers ────────────┘           │     └─────────────┘
                                                                    │
PICS Service (Python) ──── SteamKit2 ─────────────────────────────────┘
                                                  ┌──────────────┐
                                                  │  Cube.js     │──── Compatibility analytics
                                                  │  27 cubes    │     (legacy / page reads)
                                                  └──────────────┘
Supabase refresh / bootstrap / reconcile flows ─▶┌──────────────┐
Query API             ──────────────────────────▶│ TigerData    │──── Contract-backed reads
                                                  │ + query-api  │     (chat, discovery, change/news)
                                                  └──────────────┘
```

### 5.2 Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend Framework | Next.js 15 | App Router with React Server Components |
| UI Framework | React 19 | Component rendering |
| Styling | TailwindCSS | Utility-first CSS |
| Write / Control Plane | Supabase (PostgreSQL) | primary write target, auth, queues, projections, and page reads |
| Semantic Layer | Cube.js | analytics compatibility layer over Supabase-backed models |
| Query API | Railway-hosted `query-api` | TigerData-backed typed contracts and continuation |
| Embeddings | OpenAI text-embedding-3-small | Stored in Tiger-backed retrieval tables |
| LLM | GPT-4o-mini (default) | Chat query understanding |
| PICS Service | Python + SteamKit2 | Steam product info cache |
| Monorepo | pnpm workspaces | Package management |
| CI/CD | GitHub Actions | 15+ scheduled workflows |
| Type Generation | Supabase CLI | Database-to-TypeScript types |

### 5.3 Database

PublisherIQ now uses two database roles:

- **Supabase** for writes, operational state, auth, product RPCs, and current page-serving data
- **TigerData** for selected contract-serving read slices

The scale table below still reflects the main Supabase warehouse footprint because Supabase remains the write/control plane.

#### Scale

| Table | Approximate Rows | Key Indexes |
|-------|-----------------|-------------|
| `apps` | 200,000 | appid (PK), name trigram (GIN), release_date |
| `daily_metrics` | 15,000,000+ | appid + metric_date, metric_date |
| `ccu_snapshots` | 5,000,000+ | appid + snapshot_time, snapshot_time |
| `review_deltas` | 3,000,000+ | appid + delta_date |
| `app_steam_tags` | 1,500,000+ | appid (GIN) |
| `publishers` | ~50,000 | name trigram (GIN), normalized_name |
| `developers` | ~80,000 | name trigram (GIN), normalized_name |
| `app_publishers` | ~200,000 | appid, publisher_id |
| `app_developers` | ~200,000 | appid, developer_id |
| `sync_status` | ~200,000 | appid (PK), priority, next_reviews_sync |

#### 20 Materialized Views

| View | Purpose |
|------|---------|
| `latest_daily_metrics` | Most recent metrics per game |
| `publisher_metrics` | Publisher portfolio aggregates |
| `developer_metrics` | Developer portfolio aggregates |
| `publisher_year_metrics` | Publisher metrics by year |
| `developer_year_metrics` | Developer metrics by year |
| `publisher_game_metrics` | Per-game metrics for publisher pages |
| `developer_game_metrics` | Per-game metrics for developer pages |
| `review_velocity_stats` | Pre-computed velocity statistics |
| `app_filter_data` | Pre-computed content arrays for game filtering |
| `mv_tag_counts` | Tag counts by app type |
| `mv_genre_counts` | Genre counts by app type |
| `mv_category_counts` | Category counts by app type |
| `mv_steam_deck_counts` | Steam Deck counts by app type |
| `mv_ccu_tier_counts` | CCU tier distribution by app type |
| `mv_apps_aggregate_stats` | Pre-computed summary stats by app type |
| `monthly_game_metrics` | Monthly game-level metrics |
| `monthly_publisher_metrics` | Monthly publisher-level metrics |
| Plus additional filter count views | Dynamic filter dropdown counts |

#### Key Enum Types

| Enum | Values |
|------|--------|
| `app_type` | game, dlc, demo, mod, video, hardware, music, tool, advertising, series |
| `trend_direction` | up, down, stable |
| `refresh_tier` | active, moderate, dormant, dead, new |
| `steam_deck_category` | unknown, unsupported, playable, verified |
| `user_role` | user, admin |
| `waitlist_status` | pending, approved, rejected |
| `credit_transaction_type` | signup_bonus, admin_grant, admin_deduct, chat_usage, refund |
| `alert_type` | ccu_spike, ccu_drop, trend_reversal, review_surge, sentiment_shift, price_change, new_release, milestone |
| `alert_severity` | low, medium, high |
| `entity_type` | game, publisher, developer |

### 5.4 Cube.js Semantic Layer

27 cubes across 9 model files provide a structured analytics layer:

| Model File | Cubes |
|------------|-------|
| `Apps.js` | Apps, AppPublishers, AppDevelopers, AppTrends, AppSteamDeck |
| `Discovery.js` | Discovery, Genres, AppGenres, Tags, AppTags |
| `DailyMetrics.js` | DailyMetrics, LatestMetrics |
| `PublisherMetrics.js` | PublisherMetrics, PublisherYearMetrics, PublisherGameMetrics |
| `DeveloperMetrics.js` | DeveloperMetrics, DeveloperYearMetrics, DeveloperGameMetrics |
| `ReviewVelocity.js` | ReviewVelocity |
| `ReviewDeltas.js` | ReviewDeltas |
| `MonthlyGameMetrics.js` | MonthlyGameMetrics |
| `MonthlyPublisherMetrics.js` | MonthlyPublisherMetrics |

**Discovery Cube** (primary for game queries):
- 27 dimensions (appid, name, type, developer, publisher, price, platforms, Steam Deck, etc.)
- 5 measures (count, avgPrice, avgScore, totalReviews, totalOwners)
- 26 segments (indie, freeToPlay, earlyAccess, highlyRated, wellReviewed, trending, steamDeckVerified, etc.)

### 5.5 Tiger Semantic Retrieval

Semantic similarity and concept search now flow through the Tiger query-api rather than a separate vector database.

**Current shape**:
- embeddings are stored in Tiger-backed retrieval tables
- semantic, concept, and continuation queries go through `semanticSearch`
- filters such as price, platforms, Steam Deck, genres, and tags are enforced inside the Tiger data plane
- the app keeps the LLM in the loop for phrasing, but Tiger owns the facts and candidate retrieval

### 5.6 Deployment

| Service | Platform | Purpose |
|---------|----------|---------|
| Dashboard | Vercel | Next.js frontend + API routes |
| PICS Service | Railway | Python microservice for Steam product data |
| Cube.js | Fly.io | Semantic analytics layer |
| Supabase | Supabase | write/control plane, auth, queues, and page-serving RPCs |
| Query API + TigerData | Railway + Tiger | contract-serving read plane for chat and discovery |
| CI/CD | GitHub Actions | 15+ scheduled workflows |

---

## 6. Performance & Reliability

### 6.1 Query Performance

| Operation | Fast Path | Slow Path | Trigger for Slow Path |
|-----------|-----------|-----------|----------------------|
| Games page load | ~200ms | ~4s | vs_publisher filter/sort or relationship filters |
| Companies page load | ~214ms | ~4s | Growth/relationship filters |
| Filter counts | <10ms | ~4s | Non-default filters |
| Aggregate stats | <10ms | ~4s | Complex filter combinations |
| Sparkline data | <100ms | - | Always fast (RPC) |
| Chat response | 500-2000ms LLM + tools | - | Depends on tool complexity |

### 6.2 Optimizations

| Optimization | Impact |
|-------------|--------|
| Two-path query strategy | 20x faster for default views |
| Pre-computed content arrays (GIN-indexed) | Content filtering: seconds to milliseconds |
| Pre-computed aggregate stats (MVs) | Summary stats: timeout to <10ms |
| Lazy-loaded sparklines (IntersectionObserver) | Only fetches visible rows |
| Batch sparkline fetching | Single RPC for visible rows |
| 5-minute filter count caching | Eliminates redundant queries |
| URL-first state management | Avoids React state serialization overhead |
| 400ms debounced filter updates | Batches rapid changes |
| Trigram indexes | Fast ILIKE text search on names |
| Covering indexes | Sort optimization without table lookups |

### 6.3 Rate Limits

| API | Limit |
|-----|-------|
| Steam App List | 100,000 requests/day |
| Steam Storefront | ~200 requests/5 min |
| Steam Reviews | 60 requests/min (1 req/sec) |
| Steam CCU | 1 request/sec |
| SteamSpy (bulk) | 1 request/60 sec |
| SteamSpy (detail) | 1 request/sec |
| Chat API | 10 req/min, 100 req/hour per user |

### 6.4 Error Handling & Resilience

| Pattern | Implementation |
|---------|---------------|
| Rate limit retry | Token bucket algorithm with exponential backoff (1s -> 2s -> 4s, max 10s) |
| API retry | 3 retries for retryable errors (429, 500, 502, 503, 504) |
| Circuit breaker | Stops requests after consecutive failures |
| Job tracking | All sync operations logged in `sync_jobs` table with status/timing |
| Credit reservation | Reserve-then-finalize pattern with automatic refund on failure |
| CCU skip tracking | Invalid app IDs skipped for 30 days |
| Graceful degradation | SteamSpy supplementary fetch fills gaps in pagination |
| Data interpolation | Linear interpolation fills gaps in review time-series data |

---

## 7. Security

### 7.1 Authentication & Access Control

- **OTP authentication** with 8-digit codes, 10-minute expiry, rate-limited (3 attempts per 15 minutes)
- **Invite-only access** via waitlist with admin approval
- **Role-based access**: User and Admin roles
- **Row-Level Security (RLS)** on all user-facing tables
- **Session-based cookies** with secure configuration

### 7.2 Vulnerabilities Patched (v2.8)

14 security vulnerabilities addressed in a dedicated security release:

| Severity | Count | Examples |
|----------|-------|---------|
| Critical | 4 | Privilege escalation via RLS policy, SECURITY DEFINER function exposure, dev bypass risk, public chat log access |
| High | 3 | Open redirect, missing route-level auth, host header injection |
| Medium | 3 | Redirect parameter mismatch, inefficient user lookup, inconsistent client patterns |

### 7.3 Data Security

- **Read-only chat queries**: All SQL executed via chat is read-only with keyword blocking
- **Credit reservation pattern**: Prevents usage without sufficient credits
- **Column-level UPDATE grants**: Prevent users from modifying role or credit fields
- **Auth validation in SECURITY DEFINER functions**: All sensitive functions validate `auth.uid()`
- **Admin-only access**: Chat query logs, user management, sync controls restricted to admin role
- **No credentials in exports**: Export functionality excludes sensitive internal data

### 7.4 Redirect Security

- Allowlist validation for redirect URLs
- `NEXT_PUBLIC_SITE_URL` environment variable prevents host header injection
- Standardized redirect parameter handling

---

## 8. Design System

### 8.1 Color Palette

**Warm Stone Theme** with dusty coral accents:

#### Surface Hierarchy (5 Levels)

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--surface` | `#FAF9F7` | `#1A1816` | Base background |
| `--surface-sunken` | - | - | Recessed areas |
| `--surface-raised` | `#FFFFFF` | - | Cards, panels |
| `--surface-elevated` | - | - | Hover states |
| `--surface-overlay` | - | - | Modals, dropdowns |

#### Primary Accent - Dusty Coral

| Theme | Value |
|-------|-------|
| Light | `#D4716A` |
| Dark | `#E07D75` |

#### Text Hierarchy (4 Levels)

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `--text-primary` | `#2D2A26` | `#E8E4DE` | Main text |
| `--text-secondary` | - | - | Supporting text |
| `--text-tertiary` | - | - | De-emphasized text |
| `--text-placeholder` | - | - | Input placeholders |

#### Semantic Colors

Success, Warning, Error, Info tokens for status indicators.

#### Accent Colors

Green, Yellow, Red, Blue, Purple, Cyan, Orange, Pink available as accent tokens.

### 8.2 Typography

| Font | Variable | Usage |
|------|----------|-------|
| DM Sans Variable | `--font-sans` | Primary UI text |
| JetBrains Mono Variable | `--font-mono` | Code, data display, numeric tables |

**Type Scale**: display-lg through caption-sm

**Font Data Utility**: `.font-data` class applies JetBrains Mono with tabular-nums for aligned numeric data in tables.

### 8.3 Theme Support

- **Three modes**: Light, Dark, System (follows OS preference)
- **Persistence**: Theme choice stored in localStorage
- **Implementation**: Both class-based (`.dark`) and attribute-based (`[data-theme="dark"]`) supported
- **Transitions**: Smooth theme transitions via CSS

### 8.4 CSS Variable Token System

All design decisions expressed as CSS custom properties:
- **Surfaces**: 5-level hierarchy
- **Borders**: muted, prominent, strong, focus
- **Shadows**: xs through xl, plus glow effects
- **Border radius**: rounded-sm through rounded-full
- **Animations**: fade-in, fade-in-up, slide-up, slide-down, scale-in, pulse-subtle
- **Component tokens**: Input, Badge, Table, Card with variant-specific tokens

### 8.5 Component Library

Key UI components:
- **StatusBar**: 6-metric system health display
- **CollapsibleSection**: Expandable content areas with badge counts
- **Badge**: 6 variants (default, primary, secondary, success, warning, error)
- **Button**: Primary, secondary, outline with consistent border radius
- **FilterPill**: Category-colored active filter chips
- **ActiveFilterBar**: Grouped, scrollable filter display
- **DenseMetricGrid**: Compact metric display
- **MiniProgressBar**: Inline progress indicators

### 8.6 Accessibility

- Keyboard navigation throughout (command palette, filters, tables)
- Focus management with visible focus rings
- Color-coded indicators always paired with text/icon alternatives
- Responsive layouts with progressive column hiding
- Consistent tab order and ARIA patterns

---

## 9. Product Evolution

### Release History

| Version | Date | Key Additions |
|---------|------|---------------|
| **v2.0** | Jan 6, 2026 | Complete UI redesign, new design system, admin dashboard with collapsible sections, 66% query reduction |
| **v2.1** | Jan 8, 2026 | Velocity-based review sync scheduling, user authentication (magic link), credit system, waitlist, game lookup in chat, ReviewVelocity + ReviewDeltas cubes |
| **v2.2** | Jan 9, 2026 | Tiered CCU tracking (3-tier system with hourly/2-hourly/daily), Insights dashboard with sparklines, exact CCU from Steam API (replacing SteamSpy estimates), CCU rotation tracking, skip tracking, SteamSpy supplementary fetch, 3x reviews throughput |
| **v2.3** | Jan 11, 2026 | 10x embedding sync throughput (24h to 15-30 min), async Qdrant writes, OpenAI retry logic, selective sync by collection |
| **v2.4** | Jan 12, 2026 | Personalized dashboard (pin system), 8 alert types with hourly detection, alert preferences with sensitivity tuning, per-pin overrides, concept search and trend discovery in chat, enhanced embeddings with momentum data, 90% Qdrant storage reduction |
| **v2.5** | Jan 15, 2026 | Companies page (unified publishers/developers), 25+ filter parameters, 17 columns, comparison mode, export, saved views, computed ratios, two-path query optimization |
| **v2.6** | Jan 16, 2026 | Games page rebuild, 12 presets, 12 quick filters, 33 columns, 6 computed insight metrics (Momentum, Sentiment Delta, Active Player %, Review Rate, Value Score, vs Publisher Avg), 40+ filter parameters, 7 new materialized views |
| **v2.7** | Jan 25, 2026 | Command palette (Cmd+K) with filter syntax, active filter bar with color-coded chips, warm stone color palette, DM Sans + JetBrains Mono typography |
| **v2.8** | Jan 31, 2026 | 14 security vulnerabilities patched, OTP authentication (8-digit codes), token refresh loop fix, apps/companies page sparkline and timeout fixes, standardized Supabase client patterns |
| **v2.9** | Mar 15, 2026 | New Change Feed at `/changes`, OTP/session hardening, origin validation, Change Feed SQL read surfaces, stale-claim recovery, improved change-intel and PICS history capture |
| **v2.10** | Mar 30, 2026 | Recent news detail/digest/topic search in chat, catalog control and CCU quality in admin, first-pass PICS sync, chat quality/session logging, and news search projection refresh |
| **v2.11** | Apr 6, 2026 | Chat contract cutover, TigerData-backed query-api operating model, continuation/context contracts, docs/news parity, and preview/production Tiger refresh automation |

### Feature Matrix

| Feature | Version | Status |
|---------|---------|--------|
| Admin Dashboard | v2.0 | Active |
| Velocity-Based Sync | v2.1 | Active |
| Authentication & Credits | v2.1 | Active |
| Tiered CCU Tracking | v2.2 | Active |
| Insights Dashboard | v2.2 | Active |
| Embedding Optimization | v2.3 | Active |
| Pin & Alert System | v2.4 | Active |
| Concept Search | v2.4 | Active |
| Trend Discovery | v2.4 | Active |
| Companies Page | v2.5 | Active |
| Games Page (rebuilt) | v2.6 | Active |
| Computed Insight Metrics | v2.6 | Active |
| Change Feed | v2.9 | Active |
| Change-Intelligence Runtime | v2.9 | Active |
| Recent News Chat Tools | v2.10 | Active |
| Catalog Control & CCU Quality | v2.10 | Active |
| Chat Contract Cutover | v2.11 | Active |
| TigerData Query Operating Model | v2.11 | Active |
| Command Palette | v2.7 | Active |
| Filter Syntax | v2.7 | Active |
| Design System (Warm Stone) | v2.7 | Active |
| OTP Authentication | v2.8 | Active |
| Security Hardening | v2.8 | Active |

---

## 10. Data Coverage & Future Opportunities

### 10.1 Currently Unused Steam API Fields

Fields available from current data sources but not yet captured:

| Field | Source | Potential Use |
|-------|--------|---------------|
| Game descriptions | Storefront API | Enhanced embeddings, search |
| System requirements | Storefront API | Hardware analysis |
| Achievements | Storefront API | Engagement depth metrics |
| Individual reviews | Reviews API | Sentiment analysis, NLP |
| Screenshots/videos | Storefront API | Visual discovery |
| Language support | PICS/Storefront | Market coverage analysis |
| Content descriptors | PICS | Content classification |

### 10.2 Unused Third-Party Sources

| Source | Data Available | Effort |
|--------|---------------|--------|
| Steam News API | Official game news, update announcements | Low |
| ProtonDB | Linux compatibility ratings | Low |
| IGDB | Industry metadata, game relationships | Medium |
| IsThereAnyDeal | Historical pricing, deal tracking | Medium |
| HowLongToBeat | Game completion times | Medium |
| OpenCritic | Critic review aggregation | Medium |
| SteamGridDB | Custom artwork and assets | Low |
| Steam Achievements API | Achievement unlock rates | Low |
| Steam Workshop API | Workshop item counts, ratings | Low |

### 10.3 Recommended Additions (Priority Tiers)

| Priority | Addition | Effort | Value |
|----------|----------|--------|-------|
| **Tier 1** | Steam News API integration | Low | Update monitoring, content analysis |
| **Tier 1** | Game descriptions in embeddings | Low | Better similarity/concept search |
| **Tier 2** | Achievement data | Medium | Engagement depth metrics |
| **Tier 2** | Language support tracking | Low | Market coverage analysis |
| **Tier 3** | ProtonDB integration | Low | Linux gaming community value |
| **Tier 3** | Historical price tracking | Medium | Deal analysis, price intelligence |
| **Tier 4** | Critic review aggregation | Medium | Professional review correlation |
| **Tier 4** | Workshop analytics | Low | Community content engagement |

---

*PublisherIQ is under active development. For technical documentation, see the developer guide. For usage instructions, see the user guide.*
