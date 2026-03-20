# Chat Output User Critique

This document critiques the answers in [docs/chat-prompt-evals.md](/Users/ryanbohmann/Desktop/publisheriq/docs/chat-prompt-evals.md) from the perspective of real PublisherIQ users.

It does not critique prompt quality.

Users will ask short, vague, underspecified, and sometimes sloppy questions. That is normal product behavior. The bar is not whether the prompt was ideal. The bar is whether the answer did the best possible job of interpreting likely intent and returning something trustworthy, useful, and decision-ready.

PublisherIQ is also not just a game search tool. The answer quality has to hold up across game discovery, publisher and developer research, portfolio comparison, market monitoring, change intelligence, and agency/prospecting workflows.

## Who These Answers Need to Work For

### Publishing Strategy Lead
- Uses chat to size categories, find comps, compare publishers and developers, and pressure-test portfolio decisions.
- Needs answers to show ranking logic, quality thresholds, top titles, and enough context to compare companies rather than just list them.
- Distrusts answers that confuse owners, CCU, reviews, or that surface obviously low-signal entities without explaining why they belong.
- Most relevant families: filtered discovery, company rankings, portfolio comparisons, similarity.

### Competitive / Market Intelligence Analyst
- Uses chat to monitor shifts in the market, identify breakout titles, track release timing changes, and interpret storefront activity.
- Needs exact time windows, clearly labeled metrics, before/after evidence, and enough supporting detail to defend the answer internally.
- Distrusts answers that use relative time without dates, give generic change labels, or answer a nearby but different question.
- Most relevant families: trending, time-relative questions, change intelligence, company comparisons.

### Developer Studio Lead or Product Lead
- Uses chat to find believable comps, understand positioning, and benchmark against adjacent games and studios.
- Needs credible comparables, release context, review score and count, price, platform status, and a short reason each result is included.
- Distrusts answers that look like keyword collisions, include lexical title contamination, or never explain why a game or studio is similar.
- Most relevant families: lookup game, similarity, concept search, developer comparisons.

### Agency / Business Development Prospector
- Uses chat to identify games or studios that might need marketing support, relaunch help, or strategic outreach.
- Needs ranking, timing, evidence quality, and clear proof for why a title looks under-marketed or newly active.
- Distrusts answers that collapse to "no results" on strategic questions or use repeated generic reasoning across every row.
- Most relevant families: change intelligence, prospecting, trend monitoring, publisher/developer lookups.

### Investor / Portfolio Analyst
- Uses chat to evaluate momentum, portfolio quality, category performance, and company-level opportunity.
- Needs answers with sane thresholds, metric clarity, time grounding, and enough portfolio context to compare entities.
- Distrusts answers that misuse metric labels, let tiny-sample junk dominate rankings, or provide only one topline number with no context.
- Most relevant families: analytics, portfolio rankings, entity lookups, trend answers.

## How Answers Are Judged

- `Directness`: did the answer address the question the user likely meant, not just a nearby question?
- `Completeness`: did it return enough rows and enough fields to be useful?
- `Relevance`: are the returned games, publishers, and developers obviously the right kind of match?
- `Trustworthiness`: do the data, labels, dates, and explanations feel internally consistent and believable?
- `Decision value`: could a real PublisherIQ user act on the answer?
- `Grace under ambiguity`: when the prompt is messy or broad, did the answer add the missing context users would need instead of hiding behind the prompt?

## Core Verdict

- Many answers are fluent, formatted, and operationally successful, but still weak as product answers.
- The biggest recurring failure is graceful-looking wrongness: the answer sounds polished while returning the wrong metric, the wrong answer shape, implausibly thin coverage, or irrelevant matches.
- The second major failure is dead-end behavior. On exactly the questions where users need the system to think harder, the answer often collapses to "no results" with no near-matches, no caveats, and no evidence of what was checked.
- The eval scoring appears to overweight successful tool execution and underweight user trust. Many `9/10 Strong` answers would not feel strong to a real PublisherIQ user.

## Findings By Answer Type

### 1. Game Lookups and Filtered Discovery

What users want from these answers:
- a credible list
- enough rows to feel representative when the category is broad
- core judging fields such as review score, review count, release date, price, publisher, developer, and Steam Deck or platform status when relevant
- some indication of why each result belongs

