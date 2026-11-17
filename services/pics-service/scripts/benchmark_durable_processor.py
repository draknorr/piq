#!/usr/bin/env python3
"""Repeatable no-network benchmark for durable PICS processor orchestration."""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
import threading
import time
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

import gevent  # noqa: E402

from src.config.settings import settings  # noqa: E402
from src.database.durable_promotion import PICSPromotionResult  # noqa: E402
from src.database.durable_work import PICSLatestSnapshot, PICSWorkClaim  # noqa: E402
from src.database.tiger_change_history import ArchivePointer  # noqa: E402
from src.steam.request_scheduler import SteamRequestPolicy, SteamRequestScheduler  # noqa: E402
from src.workers.durable_processor import DurablePICSProcessor  # noqa: E402

PRIOR_SNAPSHOT = {"name": "Previous benchmark snapshot"}


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    index = max(0, math.ceil(len(ordered) * percentile) - 1)
    return ordered[index]


def _claim(index: int, lane: str) -> PICSWorkClaim:
    return PICSWorkClaim(
        id=index + 1,
        appid=1_000_000 + index,
        stream_key="benchmark-shadow",
        work_mode="shadow",
        lane=lane,
        priority=200 if lane == "live" else 100,
        claimed_through_change_number=20,
        attempts=1,
        max_attempts=8,
        claim_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        worker_id="benchmark-worker",
    )


def _payload(appid: int) -> dict[str, Any]:
    return {
        "appid": appid,
        "_change_number": 20,
        "_missing_token": False,
        "_sha": "a" * 40,
        "_size": 100,
        "common": {
            "name": f"Benchmark app {appid}",
            "type": "game",
            "category": {},
            "genres": {},
            "store_tags": {},
            "associations": {},
        },
        "extended": {"listofdlc": ""},
        "config": {},
        "depots": {},
    }


class SyntheticFetcher:
    def __init__(self, latency_seconds: float, time_scale: float):
        self._latency_seconds = latency_seconds
        self.last_product_info_attempts = 1
        self.scheduler = SteamRequestScheduler(
            SteamRequestPolicy(
                min_interval_seconds=0.5 * time_scale,
            )
        )

    def fetch_apps_batch(self, appids: list[int]) -> dict[int, dict[str, Any]]:
        assert len(appids) <= 200

        def request():
            gevent.sleep(self._latency_seconds)
            return {appid: _payload(appid) for appid in appids}

        return self.scheduler.execute("pics_product_info", request)


class SyntheticArchiveStore:
    def __init__(self, latency_seconds: float):
        self._latency_seconds = latency_seconds
        self._lock = threading.Lock()
        self._writes = 0

    def write_json(self, **_kwargs: Any) -> ArchivePointer:
        time.sleep(self._latency_seconds)
        with self._lock:
            self._writes += 1
            write_id = self._writes
        return ArchivePointer(
            bucket="benchmark",
            byte_size=100,
            content_hash="b" * 64,
            content_type="application/json",
            key=f"benchmark/{write_id}.json",
        )

    def read_json(self, **_kwargs: Any) -> dict[str, Any]:
        time.sleep(self._latency_seconds)
        return dict(PRIOR_SNAPSHOT)


