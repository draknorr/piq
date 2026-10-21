# Temporary October 2026 Next Fest collection

The `/next-fest` atlas remains static. The temporary roster/schedule selects 7,218 verified **demo** IDs; shared Steam clients and Tiger writers persist observations; the daily exporter reads Tiger; the existing atlas-only Git commit uses normal Vercel publication. Parent game IDs remain metadata/link identities.

The Tiger transition was activated with explicit approval on October 21. The first full pass (`39581273257`) finished with 2,563 new successful review observations, zero retries/failures, and 7,218 reused CCU observations. All new review observations matched Tiger; the validated static export was published as `40d53eb5` and its normal Vercel production deployment was verified Ready. Connection/lock checks are bounded samples, not sustained capacity proof.

The schedule stays at 06:17 UTC, October 22–November 2, following the October 21 bootstrap. CCU targets the full roster daily; reviews select up to 3,609 oldest due demos daily, aiming for a two-day rotation. Failures, budgets, backlog replay, and runner delays can extend these intervals. The expiry remains November 3 at 00:00 UTC.

## Audit findings and scoped fix

Read AGENTS.md and CLAUDE.md before operating. Live read-only checks at 07:41 UTC October 21 confirmed:

- `metrics.ccu_snapshots` already accepts exact times and genuine zero counts; `(appid, snapshot_time)` identifies replayed observations. Its ID is an identity column.
- Review totals and daily deltas already exist. They retain one mutable row per app/day, not every observation with its original timestamp. The owner selected reuse of `docs.app_source_snapshots` for exact review history rather than a new table. `0118_review_source_observations.sql`, applied with approval on October 21, permits `source='reviews'` and adds a partial unique index for replay.
- The live snapshot lifecycle trigger returns immediately for non-storefront sources. No review change events or new projection refresh calls are added.
- Latest-metrics statements increment `opportunity.cohort_source_revisions_v1`. Existing downstream consumers may therefore do more work. The separate local peak-cache migration is unrelated and was not present in the audited live trigger set.
- Tiger showed 27/105 connections, zero lock waiters, and 30 cumulative deadlocks. Prior evidence records 0.5 vCPU / 2 GB RAM and existing statement timeouts. Neither the connection sample nor passing unit tests establishes sustained compute headroom.
- Earlier roster evidence found mixed `Demo`/`demo` catalog types and 81 absent catalog rows. Explicit verified demo IDs bypass selection gaps without restarting the retired demo scheduler, modifying regular collection coverage, or creating placeholder games.

The festival adapter uses the existing review API client and shared demo CCU client module. CCU writes use the existing snapshot and daily-peak writers plus a timestamp-guarded demo status checkpoint. Review writes archive exact observations, then reuse the existing transactional review metrics writer when an existing sync-status row is unclaimed and older. Active regular claims, their schedule, priority overrides, and failure state are preserved. Claimed or uncatalogued demos still retain their observation in Tiger history and appear in the export; their regular latest-metrics row can lag until ordinary collection catches up.

Ordinary review workers now pass their individual response times to the batch writer rather than assigning every response the batch's persistence time. Historical observations retain their previously recorded timestamps; older batch timestamps cannot be reconstructed more precisely.

## Budgets, overlap, and load

The authorized two-key setup and each key's 100,000-call daily allowance remain unchanged. Festival calls continue to use only `STEAM_REVIEWS_API_KEY`. The first key receives no new festival traffic. Existing unauthenticated CCU traffic must not be counted as measured first-key usage.

The live regular-review limiter remains capacity 1, refill 1/second, acquired before every regular attempt including retries. This bounds that consumer at about 86,401 attempts per 24 hours. Festival reservations remain capped at 12,000 attempts in **every rolling 24 hours**, including retries, with CCU/review caps of 8,000/4,000. The combined second-key bound is approximately 98,401, leaving about 1,599 calls. This depends on all shared consumers continuing to use the audited paths; there is no provider usage meter here. The adapter rechecks the regular limiter before every collecting phase. Replay makes zero Steam requests.

### Approved one-time review catch-up

The October 21 manual workflow input `review_catch_up=true` collects only the 2,470 demo IDs pinned in `scripts/ops/next-fest-review-catch-up.json`, selected from the verified export at the 14:05 UTC assessment. Use `mode=collect`, `batch_size=7218`, and `publish=true`. It expires at October 22 00:00 UTC and is never selected by the daily schedule. Current fresh Tiger reviews are still reused. Twenty-five targets had earlier same-day reuse records that became stale; the override preserves those records while allowing their first actual request. Subsequent dispatches retain receipts, daily per-demo attempt limits, and all prior reservations.

