# PublisherIQ Wow Insight Products

As of March 26, 2026

This is a research-only memo describing the highest-leverage insight products PublisherIQ could build from the database today.

The goal is not to list dashboards. The goal is to identify insight products that would make a developer, publisher executive, gaming investor, or acquirer say: "I cannot get this anywhere else."

## Data Surface Used

- `apps`: `166,689` games
- `daily_metrics`: about `9.9M` rows from `2025-12-28` to `2026-03-26`
- `review_deltas`: `2,162,190` rows from `2026-01-09` to `2026-03-26`
- `ccu_snapshots`: about `9.0M` rows from `2026-01-09` to `2026-03-26`
- `app_change_events`: about `1.74M` events from `2026-03-14` onward
- `steam_news_items`: about `1.56M` items from `2026-03-14` onward
- `publishers`: `95,728`
- `developers`: `111,323`
- `publisher_metrics`: `54,712` rows
- `developer_metrics`: `64,447` rows
- `review_velocity_stats`: `58,720` rows
- `app_steam_tags`: `2,510,672` links across `446` tag definitions and `42` genre definitions

## How These Were Ranked

Each idea is scored on five factors:

- `Wow`: would a buyer immediately feel this is new and valuable?
- `Uniqueness`: is the signal hard to reproduce without PublisherIQ's joins?
- `Strategic Value`: does it change decisions around investing, publishing, portfolio management, or launch execution?
- `Support Now`: can the current dataset defend it today?
- `Expansion Potential`: does it get materially better as more history accumulates?

Weighted ranking:

- `Wow 30%`
- `Uniqueness 25%`
- `Strategic Value 20%`
- `Support Now 15%`
- `Expansion Potential 10%`

Readiness tiers:

- `Now`: defensible with current windows
- `Compounding`: already useful, but gets significantly stronger with 90 to 180 more days
- `Future Layer`: strategically important, but best once history deepens

## Top 5 Build First

### 1. Multi-Signal Conviction Score

- Why first: It is the cleanest flagship surface for "what should we care about right now?"
- Buyer: publisher scouts, portfolio executives, investors, corp dev
- Why it wins: It fuses performance, recent change intensity, news intensity, and company context into one ranked opportunity surface.

### 2. Hidden Breakout Detector

- Why first: It answers the most emotionally compelling question in games investing and scouting.
- Buyer: publishers, investors, scouts
- Why it wins: It finds games that look stronger than their current visibility and publisher backing imply.

### 3. Publisher Hit-Rate Model

- Why first: It upgrades PublisherIQ from game intelligence to capital-allocation intelligence.
- Buyer: publisher executives, investors, corp dev
- Why it wins: It distinguishes repeatable operators from one-hit portfolios.

### 4. Genre / Theme Momentum Index

- Why first: It creates a market-level narrative layer people immediately understand and want to revisit.
- Buyer: execs, investors, strategy teams, developers
- Why it wins: It combines metrics, tag movement, genre movement, and news language into one "where the market is moving" view.

### 5. Update-to-Reacceleration Signal

- Why first: It is a strong proof that PublisherIQ can tell buyers what actions tend to matter, not just what changed.
- Buyer: live ops teams, portfolio executives, investors in active games
- Why it wins: It connects content cadence to downstream demand response.

## The 20 Product Ideas

### 1. Multi-Signal Conviction Score

- Readiness: `Now`
- Primary buyer: publisher scouts, investors, corp dev
- Thesis: Rank games, publishers, and developers by combined market conviction instead of raw popularity.
- Core data: `latest_daily_metrics`, `app_trends`, `review_velocity_stats`, `app_change_events`, `steam_news_items`, `app_filter_data`, `publisher_metrics`, `developer_metrics`
- Suggested output: ranked market board with evidence chips for each signal lane
- Why it is hard to copy: competitors usually have metrics or news or change tracking, not all three linked at app and company level
- Next layer: anomaly weighting, confidence bands, cohort-relative ranking

### 2. Hidden Breakout Detector

- Readiness: `Now`
- Primary buyer: publishers, investors
- Thesis: Find games whose momentum and sentiment are outpacing their current publisher support and market recognition.
- Core data: `app_filter_data`, `latest_daily_metrics`, `app_trends`, `review_velocity_stats`, `publisher_metrics`, `developer_metrics`
- Suggested output: shortlist of "stronger than they look" games with peer-relative context
- Why it is hard to copy: requires game-level traction plus company-quality context and cohort benchmarking
- Next layer: peer-relative breakout probability score

### 3. Update-to-Reacceleration Signal

- Readiness: `Compounding`
- Primary buyer: live ops leads, portfolio executives, investors in active games
- Thesis: Measure which update patterns are followed by renewed review or CCU momentum.
- Core data: `app_change_events`, `review_deltas`, `ccu_snapshots`, `app_trends`, `apps`
- Suggested output: effect table by update type, lifecycle stage, and genre cluster
- Why it is hard to copy: most tools do not have structured store-change history married to downstream performance
- Next layer: lag windows and causal-style matched cohorts