Where current answers fall short:
- `#2 free metroidvania games` returns only 3 games and acts complete. For a broad Steam category, that feels implausible without any explanation of catalog coverage or ranking threshold.
- `#10 tell me about Hades II` says Hades II "is an upcoming" game and "is set to be released on September 25, 2025" even though the eval ran on March 19, 2026 and other answers in the same corpus show live review counts. The answer is temporally incoherent.
- `#21 Show me all the DLC for Elden Ring` does not behave like a trustworthy DLC answer. It mixes the base game and related titles into what should be a clean expansion list.
- `#138 Games currently on sale` is technically a list of games on sale, but it reads like an extreme-discount dump dominated by low-signal titles. That is not what most professional users mean by "show me games currently on sale."
- `#141 Highly rated games under $10 released in the past year` is dominated by tiny-sample 100% review titles. It looks responsive, but it does not feel like a useful shortlist.
- `#219 Games under $5 with overwhelmingly positive reviews` starts with a valid under-$5 section and then immediately adds a second section containing games above $5. Once the answer breaks a hard numeric constraint, the whole output becomes suspect.
- `#242 Premium games over $40 with great reviews` says there are no qualifying games at all. That is an implausible output for Steam and reads like a false negative rather than a trustworthy answer.

What is missing from the answer layer:
- review counts, not just percentages
- release dates or release state
- explanation when a broad category returns very few rows
- quality floors so bargain-bin noise does not dominate
- a short reason each result is included

### 2. Publisher, Developer, and Company Answers

What users want from these answers:
- context, not just a naked number
- a trustworthy role match between publisher and developer
- portfolio shape, top titles, quality profile, and time window when relevant
- comparisons that actually compare the asked metric

Where current answers fall short:
- `#89 Which indie developers have multiple hit games?` includes Ubisoft Montreal and CD PROJEKT RED in an "indie developers" answer. That is not a subtle miss. It is a category-level trust failure.
- `#97 Compare FromSoftware and Team Cherry by reviews` returns only average review score. The user asked "by reviews," but the answer strips out review volume and portfolio context.
- `#127 What publishers are releasing the most games this year?` and `#157 Which publishers released the most games this year?` provide topline counts but no quality or portfolio context, so the list is hard to interpret and easy to misread.
- `#130 Publishers with the most games released in the past 6 months` returns a table of publishers and one release date each. The answer shape is wrong. Users asked for volume, not a date field.
- `#140 Publishers with 5+ games averaging 85%+ reviews in the past 3 years` mixes an all-time-looking summary with a second year-by-year table. The output gives data, but not a clear conclusion.
- `#151 Developers with 3+ games, all above 90% reviews, with a release in the past year` says nobody matches and then pivots into a different leaderboard by total reviews. That is not a helpful recovery.
- `#152 What tags exist for colony sim games?` reduces the answer to "The tag is Colony Sim." That is technically correct and still product-poor. A real user likely wants adjacent tags or at least a little discovery context.
- `#155`, `#156`, and `#161` all claim there are no FromSoftware games in the database. That is a hard trust break.
- `#170 What publishers are similar to Devolver Digital?` falls back to name-adjacent publishers like `Evolver Dynamics` and `Revolver Nine`.
- `#171 Show me developers similar to Supergiant Games` falls back to developers with similar names like `Giant Games` and `SuperJoy Games`. That is not company intelligence.
- `#175 Publishers with releases in every year since 2020` ends in an iteration-limit failure message, which is simply a failed answer from the user perspective.
- `#178 How many games has Krafton published?` and `#179 How many games has Valve published?` answer with a bare count only. For a company intelligence product, that is thinner than it should be.

What is missing from the answer layer:
- top titles or portfolio examples
- review count and quality context
- time window interpretation
- role clarity between publisher and developer
- company similarity logic
- follow-through after a count, not just the count itself

### 3. Similarity and Comp-Finding Answers

What users want from these answers:
- clear comp logic
- confidence that requested filters were obeyed
- explanation of whether the match is franchise-based, mechanically similar, audience-similar, or commercially similar

