# Temporary October 2026 Next Fest snapshots

The existing `/next-fest` atlas serves a static HTML payload. `next-fest-daily.yml` refreshes its 7,218 verified demo IDs daily at 06:17 UTC through November 2, 2026. It collects CCU for the whole roster and refreshes up to 3,609 review summaries per UTC day, oldest first. The review target is a full rotation in roughly two days. Delays or failures can extend that interval; the page always shows actual source times and stale/failed states.

This temporary worker writes files and GitHub artifacts, not database records. It does not change the existing review or CCU jobs, activate the retired demo scheduler, apply SQL, refresh projections, or add dependencies. The previously completed review API migration remains separate. Demo IDs supply players/reviews; parent IDs remain the identity for game metadata and links.

## Request and resource budget

The owner confirmed Valve permission to use two keys at their basic 100,000-call daily allowances and approved sharing `STEAM_REVIEWS_API_KEY` for festival CCU and reviews. The first key receives no new festival requests. The existing main CCU client sends no API key, so its approximately 128,004 successful observations in the audited day are workload, not measured first-key usage.

The regular review worker acquires its shared Tiger token bucket before every attempt, including retries. A bounded production read on October 21 at 04:26 UTC verified capacity 1 and refill 1/second. That bounds this existing consumer at approximately 86,401 attempts in 24 hours. The festival worker checks that configuration before each phase and refuses to collect if it changes. This calculation assumes other callers do not bypass that limiter or begin using this dedicated key; re-audit before changing either setup.

| Item | Limit or expected volume |
| --- | --- |
| Daily full-roster CCU | 7,218 primary requests |
| Daily reviews | At most 3,609 demos; fewer when fresh results can be reused |
| Normal festival requests | At most 10,827/day before retries and reuse |
| Festival hard cap | 12,000 attempts in every rolling 24 hours, including retries |
| Per-signal rolling caps | CCU 8,000; reviews 4,000 |
| Combined second-key bound | Approximately 98,401/day, leaving about 1,599 calls of margin |
| Concurrency | One HTTP request in flight; phases run sequentially |
| Request pacing | At least 1 second between CCU attempts, 4 seconds between review attempts |
| Retry limits | At most two attempts per demo per signal per UTC day; 15-second HTTP timeout |
| Runtime | Five-hour deadline per phase; 330-minute GitHub job timeout |
| Database | Two short, sequential read-only connections per full daily run; one cohort metrics read and two limiter checks |
| Database writes / downstream refreshes | Zero |
| File writes | One durable JSONL reservation before each attempt, one result per observation/reuse; two snapshot replacements per run |
| Retention | Complete two-week journals in two artifacts/run, retained 21 days; published HTML retained in Git |

At minimum spacing, a full day without reuse takes about six runner-hours, plus setup and any slow responses (about 84 hours over 14 days). Each phase fits the hosted six-hour job limit separately. Current endpoint rates are not a guarantee of throughput. The workflow stops on the first 401/403/429 or five consecutive failures; a demo explicitly reported invalid does not count as a service outage. It never retries the retired `/appreviews` route.

Only one app ID is supported by the CCU and exact review-summary endpoints. A bounded StoreBrowse batch probe returned review totals and rounded positivity but no exact positive/negative counts or CCU; it is not used. Fresh, consistent regular-scraper or prior-snapshot review observations under 36 hours old are reused with their original timestamps. The 36-hour threshold skips the intervening daily pass while making the second pass due even when GitHub starts slightly early. Unknown/older reviews are sorted first. Active demos lead the CCU order without excluding inactive demos.

The October 20 investigation found Tiger at 0.5 vCPU / 2 GB RAM, about 60.2 GB database size, and 15 connections against 105 allowed. Sustained CPU/memory headroom was unavailable. The cohort read took 690 ms; existing SQL timeouts were present. Therefore this design avoids ingestion writes and projection refresh work. Reads have 8-second statement and 2-second lock limits and close before Steam polling starts. Connection availability alone is not proof of compute headroom.

## History, publication, and failure behavior

Every request is reserved in an append-only, synced journal before HTTP starts. The next GitHub run restores that journal before collecting; all runs share one concurrency group. Rolling caps wait for old attempts to expire instead of resetting at midnight. The collector stops if a UTC day changes, preventing an overlapping date shard.

A run restores the preceding phase's final archive, including failed runs whose journal uploaded successfully. If collection ran but its final archive is missing, collection pauses for at least 24 hours; a preflight-only failure does not restart that wait. Missing all prior history, torn records, rerunning an existing GitHub attempt, or an unexpected roster fails closed. Dispatch a new run to resume from artifacts; never delete/reset the journal to get around a cap.

Publication requires results for all 7,218 CCU demos, at least 95% successful CCU observations, valid signal/combined caps, matching journal values, and the current export date. Failed individual observations retain their previous successful values and expose the later failure. First-run review coverage will be partial until the second daily rotation; it is not labeled complete or fresh by exporting.

The publisher commits only `apps/admin/src/app/next-fest/content/atlas.html` on the current default branch. It checks whether that file changed during collection and stops rather than overwrite concurrent edits. Other files on the current branch are preserved. Branch protection or a rejected push leaves the completed artifact available for review. The existing Vercel Git integration must complete before the site is considered updated.

The UI calculates positivity from exact vote counts; zero reviews have no positivity percentage. CCU is labeled “players at last check,” with the highest sampled count, actual collection window, and sample count. Once-daily samples cannot establish a true peak or intraday trend. Review changes are signed differences between lifetime-count observations, not counts of reviews written during the festival. Festival review text, follower/news/discussion polling, and higher-frequency active-demo sampling remain optional follow-ups.

## Verification and activation

1. Run `node --test scripts/ops/{collect-next-fest,export-next-fest-popularity,next-fest-github-state}.test.mjs`, repository type checks/lint/build, and the existing Next Fest access tests. The worker without `--collect` prints its plan and makes no network calls.
2. Merge the scoped release with `ENABLE_NEXT_FEST_COLLECTION` unset/false. Dispatch `next-fest-daily.yml` with `batch_size=10` and `publish=false`: up to ten CCU and ten review demos, at most forty HTTP attempts. Review the artifacts for key/rate errors, exact vote consistency, genuine zeros, original timestamps, pacing, and request accounting. Compare regular-review job telemetry and a bounded DB health sample before/after.
3. After the canary passes, dispatch a new full run with `batch_size=7218` and `publish=true`. It restores the canary's journal and skips already-completed demos. Confirm full CCU coverage, review freshness, the atlas-only commit, deployed page/CSV, and follow-up response times. Then set `ENABLE_NEXT_FEST_COLLECTION=true` for the daily schedule. A partial first review rotation is expected.
4. After November 2 the date gate prevents collection even if the variable remains enabled. Disable the workflow/variable when the temporary page is retired.

Rollback: set only `ENABLE_NEXT_FEST_COLLECTION=false`, cancel this workflow if needed, and restore the last good atlas commit. Keep its artifacts so request history remains trustworthy. Do not alter existing worker gates, reset request accounting, delete production data, or revert the completed reviews migration.

Sources: [Valve API terms](https://steamcommunity.com/dev/apiterms), [exact review API](https://partner.steamgames.com/doc/webapi/IUserReviewsService), [CCU API](https://partner.steamgames.com/doc/webapi/ISteamUserStats), [GitHub runner limits](https://docs.github.com/en/actions/reference/limits). Dated audit evidence is retained locally under `output/steam-next-fest-2026-10/`.
