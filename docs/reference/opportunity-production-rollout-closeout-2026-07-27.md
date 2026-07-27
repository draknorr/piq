# Opportunity production rollout closeout — July 27, 2026

This note records the production state of the Custom Daily Steam Opportunity
Brief after the explicitly approved rollout. It separates completed rollout
evidence from acceptance checks that still require a real result or external
delivery targets.

## Change and deployment ledger

| Change                                | Evidence                                          |
| ------------------------------------- | ------------------------------------------------- |
| Feature implementation                | PR #86, merged                                    |
| Bootstrap SQL parameter repair        | PR #87, merge `a5d3716`                           |
| Material-event queue parameter repair | PR #88, merge `d7f575d`                           |
| Lease-safe bounded materialization    | PR #89, merge `e33b22b`                           |
| Opportunity worker deployment         | `d5a0079d-1747-47df-a60c-d42e957ea6ca`, `SUCCESS` |
| Query API deployment                  | `389505f1-8302-47fc-8501-a58a0e113d1c`, `SUCCESS` |
| Query API health                      | Tiger-backed `/healthz` returned `{"ok":true}`    |
| Worker topology                       | one production replica                            |

The worker and query API deployments both identify merge `e33b22b`. The
previous successful deployments remained available while Railway built and
started the replacements.

## Applied production state

- `0097_opportunity_mvp.sql` and `0098_opportunity_preset_seed.sql` are applied.
- Workspace:
  `f80bdd3a-7185-4f00-a9ee-48b80439acb1`
- Profile:
  `a77e184d-8215-4558-b815-f79123776fc4`
- Profile source: Roguelike Deckbuilder preset
- Profile state: enabled
- Timezone and cadence: `America/Los_Angeles`, 09:00 local
- Immediate full match: disabled
- External channel preferences: 0
- Deliveries in any state: 0

Authenticated production smoke completed bootstrap, preset clone/profile
creation, preview, enable, pause, resume, and two successful daily run records.
Both daily runs preceded material-event recovery and correctly produced zero
results. They do not prove a canonical non-empty daily result.

## Material-event recovery

The first production worker exposed PostgreSQL parameter inference failures.
PR #88 added explicit target casts. Work item 495 then committed 2,853 material
events with 2,853 distinct fingerprints and advanced the cursor, proving the
repair.

That batch also exposed a lease mismatch:

- claimed: `2026-07-27T20:19:27.870514Z`
- completed: `2026-07-27T20:36:45.225481Z`
- elapsed: `17m17.354967s`
- queue lease: `5m`
- expired before commit: `12m17.354967s`

PR #89 bounded each pass to 100 catalog, 100 lifecycle, and 500 raw source
rows, added a progress heartbeat every 50 moments, and limited one worker pass
to one global materialization trigger.

Post-deploy read-only evidence:

| Pass   | Queue item |       Duration | Cursor movement                      | Events |    Uniqueness |
| ------ | ---------: | -------------: | ------------------------------------ | -----: | ------------: |
| First  |          1 | `2m21.098803s` | catalog +18, lifecycle +23, raw +500 |   +350 | 5,900 / 5,900 |
| Second |          5 | `2m18.639550s` | raw +500                             |   +323 | 6,223 / 6,223 |

During both passes, `heartbeat_at` advanced and `claim_expires_at` returned to
nearly five minutes. The worker claimed one new materialization row at a time.
Cursor and event counts remained unchanged while each transaction was open,
then advanced atomically at commit.

Completed rows retain historical error fields from earlier attempts. Their
`completed` state and completion timestamp are authoritative.

## Validation ledger

The production merge and closeout retained:

- GitHub CI build, typecheck, tests, browser smoke, and lint: green
- Vercel deployment check: green
- repository `pnpm build`: 10/10 tasks
- repository `pnpm check-types`: 13/13 tasks
- repository `pnpm test`: 10/10 tasks
- repository `pnpm lint`: zero errors; existing warnings remain
- data-plane: 154/154 tests
- query API: 24/24 tests
- change-intelligence: 46/46 tests
- PICS Python 3.11: 130/130 tests
- Playwright: 5/5 tests
- strict Supabase writer audit: zero scheduled blockers
- live Tiger ingestion verification: all core source/freshness checks passed

The live verifier still reports the pre-existing empty
`ops.alert_detection_state` freshness warning, an unregistered
`ccu-demo-tiered-sync.yml` static warning, and optional Railway-variable checks
when not requested. These are not opportunity rollout failures.

## Remaining acceptance evidence

The MVP implementation is deployed, but an unqualified production-complete
claim requires:

1. the materialization cursor to reach current source time;
2. a non-empty daily result for the smoke identity;
3. track, dismiss, ignore, restore, viewed, and researching actions against
   that real result;
4. a live delayed-readiness/reappearance example;
5. a verified Resend API key and from address plus an explicitly designated
   test email recipient;
6. an explicitly designated Slack incoming webhook;
7. one email and one Slack summary containing canonical result links; and
8. a duplicate dispatch attempt proving the persisted idempotency outcome.

No external destination should be invented or inferred. Delivery remains
unconfigured until the user provides or designates those targets.

## Rollback

Routine rollback is reversible service cutback:

1. redeploy the worker and query API from `d7f575d`;
2. leave the additive opportunity schema, cursor, events, runs, results, and
   audit evidence intact;
3. inspect active claims and delivery rows read only; and
4. let any interrupted materialization transaction roll back so its unchanged
   cursor range is replayed.

Dropping the schema, deleting queue rows, or rewriting production evidence is
not part of routine rollback and requires a separate destructive-change
review.
