# Product Marketing Context

*Last updated: March 16, 2026*
*Status: V2 draft inferred from repo docs, landing copy, product guides, data-source docs, prompt documentation, and user-provided positioning guidance. Customer language is still mostly product- and prompt-derived rather than true VOC. Pricing, named competitors, customer quotes, and customer proof still need confirmation. Steam is the current wedge, not the permanent ceiling.*

## Product Overview
**One-liner:** PublisherIQ is an invite-only game market intelligence platform that is deepest on Steam today and built to broaden over time, helping teams research games and companies, monitor market changes, and move from a question to evidence quickly.
**What it does:** PublisherIQ consolidates Steam-first market data, change-intelligence signals, company/game analytics, and natural-language querying into one workspace. The repo and landing story already point toward a broader research flow across Steam, Twitch, YouTube, and Epic, but current product depth is strongest on Steam. Users can browse and compare games and companies, track release, pricing, store-page, and announcement changes, and ask plain-English questions that resolve into data tables, linked entities, and supporting evidence.
**Product category:** Game market intelligence and competitive research workflow, with Steam as the current wedge
**Product type:** B2B SaaS, invite-only beta
**Business model:** Access-gated SaaS with credit-based query usage in the current beta; public pricing is not documented in the repo

## Target Audience
**Target companies:** Game publishers, game studios, investment firms, research teams, and market analysts who need Steam depth today and broader market context over time; secondary audience includes agencies and service providers looking for monitoring or prospecting workflows
**Decision-makers:** Publishing leads, portfolio managers, business development leaders, market and research analysts, studio founders, investors, agency leaders, and strategy or insights leads
**Primary use case:** Help operators monitor market shifts, research competitors and companies, and make faster portfolio, launch, BD, and strategy decisions
**Jobs to be done:**
- Monitor launch timing, pricing, store-page, and announcement changes without reading raw Steam diffs all day
- Ask questions in plain English about games, publishers, developers, genres, trends, and changes without writing SQL or rebuilding filters
- Research games, genres, publishers, and developers in one place instead of across multiple tools and spreadsheets
- Benchmark companies and portfolios before launch, investment, publishing, or strategy decisions
- Identify signable titles, rescue candidates, under-marketed games, and strategic shifts earlier than the market
- Carry context from one signal, company, or market question into the next step without starting over
**Use cases:**
- Launch watch for unreleased titles
- Pricing and package change monitoring
- Competitive catalog research
- Publisher and developer benchmarking
- Trend and breakout discovery
- Natural-language analysis, discovery, and entity lookup
- Agency and service-provider prospecting
- Publisher and BD scouting
- Investor and diligence workflows
- Prompt-driven workflows such as "Which publishers changed release timing this week, and what changed on the store page?"
- Cross-store and platform-expansion research over time as additional signal sources mature

## Personas
| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| Publishing or market analyst (User) | Fast answers, evidence, signal triage | Too many noisy data sources and manual checks | One workspace for research, monitoring, and proof |
| Product or publishing lead (Champion) | Better launch and pricing decisions | Hard to spot competitor moves quickly | Grouped change intelligence plus portfolio context |
| Studio founder or head of publishing (Decision Maker) | Confidence, speed, fewer blind spots | Market research is fragmented and slow | Decision-ready context without stitching together four tools |
| Investor or diligence analyst (Financial Buyer) | Benchmarking, momentum, downside risk | Need quick portfolio and company reads with evidence | Compare games and companies with context and supporting data |
| Agency or service partner (Champion / Influencer) | Timely leads, proof of need, client context | Prospecting is slow and evidence quality is inconsistent | Detect under-marketed, waking-up, or strategically shifting games earlier |
| Data or insights lead (Technical Influencer) | Reliable datasets, reusable analytics | Raw platform data pipelines are messy | Structured analytics, filters, and an AI query layer on top of the warehouse |