class SyntheticWorkStore:
    def __init__(
        self,
        live_claims: list[PICSWorkClaim],
        catchup_claims: list[PICSWorkClaim],
        *,
        transaction_latency_seconds: float,
        warm: bool = False,
    ):
        self._warm = warm
        self._live_claims = live_claims
        self._catchup_claims = catchup_claims
        self._transaction_latency_seconds = transaction_latency_seconds
        self._lock = threading.Lock()
        self.heartbeat_calls = 0
        self.latest_lookup_calls = 0
        self.completed = 0

    def claim_work(self, **kwargs: Any) -> list[PICSWorkClaim]:
        time.sleep(self._transaction_latency_seconds)
        return (
            list(self._live_claims)
            if kwargs["lane_group"] == "live"
            else list(self._catchup_claims)
        )

    def heartbeat_claims(self, **kwargs: Any) -> int:
        time.sleep(self._transaction_latency_seconds)
        with self._lock:
            self.heartbeat_calls += 1
        return len(kwargs["claims"])

    def get_latest_snapshots(
        self,
        appids: list[int],
    ) -> dict[int, Any]:
        time.sleep(self._transaction_latency_seconds)
        with self._lock:
            self.latest_lookup_calls += 1
        if not self._warm:
            return {}
        return {
            appid: PICSLatestSnapshot(
                id=appid,
                content_hash="c" * 64,
                archive_bucket="benchmark",
                archive_key=f"prior/{appid}.json",
                archive_content_hash=DurablePICSProcessor._hash_json(PRIOR_SNAPSHOT),
            )
            for appid in appids
        }

    def complete_shadow_claim(self, **_kwargs: Any) -> str:
        time.sleep(self._transaction_latency_seconds)
        with self._lock:
            self.completed += 1
        return "completed"

    def block_claim(self, **_kwargs: Any) -> None:
        raise AssertionError("The synthetic payload should not source-block")

    def fail_claim(self, **_kwargs: Any) -> str:
        raise AssertionError("The synthetic payload should not fail")


class SyntheticPromoter:
    """Model one promotion transaction; no real SQL or product writes."""

    def __init__(self, latency_seconds: float, serialized_fraction: float):
        self._latency_seconds = latency_seconds
        self._serialized_fraction = serialized_fraction
        self._lock = threading.Lock()

    def promote(self, *, claim, **_kwargs):
        if self._serialized_fraction:
            with self._lock:
                time.sleep(self._latency_seconds * self._serialized_fraction)
        time.sleep(self._latency_seconds * (1 - self._serialized_fraction))
        return PICSPromotionResult(
            appid=claim.appid,
            snapshot_id=claim.appid,
            snapshot_changed=True,
            event_count=0,
            completed_through_change_number=claim.claimed_through_change_number,
            next_work_state="completed",
        )


