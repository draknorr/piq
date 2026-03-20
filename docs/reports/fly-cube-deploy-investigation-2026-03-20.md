# Fly Cube Deploy Investigation

Date: March 20, 2026

## Summary

`publisheriq-cube` had two separate issues at the same time:

1. The recent company-query Cube model changes never reached production, so live Cube `/meta` was missing the new company-game fields.
2. New manual deploy attempts were failing in Fly's remote builder path when using `flyctl v0.4.25`.

The live Cube runtime itself was healthy during the investigation. The Fly Doctor "not listening on the expected port" warning came from a stopped secondary machine, not from a persistent app startup failure.

## Scope

- App: `publisheriq-cube`
- Builder app: `fly-builder-shy-breeze-2800`
- Primary package: `packages/cube`
- Investigation source of truth:
  - live Fly app status
  - live Fly builder logs
  - live Cube `/meta`
  - git history for the relevant Cube/chat changes

## Key Findings

### 1. Cube deploys are manual, not GitHub-driven

- There is no GitHub Actions workflow in `.github/workflows` that deploys `publisheriq-cube`.
- `packages/cube/package.json` has no deploy script.
- Local shell history shows the original setup and deploy flow was `fly launch` and `fly deploy` from `packages/cube`.
- Fly release history attributes releases to `ryanbohmann@gmail.com`, consistent with manual `flyctl` deploys.

### 2. Production schema was stale

Relevant repo commits landed on March 19, 2026:

- `ab35ed8` at `2026-03-19T16:18:12-07:00` `Improve chat game lookups and filtered discovery`
- `ab6bad1` at `2026-03-19T20:48:05-07:00` `Improve company query resolution`
- `42f55a5` at `2026-03-19T21:02:15-07:00` `Fix company game cube field sanitization`

Live Cube `/meta` still reported these fields as missing:

- `DeveloperGameMetrics.reviewPercentage`
- `DeveloperGameMetrics.positiveReviews`
- `PublisherGameMetrics.reviewPercentage`
- `PublisherGameMetrics.positiveReviews`

That confirms the app code and Cube schema drifted out of sync. The chat layer expected fields that the deployed Cube instance did not expose.

### 3. The live Cube runtime was healthy

Observed production state during the incident:

- App image: `publisheriq-cube:deployment-01KM46SJY1Q9SD7B3RZVWYP8P2`
- Current release: `v40`
- One machine was started and healthy on `/readyz`
- A second machine was stopped with a warning because it had been intentionally stopped by the Fly proxy

Stopped machine event sequence:

- `2026-03-19T21:45:14-07:00` started
- `2026-03-19T21:50:35-07:00` cordon by proxy
- `2026-03-19T21:50:45-07:00` proxy requested stop
- `2026-03-19T21:50:47-07:00` clean exit `exit_code=0`
- `2026-03-19T21:50:48-07:00` uncordon while still stopped

This explains the Fly Doctor warning. It did not match a crash loop or a port binding failure in the active machine.

### 4. The deploy failure is in the Fly remote builder path

The same remote builder produced different results depending on the `flyctl` version:

#### `flyctl v0.4.0`

`flyctl deploy --remote-only --depot=false --build-only` succeeded.

It reached Docker build execution and produced:

- image tag `registry.fly.io/publisheriq-cube:deployment-01KM4SP21F5YNVJHNMMZ9KBSAP`

#### `flyctl v0.4.25`

The same command failed before build execution completed.

CLI errors:

- `Failed to start remote builder heartbeat: parse "http://fdaa:...:8080/flyio/v1/extendDeadline": invalid port ... after host`
- `failed to dial gRPC: ... unable to upgrade to h2c, received 500`

Builder logs at the same time showed:

- `GET /flyio/v1/extendDeadline` succeeded with user agent `flyctl/0.4.25`
- `POST /grpc` returned `500`
- `Handler for POST /grpc returned error: no upgrade proto in request`

That isolates the current blocker to Fly deploy tooling or builder transport compatibility, not the Cube app image itself.

## Root Cause

Primary root cause:

- The recent Cube model changes were merged locally but never successfully deployed to Fly production.

Secondary root cause:

- Current manual deploy attempts with `flyctl v0.4.25` fail in the remote builder path, which prevented the missed rollout from being corrected.

Non-root-cause symptom:

- The Fly Doctor port warning was caused by a stopped secondary machine and is not sufficient evidence of an application listener failure.

## Evidence Snapshot

- `publisheriq-cube` release history: `v40` current, prior releases from January 2026
- live image unchanged during investigation: `deployment-01KM46SJY1Q9SD7B3RZVWYP8P2`
- live `/meta` missing four expected company-game fields
- `flyctl v0.4.0` remote build-only succeeds
- `flyctl v0.4.25` remote build-only fails against the same builder app
- builder app logs show `/grpc` upgrade failure for `flyctl/0.4.25`

## Operational Guidance

Current safe path to restore deployability:

1. Use a pinned older CLI that successfully completes the remote build path, currently `flyctl v0.4.0`.
2. Or use `flyctl deploy --local-only` from `packages/cube` if local Docker is available.
3. After any Cube deploy, verify live `/meta` before trusting the rollout.

Do not treat Fly Doctor's generic port warning as the primary diagnosis until it matches:

- failing `/readyz`
- repeated start/exit loops
- or missing listeners in active machine logs

## Verification Commands

Use [scripts/ops/check-fly-cube.sh](../../scripts/ops/check-fly-cube.sh) to collect:

- active `flyctl` version
- app status
- machine list
- health checks
- builder logs tail
- live Cube `/meta` field presence

For manual deploy-path comparison, the two commands that proved the regression were:

```bash
cd packages/cube
FLY_ACCESS_TOKEN=... /tmp/flyctl-0.4.0/bin/flyctl deploy --app publisheriq-cube --config fly.toml --remote-only --depot=false --build-only
FLY_ACCESS_TOKEN=... flyctl deploy --app publisheriq-cube --config fly.toml --remote-only --depot=false --build-only
```

## Follow-Up

- Redeploy `packages/cube` with a working deploy path.
- Verify the four missing company-game fields appear in live `/meta`.
- Re-run the failing FromSoftware company-game query and confirm the first-pass Cube 400 is gone.
- Keep a pinned-working `flyctl` fallback documented until Fly resolves the `v0.4.25` remote builder regression.
