# Go-To-Market Opportunity Study

As of March 26, 2026

## Executive Summary

This study asks:

> Which underappreciated Steam games are showing the earliest signs of a coordinated go-to-market push, and which are the best signing opportunities before breakout is obvious?

The live dataset is already strong enough to answer that credibly, with one important constraint:

- Long-run product and market data is usable now.
- Typed change and news history is still recent, so this study is strongest as an **early opportunity radar**, not a long-horizon playbook study.

Live data windows used in this pass:

- `daily_metrics`: **December 28, 2025 to March 26, 2026** (`89` days)
- `review_deltas`: **January 9, 2026 to March 26, 2026** (`77` days, `44,510` apps)
- `app_change_events` / `change_activity_bursts` / `steam_news_versions`: **March 14, 2026 to March 26, 2026** (`13` days, `91,287` apps with change events)

This first pass produced:

- **20,373 released candidates** after applying the released-game quality, scale, and timing filters
- **291 prerelease-state candidates** after applying the Steam prerelease-state plus non-major-publisher filter

## Cohort Funnel

### Released Funnel

| Step | Games |
| --- | ---: |
| Total Steam games in the current snapshot | `166,680` |
| Released and not delisted | `101,109` |
| Released before the recent change window starts | `100,537` |
| With enough review evidence to judge product quality (`25+` reviews) | `39,592` |
| Above the quality floor (`69.8%+` positive) | `29,725` |
| Not already obvious breakouts (`< 7,154` reviews and `< 750,000` midpoint owners) | `27,499` |
| With at least one recent burst in the March 14-26 window | `20,373` |

### Prerelease-State Funnel

| Step | Games |
| --- | ---: |
| Total Steam games in the current snapshot | `166,680` |
| Games currently marked `prerelease` in Steam state | `831` |
| Prerelease-state games with at least one recent burst in the March 14-26 window | `340` |
| After excluding obvious major-publisher wrappers | `291` |

## How This Pass Was Built

The study uses two separate cohorts.

### Released Opportunities

Released opportunities are games that:

- are already launched, not delisted, and released before the recent change window starts
- have enough outcome evidence to judge product quality
- are not already obvious breakout hits
- show recent coordinated market activity in the March 14-26, 2026 window

The ranking blends four signals:

- `Product strength` (`35%`): sentiment, review depth, review velocity, and recent trend
- `Coordination` (`30%`): burst count, related news, source diversity, and non-pricing activity like release prep, store refresh, build activity, platform expansion, or positioning shift
- `Support gap` (`20%`): weaker attached publisher footprint scores higher, using both linked publisher scale and linked publisher catalog depth
- `Underappreciated` (`15%`): titles that are not already at the obvious high end of reviews and, where coverage exists, owner estimates score higher

### Prerelease-State Watchlist

The second cohort is **not** a clean future-launch list in the current live data. It is best treated as a **Steam prerelease-state watchlist**:

- games still marked `prerelease` in the live Steam state
- with recent coordinated activity in the March 14-26, 2026 window
- without an obvious major-publisher wrapper in the current linked-company data

The ranking blends:

- `Coordination` (`45%`): recent release-prep and visible activity intensity
- `Market attractiveness` (`30%`): how attractive the title's genre cluster looks based on the released market
- `Support gap` (`15%`): weaker current publisher support scores higher, using both linked publisher scale and publisher catalog depth
- `Readiness` (`10%`): language and platform breadth as a basic commercialization-readiness proxy

Important caveats:

- Some owner estimates are sparse or coarse in the current live snapshot, so the released ranking leans more heavily on reviews, review velocity, trend, and recent visible activity than on owner counts alone.
- Some fields can read as `0` because the live snapshot does not yet have strong coverage for that specific metric on that title or linked company. In this report, treat zero owner estimates, zero weekly hours, zero language count, or zero linked publisher owners as conservative placeholders unless the surrounding evidence clearly supports a literal zero reading.
- Every title in the prerelease-state cohort currently lands in a `past-date prerelease` bucket. That makes the second list useful as a **launch-state / stale-date watchlist**, but not strong enough to present as a clean “upcoming games” ranking.

## Top 5 Released Opportunities