def _run_sample(
    *,
    batch_size: int,
    live_reserve: int,
    workers: int,
    r2_latency_seconds: float,
    tiger_latency_seconds: float,
    steam_latency_seconds: float,
    warm_durable: bool = False,
    time_scale: float = 1.0,
    serialized_tiger_fraction: float = 0.0,
) -> dict[str, Any]:
    live_count = min(batch_size, live_reserve)
    catchup_count = batch_size - live_count
    live_claims = [_claim(index, "live") for index in range(live_count)]
    catchup_claims = [
        replace(_claim(live_count + index, "catchup"), priority=100)
        for index in range(catchup_count)
    ]
    if warm_durable:
        live_claims = [replace(c, stream_key="primary", work_mode="durable") for c in live_claims]
        catchup_claims = [
            replace(c, stream_key="primary", work_mode="durable") for c in catchup_claims
        ]
    work_store = SyntheticWorkStore(
        live_claims,
        catchup_claims,
        transaction_latency_seconds=tiger_latency_seconds * time_scale,
        warm=warm_durable,
    )
    archive_store = SyntheticArchiveStore(r2_latency_seconds * time_scale)
    settings.pics_consumer_live_batch_size = live_count
    settings.pics_consumer_catchup_batch_size = catchup_count
    settings.pics_consumer_concurrency = workers
    settings.pics_consumer_large_batches_enabled = batch_size > 200
    processor = DurablePICSProcessor(
        work_mode="durable" if warm_durable else "shadow",
        stream_key="primary" if warm_durable else "benchmark-shadow",
        work_store=work_store,
        promoter=(
            SyntheticPromoter(tiger_latency_seconds * time_scale, serialized_tiger_fraction)
            if warm_durable
            else None
        ),
        archive_store=archive_store,
        worker_id="benchmark-worker",
    )
    stats = processor.process_once(SyntheticFetcher(steam_latency_seconds * time_scale, time_scale))
    assert stats.completed == batch_size and stats.retried == stats.dead_lettered == 0
    return {
        "duration_seconds": stats.duration_seconds / time_scale,
        "stats": stats,
        "live_count": live_count,
        "catchup_count": catchup_count,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-sizes", default="50,75,100,150,200")
    parser.add_argument("--workers", default="1,4,8")
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--live-reserve", type=int, default=40)
    parser.add_argument("--r2-latency-ms", type=float, default=20.0)
    parser.add_argument("--tiger-latency-ms", type=float, default=20.0)
    parser.add_argument("--steam-latency-ms", type=float, default=20.0)
    parser.add_argument("--product-info-min-interval-seconds", type=float, default=215.0)
    parser.add_argument(
        "--catchup-open",
        type=int,
        default=257_000,
        help="Rounded queue size used only for illustrative drain projections",
    )
    parser.add_argument(
        "--warm-durable",
        action="store_true",
        help="Exercise prior archive verification and fake durable promotion",
    )
    parser.add_argument(
        "--time-scale",
        type=float,
        default=1.0,
        help="Scale injected waits, divide observed duration by this factor",
    )
    parser.add_argument(
        "--incoming-apps-per-hour",
        type=float,
        default=0,
        help="Conservative arrivals used for net live drain, not measured by this tool",
    )
    parser.add_argument("--live-open", type=int, default=0)
    parser.add_argument(
        "--serialized-tiger-fraction",
        type=float,
        default=0,
        help="Fraction of promotion time behind a shared lock (warm-durable only)",
    )
    args = parser.parse_args()
    if not 0 <= args.serialized_tiger_fraction <= 1:
        parser.error("serialized-tiger-fraction must be between 0 and 1")
    if args.serialized_tiger_fraction and not args.warm_durable:
        parser.error("serialized-tiger-fraction requires warm-durable")
    if not 0 < args.time_scale <= 1 or args.samples < 1:
        parser.error("time-scale must be in (0,1] and samples must be positive")
    if (
        min(
            args.r2_latency_ms,
            args.tiger_latency_ms,
            args.steam_latency_ms,
            args.incoming_apps_per_hour,
            args.live_open,
        )
        < 0
    ):
        parser.error("latencies and queue inputs cannot be negative")

    batch_sizes = [int(value) for value in args.batch_sizes.split(",")]
    worker_counts = [int(value) for value in args.workers.split(",")]
    original_settings = {
        "live": settings.pics_consumer_live_batch_size,
        "catchup": settings.pics_consumer_catchup_batch_size,
        "concurrency": settings.pics_consumer_concurrency,
        "large_batches": settings.pics_consumer_large_batches_enabled,
    }
    rows: list[dict[str, Any]] = []
    try:
        for workers in worker_counts:
            for batch_size in batch_sizes:
                samples = [
                    _run_sample(
                        batch_size=batch_size,
                        live_reserve=args.live_reserve,
                        workers=workers,
                        r2_latency_seconds=args.r2_latency_ms / 1000.0,
                        tiger_latency_seconds=args.tiger_latency_ms / 1000.0,
                        steam_latency_seconds=args.steam_latency_ms / 1000.0,
                        warm_durable=args.warm_durable,
                        time_scale=args.time_scale,
                        serialized_tiger_fraction=args.serialized_tiger_fraction,
                    )
                    for _sample in range(args.samples)
                ]
                durations = [sample["duration_seconds"] for sample in samples]
                representative = samples[-1]
                catchup_count = int(representative["catchup_count"])
                p50_duration = statistics.median(durations)
                p95_duration = _percentile(durations, 0.95)
                governed_cycle_seconds = max(
                    args.product_info_min_interval_seconds,
                    p95_duration,
                )
                governed_catchup_per_minute = catchup_count * 60.0 / governed_cycle_seconds
                drain_days = (
                    args.catchup_open / governed_catchup_per_minute / 1440.0
                    if governed_catchup_per_minute > 0
                    else None
                )
                stats = representative["stats"]
                live_per_hour = representative["live_count"] * 3600 / governed_cycle_seconds
                net_live_per_hour = live_per_hour - args.incoming_apps_per_hour
                rows.append(
                    {
                        "batch_size": batch_size,
                        "live_settlements_per_hour": round(live_per_hour, 2),
                        "net_live_drain_per_hour": round(net_live_per_hour, 2),
                        "projected_live_drain_hours": (
                            round(args.live_open / net_live_per_hour, 2)
                            if net_live_per_hour > 0
                            else None
                        ),
                        "r2_reads": stats.r2_reads,
                        "r2_writes": stats.r2_writes,
                        "product_info_requests": stats.product_info_requests,
                        "live": representative["live_count"],
                        "catchup": catchup_count,
                        "workers": workers,
                        "samples": args.samples,
                        "pass_p50_seconds": round(p50_duration, 3),
                        "pass_p95_seconds": round(p95_duration, 3),
                        "unthrottled_settlements_per_minute": round(
                            batch_size * 60.0 / p95_duration,
                            2,
                        ),
                        "governed_catchup_settlements_per_minute": round(
                            governed_catchup_per_minute,
                            2,
                        ),
                        "steam_calls_per_hour": round(
                            stats.product_info_requests * 3600.0 / governed_cycle_seconds,
                            2,
                        ),
                        "heartbeat_transactions": stats.heartbeat_transactions,
                        "tiger_transactions_per_settlement": (
                            stats.tiger_transactions_per_settlement
                        ),
                        "legacy_tiger_transactions_per_settlement_estimate": round(
                            (3 * batch_size + 4) / batch_size,
                            3,
                        ),
                        "legacy_heartbeat_row_updates_estimate": (
                            batch_size * 2 + batch_size * (batch_size + 1) // 2
                        ),
                        "candidate_heartbeat_row_updates": (
                            stats.heartbeat_transactions * batch_size
                        ),
                        "projected_catchup_drain_days": (
                            round(drain_days, 2) if drain_days is not None else None
                        ),
                        "disconnects_per_hour": None,
                        "lock_timeouts": None,
                        "phase_latency_seconds": stats.phase_latency_seconds,
                    }
                )
    finally:
        settings.pics_consumer_live_batch_size = original_settings["live"]
        settings.pics_consumer_catchup_batch_size = original_settings["catchup"]
        settings.pics_consumer_concurrency = original_settings["concurrency"]
        settings.pics_consumer_large_batches_enabled = original_settings["large_batches"]

    print(
        json.dumps(
            {
                "kind": "synthetic-no-network",
                "notes": [
                    "R2 and Tiger latencies are injected independently per app.",
                    "Steam calls/hour counts every <=200-app chunk and includes pass cadence.",
                    "Warm durable mode: fake SQL promotion, real validation and archive hashing.",
                    "Scaled durations include Python overhead; these are capacity estimates only.",
                    "Shared-lock time is injected; pool waits and workload overlap are unmodeled.",
                    "Net drain assumes completion removes an item; newer revisions may requeue it.",
                    "Disconnect and lock-timeout rates require a shadow/canary observation.",
                ],
                "inputs": {
                    "batch_sizes": batch_sizes,
                    "workers": worker_counts,
                    "samples": args.samples,
                    "live_reserve": args.live_reserve,
                    "r2_latency_ms": args.r2_latency_ms,
                    "tiger_latency_ms": args.tiger_latency_ms,
                    "steam_latency_ms": args.steam_latency_ms,
                    "product_info_min_interval_seconds": (args.product_info_min_interval_seconds),
                    "catchup_open": args.catchup_open,
                    "live_open": args.live_open,
                    "incoming_apps_per_hour": args.incoming_apps_per_hour,
                    "time_scale": args.time_scale,
                    "warm_durable": args.warm_durable,
                    "serialized_tiger_fraction": args.serialized_tiger_fraction,
                },
                "rows": rows,
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