Where current answers fall short:
- `#51 Steam Deck games like Hades II` includes `Hades Nebula` and `Hades' Star`, which makes the result look contaminated by title words rather than genuine similarity. It also never explains why each result is like Hades II.
- `#49 Games like Hollow Knight but with pixel art`, `#132 Games similar to Hollow Knight with better reviews`, and `#134 Games like Hollow Knight but with fewer than 10K reviews` all show versions of the same problem: decent-looking tables with very little comp logic.
- `#170` and `#171` show the same failure on publishers and developers rather than games.
- `#190 Find games in the same series as Dark Souls` quietly shifts from "same series" to "Souls-like." It includes Elden Ring, Sekiro, Remnant, and Nioh. That is a nearby answer, not the asked answer.

What is missing from the answer layer:
- a short "why this match" reason on every row
- distinction between same franchise and same feel
- evidence that constraints like Steam Deck, price, and popularity were actually applied
- protection against lexical contamination

### 4. Concept and Taste-Based Discovery

What users want from these answers:
- interpretation of the idea behind the query
- quality guardrails
- enough taste awareness that the results feel curated rather than literal

Where current answers fall short:
- `#18 horror games with investigation elements` and `#195 Horror games with investigation and puzzle elements` look like title-keyword collisions more than credible concept matches.
- `#19 Tactical games with deck building` and `#186 Tactical roguelikes` are dominated by games with "deck" or "rogue" in the name rather than clear tactical deck-builders.
- `#42 Relaxing puzzle games with beautiful art` reads like a scrape of low-cost jigsaw and anime puzzle titles rather than a thoughtful interpretation of the aesthetic request.
- `#229 Fast-paced action games with pixel art` returns mostly literal "pixel" titles with weak quality filtering.

What is missing from the answer layer:
- a brief statement of the interpreted concept
- quality filters so low-signal title matches do not dominate
- a one-line reason each result fits the concept
- signals that the system understood tone and taste, not just words

### 5. Trending and Time-Relative Answers

What users want from these answers:
- exact time windows
- clearly defined trend metrics
- clean filtering
- results that help them interpret momentum, not just look at a list

Where current answers fall short:
- `#158 What free-to-play games have the most players right now?` labels huge values like `150,000,000` as "Players" and never anchors "right now" to an exact date and time. The label feels wrong, and the time framing is loose.
- `#160`, `#172`, `#173`, `#174`, `#180`, `#184`, `#194`, `#244`, `#245`, `#246`, `#247`, and `#249` keep reusing nearly the same answer shape without clearly telling the user whether this is raw review volume, acceleration, momentum, or sentiment improvement.
- `#181 What horror games are gaining momentum?` includes obvious non-horror titles like `Grand Theft Auto V Enhanced`, `TEKKEN 8`, and `Titanfall 2`. That is a visible filter-integrity failure.
- `#102 Compare top 5 roguelites by review velocity and CCU` compares one roguelite list to a second table of global CCU leaders. The answer looks analytical while failing the actual comparison task.
- `#246` and `#248` do not make the "indie" label trustworthy. If `WWE 2K26` appears in a breaking-out indie answer, users stop trusting the category.

What is missing from the answer layer:
- exact windows such as `March 13-19, 2026`
- metric definitions
- sort and ranking logic
- clearer genre and platform compliance
- explanation of why a title counts as breaking out rather than simply being large

### 6. Change Intelligence and Strategic / Prospecting Answers

What users want from these answers:
- what changed
- when it changed
- what the old state was
- what the new state is
- why that matters
- how strong the evidence is

Where current answers fall short:
- `#20 Which games showed a sustained response after recent Steam changes?` returns too little proof to justify the claim.
- `#46 Which live-service or frequently updated games look under-marketed and could be good agency prospects?` sounds strategic but never proves either "under-marketed" or "good agency prospect."
- `#48 Show me games that used a likely relaunch pattern...` gives nearly identical canned reasons for every row. It feels templated rather than analytical.
- `#54` and `#90` ask for before/after understanding, but the answers mostly show snapshots and generic change labels instead of the actual content shift.
- `#87 upcoming games with recent release timing changes` gives current release dates but not the change itself.
- `#88 What are the biggest Steam page refreshes lately?` and `#222 Find games that changed tags or genres materially...` sound analytical while providing generic filler instead of concrete evidence.
- `#139 Show me the recent Steam changes for Hades II` is one of the clearest failures in the file: it repeats near-identical `Additional structured change detected` rows and never tells the user what actually changed.
- `#221 Show me the biggest Steam store-page changes for Hades II in the last 90 days` repeats the same row 10 times and then summarizes over the last 30 days even though the prompt asked for 90 days.
- `#176`, `#177`, `#191`, `#243`, `#250`, and `#251` all collapse into dead-end no-results responses on exactly the kinds of strategic questions where users need the system to offer near-matches, caveats, or evidence of what was checked.
- `#253` through `#256` simply fail with no captured answer at all. These are hard product failures in a high-value part of PublisherIQ.

