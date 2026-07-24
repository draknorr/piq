# Legacy PICS Restart Incident

Captured on July 24, 2026 UTC. All counts are timestamped observations, not
permanent thresholds.

## Summary

Merging PR #39 at commit `58275043974eab3655e44f100d006a42722cc153`
triggered Railway GitHub autodeploy for
`enthusiastic-caring / production / publisheriq`. That service was the legacy
in-memory PICS `change_monitor` and had been stalled since June 16.

The new deployment `9795262a-9b7a-40f9-be53-cb1aec4ca308` started at
`2026-07-24T02:42:56Z`. It loaded Tiger cursor `36,631,816`, then its first
poll advanced to `37,491,075` while logging `0 apps changed, 0 queued`.
The unreconciled cursor interval is therefore 859,259 change numbers.

This is the failure mode identified in the preparation plan: the legacy worker
advances `ops.pics_sync_state` before its in-memory work is durably recorded.
The first poll did not durably record source app IDs for the skipped interval.

## Observed Writes Before Containment

At `2026-07-24T02:50:18Z`, bounded Tiger reads for rows created since
`2026-07-24T02:42:00Z` showed:

- 36 `docs.app_source_snapshots` rows across 35 apps
- 49 `events.app_change_events` rows across 17 apps
- 41 `ops.sync_status` rows with a new `last_pics_sync`
- PICS trigger cursors from `37,491,085` through `37,491,186`

These rows are retained for reconciliation. No production database rows were
deleted or repaired during containment.

## Containment

After explicit approval:

1. Railway removed the active `publisheriq` deployment.
2. `/status` returned HTTP 404.
3. The final Tiger cursor was `37,491,237`, updated at
   `2026-07-24T02:52:52.69384Z`.
4. Railway disconnected the service from its GitHub source. The confirmed
   service state was `source: null`, `deploymentStopped: true`, and zero running
   replicas.
5. Later Tiger observations at `2026-07-24T02:59:29Z` and
   `2026-07-24T03:09:52Z` found the cursor unchanged.

The service, variables, and domain remain present so recovery is possible.
Reconnecting or redeploying the legacy monitor is prohibited until durable
intake exists and receives a separate cutover approval.

## Verified Client Protocol Limitation

The repository's locked ValvePython `steam` client resolves to version `1.4.4`.
Its inspected `SteamClient.get_changes_since` signature is:

```text
(self, change_number, app_changes=True, package_changes=False)
```

There is no ending-cursor request parameter. The response descriptor does,
however, expose `current_change_number`, `since_change_number`,
`force_full_update`, `force_full_app_update`, and
`force_full_package_update`. Each app entry exposes `appid`, `change_number`,
and `needs_token`.

The durable design must therefore preserve those response and item fields,
fail closed on an echoed-cursor mismatch or app/global force-full response, and
derive any bounded comparison from persisted item change numbers. A request
from the June cursor cannot by itself prove that Steam retained the entire
missing interval.

## Live retention probe

At `2026-07-24T06:42:05Z`, an anonymous read-only
`get_changes_since(36,631,816)` request returned:

```json
{
  "requested_since": 36631816,
  "response_since": 36631816,
  "current_change_number": 37494739,
  "cursor_delta": 862923,
  "source_app_count": 0,
  "distinct_app_count": 0,
  "force_full_update": false,
  "force_full_app_update": true,
  "force_full_package_update": true,
  "app_changes_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
}
```

No Tiger write occurred during this probe. Steam explicitly requires a full
app refresh and returned no retained incremental app entries for the frozen
cursor. The durable intake must record such a response as `source_blocked`
without creating work or advancing either cursor. The missing June interval
cannot be reconstructed from the live PICS changes-since endpoint.

The separately approved durable shadow capture subsequently proved that
behavior in production Tiger. It retained one `source_blocked` parent row,
created no downstream work, and left the canonical cursor unchanged. See
[`durable-pics-shadow-capture.md`](./durable-pics-shadow-capture.md).

## Required Reconciliation

- Independently reconstruct or bound the source app IDs for
  `(36,631,816, 37,491,075]` from retained archives, downstream writes, and
  full-state reconciliation; the live PICS changes-since endpoint can no
  longer recover them.
- Audit relationship changes for the 41 apps processed after restart because
  the legacy writer does not carry complete-source evidence.
- Verify retained Tiger event/snapshot rows against their R2 archive hashes.
- Use the frozen `37,491,237` cursor only as incident evidence, not as proof
  that the skipped interval was processed.
