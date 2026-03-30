# Admin Dashboard Guide

This guide explains how to use the PublisherIQ admin dashboard to monitor system health, manage users, and review usage analytics.

> Access requires an authenticated admin user.

---

## Overview

The `/admin` dashboard currently focuses on:

- system health and sync status
- catalog control
- CCU quality and provenance
- PICS coverage
- queue health and recent jobs
- chat logs

---

## Status Bar

The top status bar shows six summary metrics:

| Metric | Description |
|--------|-------------|
| `Running` | Number of sync jobs currently running |
| `Jobs (24h)` | Total jobs run in the last 24 hours |
| `Success` | 7-day sync success rate |
| `Overdue` | Apps past their sync schedule |
| `Errors` | Apps with consecutive sync failures |
| `PICS` | Latest Steam change number processed |

---

## Data Completion

This section shows sync completion for the current catalog by source:

| Source | What It Represents |
|--------|--------------------|
| `SteamSpy` | Owner estimates, playtime, and related enrichment |
| `Storefront` | Core app metadata and pricing |
| `Reviews` | Review totals and sentiment |
| `Histogram` | Review timeline data |
| `PICS` | Tags, genres, categories, Steam Deck, and relationship data |

The dashboard uses the current catalog denominator rather than raw historical row counts.

---

## Catalog Control

This section exposes the live catalog control plane:

| Metric | Meaning |
|--------|---------|
| `Current Catalog` | Apps in the current live catalog |
| `Historical Retained` | Historical app rows retained beyond the live catalog |
| `Live Missing` | Apps present in the latest applist snapshot but missing from the current catalog denominator |
| `Stale Applist Jobs` | Running applist jobs older than the expected threshold |

It also shows the latest successful applist start and completion timestamps.

---

## CCU Quality

This section summarizes current-catalog CCU confidence and provenance:

| Metric | Meaning |
|--------|---------|
| `Tier Assigned` | Apps with a CCU tier assignment |
| `No Tier` | Apps without a tier assignment |
| `Confirmed +` | Latest CCU validation is confirmed positive |
| `Confirmed 0` | Latest CCU validation is confirmed zero |
| `Suspect 0` | Latest CCU validation is a suspicious zero |
| `Skipped` | Apps in the invalid-but-skipped state |
| `Invalid` | Apps currently marked invalid |
| `Unavailable` | Apps without a resolved confidence state |
| `Steam API` | Latest non-null CCU row came from Steam API |
| `SteamSpy` | Latest non-null CCU row came from SteamSpy |
| `Legacy Unknown` | Latest non-null CCU row has no provenance |

The cached stats include an `updated_at` timestamp and may fall back to approximate data if the live aggregation is unavailable.

---

## Sync Queue

The queue section shows:

| Metric | Meaning |
|--------|---------|
| `Overdue` | Apps past their sync deadline |
| `Due in 1h` | Apps due within the next hour |
| `Due in 6h` | Apps due within the next 6 hours |
| `Due in 24h` | Apps due within the next 24 hours |

The priority distribution groups apps into:

| Tier | Score Range | Sync Interval |
|------|-------------|---------------|
| `High` | 150+ | 6 hours |
| `Medium` | 100-149 | 12 hours |
| `Normal` | 50-99 | 24 hours |
| `Low` | 25-49 | 48 hours |
| `Minimal` | <25 | 7 days |

---

## PICS Service

This section shows the latest PICS change number and whether the data source is approximate or live.

Operational note:

- PICS history capture writes normalized snapshots and diff events before latest-state upserts
- a temporary history cooldown does not mean latest-state PICS sync has stopped

---

## Sync Errors

This section lists apps with consecutive sync failures.

Each row shows:

- app name and ID
- error count
- last failing source
- last error message
- last error timestamp

---

## Recent Jobs

This section shows the most recent sync jobs and lets you expand each job for details.

Key fields:

- status
- job type
- batch size
- items processed
- items succeeded
- items failed
- start and completion timestamps
- GitHub Actions run ID

---

## Chat Logs

This section surfaces recent chat queries for debugging. See the dedicated [Chat Logs guide](./chat-logs.md) for the field breakdown.

---

## User Management

The `/admin/users` page lets you:

- inspect user accounts
- search by email, name, or organization
- adjust credit balances
- review message and credit usage totals

Credit adjustments require a reason and support positive or negative changes.

---

## Waitlist Management

The `/admin/waitlist` page lets you:

- approve or reject access requests
- resend invites for approved users
- filter by pending, approved, and rejected states
- filter approved entries that still need an invite

---

## Usage Analytics

The `/admin/usage` page shows all-time totals plus recent windows for `7d`, `30d`, and `90d`.

It includes:

- total credits in system
- total credits used
- total messages
- activity in the selected window
- top users by credits used
- tool usage counts
