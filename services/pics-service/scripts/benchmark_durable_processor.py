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

from src.config.settings import settings  # noqa: E402
from src.database.durable_work import PICSWorkClaim  # noqa: E402
from src.database.tiger_change_history import ArchivePointer  # noqa: E402
from src.workers.durable_processor import DurablePICSProcessor  # noqa: E402


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
    def __init__(self, latency_seconds: float):
        self._latency_seconds = latency_seconds
        self.last_product_info_attempts = 1

    def fetch_apps_batch(self, appids: list[int]) -> dict[int, dict[str, Any]]:
        time.sleep(self._latency_seconds)
        return {appid: _payload(appid) for appid in appids}


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
        raise AssertionError("The synthetic benchmark starts without prior snapshots")


class SyntheticWorkStore:
    def __init__(
        self,
        live_claims: list[PICSWorkClaim],
        catchup_claims: list[PICSWorkClaim],
        *,
        transaction_latency_seconds: float,
    ):
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
        return {}

    def complete_shadow_claim(self, **_kwargs: Any) -> str:
        time.sleep(self._transaction_latency_seconds)
        with self._lock:
            self.completed += 1
        return "completed"

    def block_claim(self, **_kwargs: Any) -> None:
        raise AssertionError("The synthetic payload should not source-block")

    def fail_claim(self, **_kwargs: Any) -> str:
        raise AssertionError("The synthetic payload should not fail")


def _run_sample(
    *,
    batch_size: int,
    live_reserve: int,
    workers: int,
    r2_latency_seconds: float,
    tiger_latency_seconds: float,
    steam_latency_seconds: float,
) -> dict[str, Any]:
    live_count = min(batch_size, live_reserve)
    catchup_count = batch_size - live_count
    live_claims = [_claim(index, "live") for index in range(live_count)]
    catchup_claims = [
        replace(_claim(live_count + index, "catchup"), priority=100)
        for index in range(catchup_count)
    ]
    work_store = SyntheticWorkStore(
        live_claims,
        catchup_claims,
        transaction_latency_seconds=tiger_latency_seconds,
    )
    archive_store = SyntheticArchiveStore(r2_latency_seconds)
    settings.pics_consumer_live_batch_size = live_count
    settings.pics_consumer_catchup_batch_size = catchup_count
    settings.pics_consumer_concurrency = workers
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="benchmark-shadow",
        work_store=work_store,
        archive_store=archive_store,
        worker_id="benchmark-worker",
    )
    stats = processor.process_once(SyntheticFetcher(steam_latency_seconds))
    return {
        "duration_seconds": stats.duration_seconds,
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
    parser.add_argument("--catchup-open", type=int, default=256_875)
    args = parser.parse_args()

    batch_sizes = [int(value) for value in args.batch_sizes.split(",")]
    worker_counts = [int(value) for value in args.workers.split(",")]
    original_settings = {
        "live": settings.pics_consumer_live_batch_size,
        "catchup": settings.pics_consumer_catchup_batch_size,
        "concurrency": settings.pics_consumer_concurrency,
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
                rows.append(
                    {
                        "batch_size": batch_size,
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
                            3600.0 / governed_cycle_seconds,
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

    print(
        json.dumps(
            {
                "kind": "synthetic-no-network",
                "notes": [
                    "R2 and Tiger latencies are injected independently per app.",
                    "Steam calls/hour includes the 215-second candidate cadence guard.",
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
                },
                "rows": rows,
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