## Problems & Pain Points
**Core problem:** Game market research and monitoring are fragmented, noisy, and time-consuming, with the current pain most acute around Steam because that is where PublisherIQ is deepest today.
**Why alternatives fall short:**
- First-party platform analytics are strongest for owned titles, not competitor monitoring or market-wide research
- Raw Steam and partner surfaces expose activity but not a clean research workflow
- As teams expand coverage, they often patch Steam-first tools together with separate sources for broader market context
- Spreadsheet and browser-tab workflows make recurring research slow and error-prone
- Generic dashboards often separate summary views from the underlying evidence
- Manual diff checking creates noise and makes it easy to miss meaningful launch or pricing changes
- Answering a simple market question often requires translating it into SQL, filters, and multiple lookups before analysis even starts
**What it costs them:** Slower decisions, missed market signals, more analyst time, weaker benchmarking, and lower confidence before launches or portfolio bets
**Emotional tension:** Fear of missing important moves, frustration with tool sprawl, and uncertainty when defending a decision

## Competitive Landscape
**Direct:** Steam and PC market-intelligence platforms such as **SteamDB**, **Video Game Insights by Sensor Tower**, and **Gamalytic**. They are strong at public history, market research, catalog estimates, or discovery, but they skew toward lookup surfaces and databases more than evidence-linked operator workflows across monitoring, benchmarking, and follow-up research.
**Secondary:** Broader market-intelligence and discovery products such as **GameDiscoverCo** and **Newzoo**, plus owned-title tooling such as **Steamworks** and **Gamesight**. These are useful for macro context, editorial insight, or owned-performance measurement, but they do not map as cleanly to recurring competitor-intelligence workflows.
**Indirect:** Internal spreadsheets, saved browser tabs, ad hoc SQL, generic AI tools, agencies, consultants, and internal research staff doing manual market scans. Flexible, but slow, inconsistent, and hard to operationalize across a team.

## Differentiation
**Key differentiators:**
- Steam depth today, with a repo and landing story that already points toward broader multi-source research over time
- Games, publishers, and developers live in one system
- Change intelligence groups storefront, pricing, media, platform, build, and announcement activity
- Natural-language querying is tied to the same entities, filters, and evidence as the analytics UI
- The product is organized around operator workflows such as launch watch, commercial moves, benchmarking, scouting, and diligence
- It sits between owner-only platform analytics and public catalog-intelligence tools
- Comparison, saved views, exports, and personalization support recurring workflows
- Supporting evidence is one click away instead of buried behind a static summary
**How we do it differently:** PublisherIQ combines structured analytics, change monitoring, and natural-language querying in a Steam-first workspace that is already wired around multiple source families and organized around operator workflows rather than one-off lookups.
**Why that's better:** Users can start with a question, narrow to the relevant signal, and open the proof without switching tools or rebuilding context, while the workflow itself stays intact as coverage expands beyond Steam.
**Why customers choose us:** Faster research, less noise, stronger context continuity, evidence-backed answers, and a credible bridge from Steam depth to broader market intelligence

## Objections
| Objection | Response |
|-----------|----------|
| We already have Steam plus spreadsheets. | PublisherIQ reduces recurring manual work by grouping changes, unifying filters, and preserving context across research tasks. |
| We already use Steamworks and another market-data tool. | Steamworks is strongest for your own titles and many market-data tools are strongest for lookup or estimates; PublisherIQ is strongest when the job is recurring operator workflow with evidence, comparison, and follow-up research in one place. |
| Is this just a Steam tool? | Steam is the deepest wedge today because that is where the workflows and evidence surfaces are strongest, but the framing should stay broader: game market intelligence that expands over time rather than a permanently Steam-only dashboard. |
| AI answers can be vague or untrustworthy. | The chat is anchored to the warehouse and linked entities, with supporting data and evidence surfaces. |
| This looks like another dashboard to maintain. | The product is organized around daily workflows like launch watch, pricing moves, benchmarking, and evidence review, not passive dashboard consumption. |

**Anti-persona:** Teams that only need one-off public stats, only want broad top-down market reports without workflow depth, want a permanently narrow point solution, or do not value evidence-backed research enough to change from manual tools