Only this explicit catch-up raises the combined rolling cap to 13,500 and the review cap to 6,300. The regular review limiter stays at 1/second, so the audited combined second-key ceiling remains about 99,901 attempts per rolling day; there is no provider usage meter for unrelated/unreported consumers. At approval, the festival journal contained 10,828 attempts: 2,470 primary catch-up calls would bring it to 13,298, leaving at most 202 retry calls under the combined cap. The writer, checkpoints, pacing, error stops, and export remain unchanged. No SQL is required.

Normal runs retain their existing caps. Retained catch-up calls can make the following day's run wait for rolling capacity; counters must not be reset to avoid this wait. Catch-up publication explicitly validates the same date-scoped caps and all normal coverage, persistence, and non-regression guards. Stop the run on failure and retain its artifacts; disable the input or revert this scoped change to withdraw the override. Keep the validated page and all Tiger observations.

Fresh Tiger CCU under 20 hours old and consistent review observations under 36 hours old are reused with original timestamps. These cutoffs allow the next daily/alternate-day pass to become due even when the runner starts early. Later failures prevent reuse. Phase-start reads reduce overlap, but a regular worker can collect a demo after that read; an occasional duplicate request remains possible. Writer timestamp/claim guards prevent that overlap from overwriting newer observations or delaying regular work.

| Daily work, before reuse/failures | Upper planning estimate |
| --- | --- |
| Steam primary calls | 7,218 CCU + 3,609 reviews = 10,827 |
| Steam attempts including retries | Hard maximum 12,000 rolling 24h |
| New CCU rows | Up to 7,218 timestamped snapshots |
| Other CCU changes | Up to 21,654 daily/latest/status row changes |
| New review history | Up to 3,609 observations; failures are retained too |
| Regular review metric/status changes | Up to 14,436 across four existing tables |
| Opportunity revision updates | About 434 with full 25-result batches; partial batches/replay add overhead |
| Total | About 47,351 row changes/day at the successful no-reuse planning bound |

Review reuse can additionally archive a regular worker's source observation once so a precise baseline survives future updates; duplicate timestamps do not add history rows. Cutover also imports retained journals and published review baselines once. Those initial writes are additional to steady-state estimates. A replay after an ambiguous CCU commit may repeat daily/status statements, while snapshot uniqueness prevents duplicate samples. Unrelated future trigger changes require revisiting these estimates.

Writes are sequential, in checkpoints of at most 25 observations. One writer-pool connection is allowed; an exporter connection may temporarily coexist with the idle writer, for **at most two additional connections and one active query at a time**. Connections have 10-second connect, 8-second statement, and 2-second lock timeouts; the idle writer closes after 10 seconds. A complete collecting run makes four bounded roster reads (before and after each phase), including review-history lookups. The ten-demo read check validates SQL only; full-roster export latency after ingestion remains to be measured during rollout. No connection is held in a transaction while waiting for Steam. There is no per-request projection refresh, ranking pass, new service, dependency, or regular scheduler activation.

One Steam request is in flight, with at least 1 second between CCU attempts and 4 seconds between reviews. Both lanes retain their two-attempt daily per-demo cap, 15-second request timeout, five-hour phase deadline, and 330-minute job timeout. Authorization/rate errors or five consecutive service failures stop collection. Minimum no-reuse collection time remains about six runner-hours/day across sequential phases.

## Durability, export, and viewer semantics

Every HTTP attempt is durably reserved before it starts. Results remain in the existing journal until their Tiger write succeeds; `persisted` receipts are appended afterward. A database failure stops new collection. Replays retain original source times and are idempotent. Full journals remain in 21-day artifacts for budget accounting, recovery, and publication verification; the page's observations are read from Tiger.

Restore the latest final artifact, including failed-run artifacts. A prior active run must drain before its state can be restored. Missing/torn journals still fail closed; an interrupted collection with no final journal needs artifact recovery or the existing 24-hour conservative wait. Never reset counters, discard results, or rerun an existing GitHub attempt to bypass recovery.

CCU exports aggregate raw snapshots from October 19 at 17:00 UTC through the temporary collection expiry. They preserve genuine zeros, the sampled high, number of samples, and actual first/last sample times. A daily sample is not a true intraday peak. Reviews use exact votes for positivity, with no positivity percentage at zero reviews. Lifetime totals remain distinct from signed changes between actual festival observations. A decline stays negative. No festival-start total or missing value is invented.

Publication requires a Tiger export, all journal results acknowledged, a current export date, full daily CCU attempt/reuse coverage, at least 95% successes, valid request caps, and no observation regression. A newer Tiger value is allowed. Missing/older source data stops publication instead of replacing a good snapshot. The atlas concurrency guard and atlas-only commit remain. Vercel completion must be verified separately.

## Static popularity views

The atlas uses its embedded snapshot for player/review weighting in the word cloud, bubble atlas, connection nodes, and primary-segment bars. Each title contributes once per tag; tag totals overlap. Coverage includes known zero counts, while tags with zero or unknown totals have no size in weighted views. Tag positivity pools underlying positive and negative votes. The original title-count and relative-frequency options remain available; the latter is labeled “More common here” and compares a tag’s share of the selection with its share of the festival. Connection edges continue to measure shared titles.