| Rank | Game | Publisher | Why It Rose |
| --- | --- | --- | --- |
| 1 | `勇者与亡灵之都` | `grade` | Strong product quality (`97.3%` positive), recent related-news activity, and a small linked publisher footprint make it the cleanest “good product, weak wrapper, visible push” example in the current released set. |
| 2 | `Teddy's Haven - A Fantasy Inspired Shop Simulator` | `Teddy Bear Games LLC` | High sentiment (`95.6%`) plus unusually strong 30-day review velocity (`23.41`) and `6` recent bursts point to a game that is still small, still active, and commercially very reachable. |
| 3 | `Mini Cozy Room: Lo-Fi` | `Tesseract Studio` | Excellent quality (`98.7%`) and meaningful review depth (`534` reviews) paired with a broader GTM signature than a simple discount cycle: build activity, commercial activity, and store refresh all appeared in the recent window. |
| 4 | `Lucid Blocks` | `Eric Alfaro, Lucy B. Locks` | Big traction relative to the cohort (`2,418` reviews, `98.52` 30-day review velocity) and dense recent activity make it a strong radar candidate, though it still carries some near-launch bias. |
| 5 | `The Other Side` | `Vectora Games` | Solid quality (`91.5%`) with `6` recent bursts and a small linked publisher footprint. It looks more like an active but under-supported title than a fully commercialized catalog game. |

### Released Cohort Notes

- `勇者与亡灵之都` is the strongest overall released example because it uses nearly the full story: product quality, recent market-facing activity, and a lightweight commercial wrapper.
- `Teddy's Haven - A Fantasy Inspired Shop Simulator` is one of the most actionable BD names in the top set because the game is still small enough to matter and the recent execution signals are strong.
- `Mini Cozy Room: Lo-Fi` is a good proof point for why the change stack matters. Without typed change history, it would be much harder to separate a genuine multi-surface push from ordinary tail activity.
- `Lucid Blocks` ranks highly on merit, but it is closer to fresh-launch radar than the older, cleaner under-supported cases above it. If you want a stricter “post-launch only” deck, it is the first title I would caveat or move down.

## Top 5 Prerelease-State Watchlist

| Rank | Game | Publisher | Why It Rose |
| --- | --- | --- | --- |
| 1 | `Bearly Flying` | `kamphest` | Strong release-prep activity, related news, multiple activity sources, and a tiny linked publisher footprint make it the clearest current prerelease-state watchlist entry. |
| 2 | `Another Day As President` | `1610` | Similar profile to `Bearly Flying`: active coordination, related news, and a lightweight wrapper in a commercially understandable genre mix. |
| 3 | `BoobyRogue: Tumor Takedown` | `K-Nette` | Higher burst count than most of the prerelease-state field and an accessible action/roguelike profile make it one of the better current radar candidates. |
| 4 | `EGGCONSOLE ZANAC EX MSX2` | `D4Enterprise Co.,Ltd.` | Not the biggest score in the full field, but it pairs visible recent activity with a smaller linked publisher footprint and a clear genre context. |
| 5 | `Starshot Genesis` | `Happy Robot Shop` | Lean but still credible recent coordination paired with a minimal publisher wrapper make it more signable than many better-known prerelease-state titles. |

### Prerelease-State Notes

- This watchlist is intentionally labeled as a **prerelease-state** cohort, not a clean upcoming cohort.
- In the current live data, every ranked title in this set is a `past-date prerelease`, which likely reflects delayed launches, stale Steam release metadata, or launch-state cleanup rather than a clean future-release pipeline.
- That still makes the list useful for scouting teams showing active coordination before a broader breakout is obvious, but it should be presented as a softer supporting view than the released ranking.

## What This Study Proves Well

- PublisherIQ can scan a very broad Steam universe and narrow it to a credible opportunity set using both mature product-market data and recent execution signals.
- The platform can distinguish between:
  - good products with weak commercial setup
  - titles showing recent coordinated activity
  - already-obvious mainstream titles that are no longer realistic sourcing targets
- The change stack materially improves the quality of the shortlist because it separates passive catalog presence from active market movement.

## What This Study Does Not Yet Prove

- It does **not** yet prove which go-to-market playbooks reliably work over time.
- It does **not** yet support strong causal claims about whether news, media refreshes, pricing, or technical updates matter most.
- It does **not** yet support a clean “future upcoming games” study because the current prerelease-state layer is dominated by past-date prerelease entries.

## Appendix: Top 25 Released Opportunities