## Switching Dynamics
**Push:** Too much noise, too many tabs, owner-only analytics that stop at your own titles, manual diff-checking, and slow research cycles
**Pull:** One workspace for grouped change intelligence, company benchmarking, and fast question-to-evidence workflows, with Steam depth today and room to broaden over time
**Habit:** Existing spreadsheet workflows, familiar public tools, Steamworks for owned-title reporting, and institutional reliance on manual research habits
**Anxiety:** Trust in new data surfaces, switching cost, invite-only access, uncertainty about pricing or ROI, and concern that a Steam-first product may not broaden with their needs

## Customer Language
**How they describe the problem:**
- "Track release timing, pricing, and store-page movement without reading raw Steam diffs all day."
- "Research the Steam market with the evidence already grouped for you."
- "Open the supporting evidence without stitching together four different tools."
**How they describe us:**
- "Steam market intelligence"
- "Deepest on Steam today"
- "Broader game market intelligence over time"
- "Ask in plain English, then open the supporting data."
- "Move from a question to decision-ready context quickly."
- "Bring the signals into one research flow."
- "Which publishers changed release timing this week, and what changed on the store page?"
- "Find signable indie games where product quality looks stronger than go-to-market execution."
**Words to use:** deepest on Steam today, broader game market intelligence over time, evidence-backed, launch watch, pricing moves, catalog research, company benchmarking, grouped signals, supporting evidence, one research flow, question to evidence, market presentation, commercial moves
**Words to avoid:** Steam-only forever, generic AI assistant, customer support chat, all-in-one dashboard, vanity analytics, blanket real-time claims, cross-platform parity today
**Glossary:**
| Term | Meaning |
|------|---------|
| Natural-language querying | Plain-English interface for querying PublisherIQ's Steam dataset and opening linked evidence |
| Steam-first wedge | The current entry point for the product: deepest on Steam today while building toward broader market intelligence |
| Signal sources | Data feeds and evidence surfaces brought into one research flow, such as Steam plus adjacent channels described in landing copy like Twitch, YouTube, and Epic |
| Change Feed | Unified activity stream for grouped changes and announcements |
| Launch Watch | Monitoring upcoming titles, launch-prep activity, and release timing |
| Commercial Moves | Pricing, discount, package, and monetization changes |
| Store Refreshes | Copy, artwork, screenshots, trailers, tags, and presentation changes |
| CCU | Concurrent users, used as a core demand and momentum signal |
| Supporting evidence | Before and after diffs, linked announcements, and entity detail behind a summary |

## Brand Voice
**Tone:** Direct, analytical, confident, pragmatic
**Style:** Concise, evidence-first, operator-friendly, careful with inference, and not hype-heavy
**Personality:** Credible, sharp, useful, focused, market-aware, expansion-minded

## Proof Points
**Metrics:** 200K+ Steam listings indexed; 15M+ tracked data points; ~50K publishers and ~80K developers represented in repo docs; 4 signal sources unified in landing copy; 7 external data sources and 15 sync workers documented in reference docs; 15-minute freshness target; question-to-evidence in under 1 minute; 60+ documented query examples; games, publishers, and developers covered in one workspace
**Customers:** Not public in the repo; needs confirmation
**Testimonials:** Not public in the repo
> "TBD"
**Value themes:**
| Theme | Proof |
|-------|-------|
| Faster research | Landing copy claims question-to-evidence in under 1 minute |
| Better question handling | Query docs show plain-English queries, linked entities, tool-backed responses, and query details |
| Better monitoring | Grouped activity cards with before and after evidence plus related announcements |
| Broader context | Games, publishers, and developers live in one workspace |
| Market coverage | 200K+ listings indexed, 15M+ tracked data points, ~50K publishers, ~80K developers, and 7 external data sources documented in the repo |
| Wedge, not ceiling | Landing copy already describes 4 signal sources unified in one research flow, including Steam, Twitch, YouTube, and Epic, even though current product depth is strongest on Steam |

## Goals
**Business goal:** Own the Steam wedge first, become a recurring operator workflow, and expand into broader game market intelligence over time
**Conversion action:** Request access to the beta, then sign in with an approved email
**Current metrics:** Invite-only beta and waitlist flow are documented; pricing and funnel metrics are not documented in the repo