What is missing from the answer layer:
- before and after state
- title-specific evidence
- old vs new values
- dates and windows
- ranking logic for prospecting answers
- near-miss candidates when nothing fully qualifies
- confidence or caveat language grounded in evidence

## High-Severity Answer Failures

- `#2` returns only 3 free metroidvania games with no coverage explanation.
- `#10` is temporally incoherent about Hades II for a March 19, 2026 eval run.
- `#42` mistakes surface keywords for tasteful concept interpretation.
- `#51` does not explain similarity and includes obvious lexical contamination.
- `#89` labels Ubisoft Montreal and CD PROJEKT RED as indie developers.
- `#102` compares two different populations instead of the same roguelite set.
- `#130` returns release dates instead of release counts.
- `#152` is technically correct and still too thin to be useful.
- `#155`, `#156`, and `#161` return a false negative on FromSoftware.
- `#158` likely mislabels owner-scale numbers as current players and does not anchor "right now."
- `#171` falls back to developers with similar names to Supergiant rather than meaningful peers.
- `#181` visibly breaks the horror filter.
- `#216` answers "best VR games" with a list full of obscure titles carrying `N/A` review percentages.
- `#219` breaks its own under-$5 constraint.
- `#221` repeats the same generic Hades II change row and fails the 90-day framing.
- `#242` claims there are no premium games over $40 with great reviews.
- `#246` and `#248` make the "indie" label unreliable.
- `#251` promises ranking and gives no ranking.
- `#253`, `#254`, `#255`, and `#256` produce no useful answer at all.

## What Strong Answers Should Contain

| Answer Family | Minimum Content | What Breaks Trust Fastest |
|---|---|---|
| `Game lookup` | Release state/date, review score, review count, price, developer, publisher, platform or Steam Deck status when relevant | Outdated or contradictory status, no review count, overly thin one-paragraph answers |
| `Publisher lookup` | Count plus portfolio context, notable titles, review/quality context, timeframe if implied | Naked counts with no context, role confusion, obvious false negatives |
| `Developer lookup` | Core portfolio summary, top games, quality profile, comparison context when requested | Missing top titles, wrong entity match, fallback to unrelated or name-similar studios |
| `Company ranking / comparison` | The asked metric, at least 2 or 3 supporting metrics, clear timeframe, why the ranking matters | Wrong answer shape, mixed scopes, no way to compare the returned companies |
| `Filtered discovery list` | Enough rows to feel representative, review score, review count, release date, price, company, platform qualifiers, why included | Tiny result sets presented as complete, no quality floor, no explanation of scarcity |
| `Similarity / comp answer` | A per-row reason for similarity, filter compliance, distinction between franchise similarity and feel similarity | Title-word contamination, no explanation of why results belong, ignored filters |
| `Concept / taste answer` | Interpreted concept, quality guardrails, short reason each result fits | Literal keyword matching, low-signal junk, no taste awareness |
| `Trending answer` | Exact date window, metric definition, ranking logic, enough context to distinguish size from momentum | Relative-time vagueness, mislabeled metrics, repeated generic lists for different trend questions |
| `Change / before-after answer` | What changed, when, before state, after state, why it matters, confidence if speculative | Repeated generic change rows, no actual change content, no old vs new state |
| `Prospecting / opportunity answer` | Ranked candidates, why each one qualifies, evidence quality, timing, near-misses when nothing fully qualifies | "No results" dead ends, identical canned reasoning, no prioritization |

## Bottom Line

The main issue is not that the answers are unformatted or obviously broken. The main issue is that too many answers look finished before they have actually earned trust.

PublisherIQ users are asking questions because they need evidence, interpretation, and decision support across games, publishers, developers, and market changes. An answer that is fluent but thin, nearby but not exact, or numerically labeled in a suspicious way is still a weak answer.

The product should be judged by whether its answers help a professional user trust the result and move to the next decision. On that standard, a meaningful portion of the current corpus is not good enough yet.