| Rank | Game | Publisher | Final Score | Positive % | Reviews | 30d Review Velocity | Bursts | Sources |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `勇者与亡灵之都` | `grade` | `88.1` | `97.3` | `185` | `1.5` | `3` | `2` |
| 2 | `Teddy's Haven - A Fantasy Inspired Shop Simulator` | `Teddy Bear Games LLC` | `87.1` | `95.6` | `91` | `23.4` | `6` | `2` |
| 3 | `Mini Cozy Room: Lo-Fi` | `Tesseract Studio` | `87.1` | `98.7` | `534` | `8.3` | `3` | `3` |
| 4 | `Lucid Blocks` | `Eric Alfaro, Lucy B. Locks` | `86.1` | `94.6` | `2418` | `98.5` | `8` | `3` |
| 5 | `The Other Side` | `Vectora Games` | `85.9` | `91.5` | `636` | `0.8` | `6` | `2` |
| 6 | `Rebooted Fate` | `Jilin miaomiao` | `85.7` | `96.5` | `2030` | `0.7` | `3` | `3` |
| 7 | `Typing Ninja` | `Brain Boost Ninja` | `85.4` | `93.3` | `30` | `0.1` | `3` | `3` |
| 8 | `PLATiNA :: LAB` | `HIGH-END Games` | `85.2` | `87.1` | `1165` | `6.7` | `5` | `3` |
| 9 | `BEERCRUSH` | `LOWLIGHT` | `85.2` | `100.0` | `63` | `1.9` | `5` | `2` |
| 10 | `FUMES` | `FUMES team` | `85.0` | `96.8` | `2038` | `2.9` | `3` | `2` |
| 11 | `Ithya: Magic Studies` | `BlueTurtle` | `84.8` | `98.0` | `1812` | `1.3` | `3` | `2` |
| 12 | `Maid Cafe Coop` | `Aranclanos` | `84.8` | `97.6` | `42` | `0.1` | `2` | `2` |
| 13 | `万界·飞升成圣` | `ForDream` | `84.7` | `92.6` | `27` | `0.9` | `12` | `3` |
| 14 | `Pro Wrestling Sim` | `Pro Wrestling Sim` | `84.7` | `96.8` | `620` | `0.5` | `3` | `2` |
| 15 | `迷雾岛屿：9号万能试剂` | `Bio.no.187` | `84.7` | `96.2` | `26` | `0.1` | `3` | `3` |
| 16 | `Idle Cultivation` | `Linmios` | `84.5` | `93.5` | `31` | `0.2` | `7` | `2` |
| 17 | `Better Mart` | `Exanticx Studio` | `84.3` | `94.9` | `197` | `2.4` | `2` | `2` |
| 18 | `Pompeii: The Legacy` | `Siscia Games` | `84.1` | `91.8` | `73` | `2.2` | `3` | `2` |
| 19 | `ANIWARS: Call of the Void` | `Breaker Interactive` | `84.0` | `96.4` | `56` | `1.3` | `15` | `2` |
| 20 | `Elixion` | `Sweet Levelz` | `84.0` | `100.0` | `25` | `0.1` | `2` | `2` |
| 21 | `The Doors of Trithius` | `Jake Donkersgoed` | `83.8` | `94.5` | `851` | `0.5` | `9` | `3` |
| 22 | `Arcadium - Space Odyssey` | `Luciano Bercini` | `83.8` | `93.5` | `107` | `0.4` | `5` | `2` |
| 23 | `Familiar Findings` | `Cliffa Games` | `83.6` | `98.9` | `91` | `0.2` | `2` | `2` |
| 24 | `挂机修仙` | `mixianzong, xiaokun` | `82.7` | `89.1` | `92` | `0.8` | `7` | `3` |
| 25 | `Banquet for Fools` | `Hannah and Joseph Games` | `82.5` | `91.9` | `136` | `13.3` | `11` | `3` |

## Appendix: Top 25 Prerelease-State Watchlist

