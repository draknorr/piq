# Durable PICS Historical Shadow Capture

Captured and verified on July 24, 2026 UTC. This record covers one approved,
fail-closed Tiger shadow write for the unrecoverable June PICS interval. It did
not deploy or restart either Railway service, create app work, update readiness,
or advance the canonical PICS cursor.

## Approved operation

- Tiger stream: `shadow-2026-07-june-gap-force-full`.
- Work mode and lane: `shadow` / `catchup`.
- Requested source cursor: `36,631,816`.
- Source: exactly one anonymous Steam `get_changes_since` response.
- Allowed write: exactly one `ops.pics_change_batches` parent row with status
  `source_blocked`.
- Required absence of writes: no batch-app, work-state, readiness, or canonical
  cursor changes.
- Risk presented: low.
- Rollback presented: delete the uniquely named shadow parent row only, under a
  separate destructive-write approval; otherwise leave the immutable evidence
  retained.
- Explicit approval: after the exact limits, risk, and rollback were presented,
  the user replied `wyes`, which was confirmed in the task as approval before
  execution.

The operation was required to abort before opening Tiger unless all of these
source conditions held:

1. the response echoed `36,631,816`;
2. the current source cursor was greater than the requested cursor;
3. the response contained zero app IDs;
4. `force_full_update` was false;
5. `force_full_app_update` was true; and
6. `force_full_package_update` was true.

Supabase was not inspected or changed because this is a Tiger-only product
data-plane operation.

## Failed pre-write attempt

The first execution attempt fetched and validated the same Steam response
shape but stopped before initializing `TigerPICSDurableIntakeStore` because
`TIGER_PRIMARY_URL` had been sourced without being exported to the Python
child process. It raised `KeyError: 'TIGER_PRIMARY_URL'`.

No database connection or write was opened by that attempt. The retry changed
only shell export behavior; it did not weaken or change any approved source
precondition.

## Successful source response

All fail-closed preconditions passed on the retry:

```json
{
  "requested_since": 36631816,
  "response_since": 36631816,
  "current_change_number": 37494854,
  "source_app_count": 0,
  "force_full_update": false,
  "force_full_app_update": true,
  "force_full_package_update": true
}
```

Steam again returned no retained incremental app IDs and required a full app
refresh. The response is therefore incomplete for incremental replay and was
not eligible to create work or advance a cursor.

## Persisted evidence

Tiger committed exactly one parent row at
`2026-07-24T06:45:48.166705Z`:

```text
id=39f5d4e0-ae17-44b2-9428-b5bb9bb35a99
stream_key=shadow-2026-07-june-gap-force-full
work_mode=shadow
lane=catchup
from_change_number=36631816
to_change_number=37494854
response_since_change_number=36631816
source_app_count=0
distinct_app_count=0
durable_app_count=0
app_changes_sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
force_full_update=false
force_full_app_update=true
force_full_package_update=true
source_complete=false
status=source_blocked
primary_cursor_advanced=false
```

Post-commit bounded reads verified:

| Check                                              |     Result |
| -------------------------------------------------- | ---------: |
| Total `ops.pics_change_batches` rows               |          1 |
| Shadow batch rows                                  |          1 |
| Total `ops.pics_change_batch_apps` rows            |          0 |
| Batch-app rows for the shadow batch                |          0 |
| Total `ops.pics_work_state` rows                   |          0 |
| Work rows for the shadow stream                    |          0 |
| Total `ops.app_data_readiness` rows                |          0 |
| Canonical `ops.pics_sync_state.last_change_number` | 37,491,237 |

The canonical cursor timestamp remained exactly
`2026-07-24 02:52:52.69384+00`.

Both distinct Railway services named `publisheriq` remained stopped:

- genuine legacy PICS
  `e6c49263-8466-4cb5-a37f-16299aae499e`: `stopped=true`,
  deployment status `FAILED`;
- accidental Query API duplicate
  `455d7fca-96a3-44f9-b5f0-5e6dca1c093f`: `stopped=true`,
  deployment status `FAILED`.

## Conclusion

The durable intake correctly retained an incomplete upstream response as
`source_blocked` without converting it into processing work or cursor
progress. The missing June interval cannot be reconstructed from Steam's live
changes-since endpoint. Historical reconciliation must use retained archives,
bounded downstream writes, and a full-state comparison.