### 4. Launch Readiness Signature

- Readiness: `Compounding`
- Primary buyer: publishing BD, launch strategy, investors in upcoming titles
- Thesis: Identify unreleased games whose page-building, news cadence, and pre-launch behavior look professionally coordinated.
- Core data: `apps`, `app_change_events`, `steam_news_items`, `steam_news_versions`, `app_filter_data`
- Suggested output: pre-launch watchlist with launch-readiness evidence stack
- Why it is hard to copy: combines prerelease metadata, storefront changes, and public communication patterns in one view
- Next layer: launch outcome backtesting

### 5. Publisher Hit-Rate Model

- Readiness: `Now`
- Primary buyer: executives, investors, corp dev
- Thesis: Show which publishers actually produce repeatable outcomes rather than living off one outlier game.
- Core data: `publisher_metrics`, `publisher_game_metrics`, `publishers`, `latest_daily_metrics`, `app_trends`
- Suggested output: publisher leaderboard by repeatability, concentration risk, and trend mix
- Why it is hard to copy: requires portfolio rollups plus title-level distribution, not just catalog totals
- Next layer: time-sliced hit-rate and cohort decay analysis

### 6. Price-to-Engagement Frontier

- Readiness: `Now`
- Primary buyer: publishers, product strategists, investors
- Thesis: Map which games and cohorts turn price into owners, reviews, and playtime most efficiently.
- Core data: `latest_daily_metrics`, `daily_metrics`, `apps`, `app_filter_data`, `publisher_metrics`
- Suggested output: efficiency frontier by price band, genre, and portfolio type
- Why it is hard to copy: most tools stop at price or revenue estimates and do not tie them to ongoing engagement quality
- Next layer: post-discount movement and premium-vs-free cohort models

### 7. Genre / Theme Momentum Index

- Readiness: `Now`
- Primary buyer: execs, investors, strategy teams, developers
- Thesis: Show where the market is moving by combining tag and genre change history with news-language shifts.
- Core data: `app_change_events`, `steam_news_items`, `steam_news_versions`, `app_steam_tags`, `steam_tags`, `steam_genres`, `latest_daily_metrics`
- Suggested output: market pulse board of genres, themes, and narratives rising or fading
- Why it is hard to copy: it joins semantic market language with actual storefront movement
- Next layer: cluster-level supply, demand, and competition overlays

### 8. Discount Elasticity Map

- Readiness: `Compounding`
- Primary buyer: pricing teams, publishers, investors
- Thesis: Show which segments react to discounting and which are largely insensitive.
- Core data: `app_change_events`, `daily_metrics`, `review_deltas`, `apps`, `app_filter_data`
- Suggested output: elasticity table by cohort, price band, age, genre, and quality tier
- Why it is hard to copy: requires pricing events tied to post-event demand movement over time
- Next layer: discount-depth and cadence recommendations

### 9. Durable vs Spiky Demand Classifier

- Readiness: `Now`
- Primary buyer: investors, portfolio executives, publishing scouts
- Thesis: Distinguish games with sustained demand quality from games that are mostly one-off spikes.
- Core data: `daily_metrics`, `ccu_snapshots`, `review_deltas`, `review_velocity_stats`, `app_trends`
- Suggested output: durability classification with evidence across reviews, CCU, and playtime
- Why it is hard to copy: requires multiple demand surfaces, not a single noisy popularity metric
- Next layer: persistence forecasting

### 10. Investor / Acquirer Diligence Scorecard

- Readiness: `Compounding`
- Primary buyer: investors, corp dev, executive leadership
- Thesis: Turn publisher and developer intelligence into a diligence-ready quality and risk surface.
- Core data: `publisher_metrics`, `developer_metrics`, `publisher_game_metrics`, `developer_game_metrics`, `app_trends`, `review_velocity_stats`
- Suggested output: ranked diligence scorecard for studios, publishers, and portfolios
- Why it is hard to copy: it compresses portfolio depth, trend quality, and execution into one decision surface
- Next layer: scenario analysis and benchmark bands

### 11. Live Game Risk Flags

- Readiness: `Now`
- Primary buyer: live ops executives, publishers, investors in active titles
- Thesis: Flag games entering decline before the narrative turns obviously negative.
- Core data: `app_trends`, `review_velocity_stats`, `app_filter_data`, `app_change_events`, `steam_news_items`
- Suggested output: risk board of active titles with reason codes
- Why it is hard to copy: requires both deterioration signals and context on whether the team is responding
- Next layer: automated alerting and escalation thresholds

### 12. Portfolio Cannibalization vs Halo Map

- Readiness: `Future Layer`
- Primary buyer: publishers, portfolio executives, corp dev
- Thesis: Show when games in the same portfolio lift each other versus compete for the same demand.
- Core data: `publisher_game_metrics`, `daily_metrics`, `ccu_snapshots`, `review_deltas`, `app_steam_tags`
- Suggested output: intra-portfolio overlap and halo matrix
- Why it is hard to copy: needs deeper time history and portfolio-aware comparative modeling
- Next layer: release-spacing and merchandising recommendations