The players-versus-reviews chart plots one point per game with both observations known, using `log10(1 + count)` to include genuine zeros. Canvas draws the points without thousands of DOM nodes; SVG retains axes, labels, a focusable selection, and arrow-key navigation. Clicking coincident points cycles their games. The top-ten list uses independently scaled player/review bars, links selection to the chart and inspector, and appears first on narrow screens. Both views follow the existing game/tag filters. Hover details show short names and numbers; missing values display “Data Pending” and never become zero. Observation dates and peak details remain available under “More details,” while the snapshot and CSV preserve collection timestamps and status metadata. All new calculations run in the browser against the same snapshot, with no new API calls, database work, dependencies, or history export.

For a visual-only rollback, revert the markup/script/style changes while preserving the latest `nf-payload` snapshot. Coordinate publication with an in-progress collection run: the existing atlas-change guard intentionally stops that run from overwriting a concurrent UI edit.

## Validation and approval-gated rollout

Local validation: festival collector/export/recovery tests, database writer tests, review and CCU client/worker tests, repository type checks/lint/build, and the static Tiger ingestion verifier. Tests inject transports and database clients; they do not collect from Steam or write production data. The collector without flags only prints a plan.

Before approval, compare the scoped patch against `output/steam-next-fest-2026-10/tiger-transition/before/`; the checkout contains substantial unrelated local work. Do not ship unrelated migrations or edits with this transition.

1. **Hold and drain the old generation.** With explicit approval, disable only the festival daily gate and resolve queued festival runs. Let any collector already executing finish and upload its final state. At audit, run `39548191481` was collecting reviews after its CCU archive completed, and `39555037953` was pending. Recheck these IDs before acting. Changing a variable or merging code does not replace the code of a queued/running run. Let old publication finish or explicitly cancel its publish stage before allowing the new publisher.
2. **Prepare the release with both festival gates off.** Deploy the scoped code through the normal process. Preserve the latest completed artifacts, all attempt reservations, and the latest published atlas. Do not change regular worker gates.
3. **Approve and apply only SQL 0118.** It expands one existing check and builds one partial unique index. Risk is medium: schema locks/index construction and subsequent ingestion load on the small Tiger instance. The table was about 2.5 GB at rollout, so build the index CONCURRENTLY first, outside a transaction, then change the check in a short transaction. It uses a 2-second lock limit, a 120-second concurrent-build limit, and a 30-second constraint statement limit. The initial 30-second concurrent attempt completed its first build phase but left an invalid index; transaction inspection found no blockers before the monitored retry. The check is added NOT VALID to avoid rescanning existing rows; new writes are still checked. Existing rows satisfied the narrower check. No data is deleted. A separately scheduled validation can follow. A failed concurrent build can leave an invalid index: stop, inspect, and remove only that invalid rollout index before retrying. The constraint transaction rolls back on failure; do not raise limits blindly.
4. **Approve writes, then enable `ENABLE_NEXT_FEST_TIGER_WRITES`.** Keep the daily collection gate off. Dispatch a new run with `mode=replay`, `batch_size=10`, `publish=false`: at most ten retained results per signal, zero Steam requests. Compare source counts/times and state acknowledgements. Read bounded DB health and regular-review telemetry before/after. This is production ingestion, so it requires explicit approval.
5. **Drain the retained backlog.** After canary acceptance, approve full replay with `mode=replay`, `batch_size=7218`, `publish=false`. Reviews remain capped at 3,609 replayed results per phase; repeat new runs until both phases report `pending=0`. This includes the one-time published-baseline import. Replay does not spend or reset request allowances. A collecting run with a remaining replay backlog stops before making new requests.
6. **Approve collection and publication.** Run an unpublished ten-demo collection canary (at most 40 HTTP attempts), retaining its journal. Then approve the full collecting/publishing run and daily `ENABLE_NEXT_FEST_COLLECTION` gate. Verify Tiger rows, export parity, preserved visualizations/CSV/“Data Pending,” the atlas-only commit, normal Vercel deployment, and bounded DB/job telemetry. Neither a successful static build nor this audit proves production performance.
7. Expiry continues to prevent collection after November 2 UTC. Disable both festival gates when retiring the temporary schedule.

Rollback: disable both festival gates, drain/archive active work, and restore the last good static atlas through normal publication. Keep Tiger observations, the additive snapshot schema, and all accounting artifacts. Do not delete history or restore the narrower source constraint over retained reviews. Reverting to the older collector also requires removing the newer `persisted` records from a **copy** of its input journal while preserving every attempt/result; its old parser rejects the new receipt kind. Prefer leaving collection stopped while fixing forward. Do not modify regular worker gates or revert the separately released review API migration.