| Rank | Game | Publisher | State Bucket | Final Score | Bursts | Related News Bursts | Sources | Genres |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `Bearly Flying` | `kamphest` | `past-date prerelease` | `85.5` | `3` | `2` | `2` | `Action, Adventure` |
| 2 | `Another Day As President` | `1610` | `past-date prerelease` | `84.0` | `3` | `2` | `2` | `Action, Indie, RPG, Simulation` |
| 3 | `BoobyRogue: Tumor Takedown` | `K-Nette` | `past-date prerelease` | `83.4` | `4` | `0` | `2` | `Action, Indie` |
| 4 | `EGGCONSOLE ZANAC EX MSX2` | `D4Enterprise Co.,Ltd.` | `past-date prerelease` | `80.8` | `3` | `0` | `2` | `Action` |
| 5 | `Starshot Genesis` | `Happy Robot Shop` | `past-date prerelease` | `79.0` | `2` | `0` | `2` | `Action` |
| 6 | `Pit Pioneers` | `Shearware` | `past-date prerelease` | `77.0` | `3` | `3` | `3` | `Indie, Strategy` |
| 7 | `Vipunk: Shield of Valhalla` | `Yodum Games I/S` | `past-date prerelease` | `75.2` | `3` | `0` | `2` | `Action, RPG` |
| 8 | `ASCII-RIFT` | `End of Line Club` | `past-date prerelease` | `74.4` | `2` | `0` | `2` | `Action, Indie` |
| 9 | `TechWorld` | `Kimo, KTGAMES` | `past-date prerelease` | `73.9` | `4` | `0` | `3` | `RPG, Strategy` |
| 10 | `Super Battle Royale` | `Liu Lirong, Yile Studio` | `past-date prerelease` | `73.6` | `3` | `0` | `2` | `Action, Indie` |
| 11 | `Runeblight` | `Zero Percent Juice` | `past-date prerelease` | `73.6` | `2` | `0` | `2` | `Action, Early Access, Indie` |
| 12 | `Reefglider` | `Down Underwater` | `past-date prerelease` | `71.9` | `3` | `0` | `2` | `Action, Adventure, Indie` |
| 13 | `FLY2K` | `HYPERNORMAL, Obscure Games` | `past-date prerelease` | `71.4` | `2` | `0` | `2` | `Action, Indie` |
| 14 | `Rail Fights` | `Korner Games` | `past-date prerelease` | `71.0` | `8` | `0` | `2` | `Action, Casual, Indie` |
| 15 | `Yes, My Warlord` | `Three Cogs Interactive` | `past-date prerelease` | `68.8` | `3` | `0` | `2` | `RPG, Simulation` |
| 16 | `Soukh` | `Noctis Tide Studios` | `past-date prerelease` | `67.1` | `7` | `0` | `2` | `Early Access, Simulation, Strategy` |
| 17 | `Bunny Factory` | `纯朴Simpliciy` | `past-date prerelease` | `67.1` | `2` | `0` | `2` | `Action, Casual, Indie` |
| 18 | `The graveyard duty fall of the last demon` | `Faustina Mutamba` | `past-date prerelease` | `67.0` | `4` | `0` | `2` | `Action, Adventure, Casual, Early Access` |
| 19 | `猜拳退魔師` | `DessertTheory` | `past-date prerelease` | `65.0` | `3` | `0` | `2` | `Action, Casual, Indie` |
| 20 | `Lazy Writer` | `Pavel Urakov` | `past-date prerelease` | `64.4` | `2` | `0` | `2` | `Casual, Indie, RPG, Simulation` |
| 21 | `100 Blacksmith Cats` | `100 Cozy Games, Cats` | `past-date prerelease` | `62.7` | `2` | `0` | `2` | `Casual, Free to Play, Indie` |
| 22 | `Idle Geometry Defense` | `Urban Isotope` | `past-date prerelease` | `59.6` | `3` | `2` | `2` | `Indie, Simulation, Strategy` |
| 23 | `Dead Z Meat` | `ISTOM Games` | `past-date prerelease` | `58.2` | `2` | `0` | `1` | `Action, Adventure, Casual` |
| 24 | `Mine Mine` | `froggyrs` | `past-date prerelease` | `57.6` | `2` | `0` | `2` | `Simulation` |
| 25 | `Tetro Runner` | `Rollmop Games Studio` | `past-date prerelease` | `57.5` | `1` | `0` | `1` | `Action, Indie` |

## Raw Data

Raw data and reproducible SQL pulls for this study live here:

- [Released SQL](/Users/ryanbohmann/Desktop/publisheriq/docs/reports/sql/go-to-market-opportunities-released-2026-03-26.sql)
- [Prerelease-State SQL](/Users/ryanbohmann/Desktop/publisheriq/docs/reports/sql/go-to-market-opportunities-upcoming-2026-03-26.sql)
- [Released CSV](/Users/ryanbohmann/Desktop/publisheriq/docs/reports/data/go-to-market-opportunities-released-2026-03-26.csv)
- [Prerelease-State CSV](/Users/ryanbohmann/Desktop/publisheriq/docs/reports/data/go-to-market-opportunities-upcoming-2026-03-26.csv)