### 13. Developer Graduation Curve

- Readiness: `Now`
- Primary buyer: publishers, investors, partner teams
- Thesis: Identify developers moving from single-title shops toward repeatable studios.
- Core data: `developers`, `developer_metrics`, `developer_game_metrics`, `apps`
- Suggested output: developer progression ladder with breakout and repeatability markers
- Why it is hard to copy: requires both catalog structure and commercial outcome rollups
- Next layer: pre- and post-publisher partnership transitions

### 14. Store Rewrite / Media Refresh Signal

- Readiness: `Compounding`
- Primary buyer: go-to-market teams, publishers, investors
- Thesis: Measure whether store-page rewrites, trailer additions, and media refreshes tend to precede traction shifts.
- Core data: `app_change_events`, `review_deltas`, `ccu_snapshots`, `steam_news_items`
- Suggested output: conversion-effect board by change type and cohort
- Why it is hard to copy: most systems do not store and structure storefront execution changes at scale
- Next layer: before-and-after copy/image quality scoring

### 15. Demo-to-Demand Signal

- Readiness: `Compounding`
- Primary buyer: developers, publishers, investors in upcoming games
- Thesis: Quantify when demo activity is an early indicator of launch demand versus empty noise.
- Core data: `steam_news_versions`, `steam_news_items`, `apps`, `review_deltas`, `daily_metrics`, `app_change_events`
- Suggested output: demo effectiveness view by genre, price band, and launch proximity
- Why it is hard to copy: requires text-derived intent plus downstream demand behavior
- Next layer: playtest and Next Fest-specific versions

### 16. Content Strategy Archetypes

- Readiness: `Now`
- Primary buyer: executives, live ops leads, investors
- Thesis: Cluster games by how they communicate and ship content, not just by genre.
- Core data: `app_change_events`, `steam_news_items`, `steam_news_versions`, `apps`, `app_steam_tags`
- Suggested output: archetype map such as hype-driven, patch-heavy, roadmap-led, sale-led, or maintenance-only
- Why it is hard to copy: joins public narrative and execution behavior into a strategic fingerprint
- Next layer: archetype-to-outcome benchmarking

### 17. Supply Shock Monitor

- Readiness: `Now`
- Primary buyer: strategy teams, investors, portfolio executives
- Thesis: Detect sudden market-wide bursts in launches, discounts, updates, platform changes, or content pushes.
- Core data: `app_change_events`, `apps`, `steam_news_items`
- Suggested output: day-by-day market activity pulse with cohort breakout views
- Why it is hard to copy: most competitors do not have a normalized market-wide change event ledger
- Next layer: impact overlays from reviews and CCU

### 18. Platform / Steam Deck Advantage

- Readiness: `Compounding`
- Primary buyer: developers, publishers, executives
- Thesis: Show whether platform breadth and Steam Deck readiness align with stronger outcomes in specific cohorts.
- Core data: `app_filter_data`, `apps`, `latest_daily_metrics`, `review_velocity_stats`, `publisher_metrics`
- Suggested output: advantage map by platform mix, price, and genre
- Why it is hard to copy: requires platform readiness plus commercial performance, not just certification status
- Next layer: timing analysis for platform-expansion changes

### 19. Publisher / Developer White-Space Map

- Readiness: `Future Layer`
- Primary buyer: publisher strategy, corp dev, investors
- Thesis: Reveal high-demand clusters with weak publisher depth and identify the companies best positioned to fill them.
- Core data: `app_steam_tags`, `steam_tags`, `steam_genres`, `publisher_metrics`, `developer_metrics`, `latest_daily_metrics`
- Suggested output: market adjacency and whitespace matrix
- Why it is hard to copy: needs company graph, market structure, and demand data in one model
- Next layer: white-space recommendations personalized by publisher portfolio

### 20. Market Narrative Divergence Index

- Readiness: `Future Layer`
- Primary buyer: investors, executives, comms and strategy teams
- Thesis: Identify where the public narrative around a game or segment is diverging from the underlying metrics.
- Core data: `steam_news_items`, `steam_news_versions`, `latest_daily_metrics`, `review_velocity_stats`, `app_trends`
- Suggested output: divergence list showing "talked up but weak," "quiet but strong," and "narrative catching up"
- Why it is hard to copy: requires both editorial/news language and structured market performance
- Next layer: source-quality weighting and narrative polarity

## What Makes These Defensible

- They are not single-table views.
- They rely on the cross-section of `metrics + change events + news + company graph`.
- They can be sold at multiple levels:
  - developers buy operator insight
  - publishers buy sourcing and portfolio insight
  - executives buy market structure and capital-allocation insight
  - investors buy diligence and breakout detection

## Bottom Line

The strongest PublisherIQ story is not "we track Steam."

It is:

- we can see what games are doing,
- we can see what teams are changing,
- we can see what they are saying publicly,
- we can compare that to peer cohorts and company quality,
- and we can turn that into decisions about who to sign, who to back, what is heating up, and where the market is moving next.
