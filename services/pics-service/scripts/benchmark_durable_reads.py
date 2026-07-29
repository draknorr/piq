#!/usr/bin/env python3
"""Bounded read-only Tiger/R2 benchmark for durable PICS phases."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

import psycopg  # noqa: E402

from src.config.settings import settings  # noqa: E402
from src.database.durable_payload import validate_pics_product_payload  # noqa: E402
from src.database.durable_work import (  # noqa: E402
    PICSLatestSnapshot,
    TigerPICSDurableWorkStore,
)
from src.database.tiger_change_history import S3ArchiveStore  # noqa: E402
from src.extractors.common import PICSExtractor  # noqa: E402


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    index = max(0, math.ceil(len(ordered) * percentile) - 1)
    return ordered[index]


def _summary(values: list[float]) -> dict[str, float | int]:
    if not values:
        return {"count": 0, "total": 0.0, "p50": 0.0, "p95": 0.0, "max": 0.0}
    return {
        "count": len(values),
        "total": round(sum(values), 3),
        "p50": round(statistics.median(values), 3),
        "p95": round(_percentile(values, 0.95), 3),
        "max": round(max(values), 3),
    }


def _hash_json(value: Any) -> str:
    body = json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _read_one(
    archive_store: S3ArchiveStore,
    pointer: PICSLatestSnapshot,
) -> tuple[int, dict[str, Any], float]:
    started = time.perf_counter()
    payload = archive_store.read_json(
        bucket=pointer.archive_bucket,
        key=pointer.archive_key,
    )
    duration = time.perf_counter() - started
    actual_hash = _hash_json(payload)
    if actual_hash != pointer.archive_content_hash:
        raise RuntimeError(
            f"R2 hash mismatch for snapshot {pointer.id}: "
            f"expected {pointer.archive_content_hash}, got {actual_hash}"
        )
    return pointer.id, payload, duration


def _readonly_connection_factory(database_url: str) -> Callable[[], Any]:
    return lambda: psycopg.connect(
        database_url,
        application_name="publisheriq-pics-readonly-benchmark",
        options="-c default_transaction_read_only=on",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--confirm-read-only-production", action="store_true")
    parser.add_argument("--batch-sizes", default="50,75,100,150,200")
    parser.add_argument("--r2-workers", type=int, default=4)
    parser.add_argument("--pointer-iterations", type=int, default=3)
    args = parser.parse_args()
    if not args.confirm_read_only_production:
        raise SystemExit("Pass --confirm-read-only-production to run bounded SELECT/R2 GETs")

    batch_sizes = [int(value) for value in args.batch_sizes.split(",")]
    max_batch_size = max(batch_sizes)
    if max_batch_size > 200 or min(batch_sizes) <= 0:
        raise SystemExit("Batch sizes must be between 1 and 200")
    if not 1 <= args.r2_workers <= 8:
        raise SystemExit("R2 workers must be between 1 and 8")

    database_url = settings.pics_intake_tiger_url or settings.tiger_primary_url
    if not database_url:
        raise SystemExit("PICS_INTAKE_TIGER_URL or TIGER_PRIMARY_URL is required")
    connection_factory = _readonly_connection_factory(database_url)
    with connection_factory() as connection:
        with connection.transaction():
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION READ ONLY")
                cursor.execute("SET LOCAL statement_timeout = '30s'")
                cursor.execute(
                    """
                    SELECT DISTINCT ON (snapshot.appid)
                      snapshot.appid
                    FROM docs.app_source_snapshots snapshot
                    WHERE snapshot.source = 'pics'
                      AND snapshot.archive_bucket IS NOT NULL
                      AND snapshot.archive_key IS NOT NULL
                      AND snapshot.archive_content_hash IS NOT NULL
                    ORDER BY snapshot.appid, snapshot.first_seen_at DESC, snapshot.id DESC
                    LIMIT %s
                    """,
                    (max_batch_size,),
                )
                appids = [int(row[0]) for row in cursor.fetchall()]
    if len(appids) < max_batch_size:
        raise RuntimeError(
            f"Only {len(appids)} archived PICS appids were available; " f"{max_batch_size} required"
        )

    work_store = TigerPICSDurableWorkStore(
        database_url,
        connection_factory=connection_factory,
    )
    pointer_rows: list[dict[str, Any]] = []
    all_pointers: dict[int, PICSLatestSnapshot] = {}
    for batch_size in batch_sizes:
        durations: list[float] = []
        pointers: dict[int, PICSLatestSnapshot] = {}
        for _iteration in range(args.pointer_iterations):
            started = time.perf_counter()
            pointers = work_store.get_latest_snapshots(appids[:batch_size])
            durations.append(time.perf_counter() - started)
        all_pointers.update(pointers)
        pointer_rows.append(
            {
                "batch_size": batch_size,
                "returned": len(pointers),
                "iterations": args.pointer_iterations,
                "latency_seconds": _summary(durations),
            }
        )

    per_app_durations: list[float] = []
    for appid in appids[:50]:
        started = time.perf_counter()
        work_store.get_latest_snapshot(appid)
        per_app_durations.append(time.perf_counter() - started)

    archive_store = S3ArchiveStore.from_env()
    r2_rows: list[dict[str, Any]] = []
    payloads: dict[int, dict[str, Any]] = {}
    for batch_size in batch_sizes:
        selected = [all_pointers[appid] for appid in appids[:batch_size]]
        wall_started = time.perf_counter()
        latencies: list[float] = []
        with ThreadPoolExecutor(max_workers=args.r2_workers) as executor:
            futures = [executor.submit(_read_one, archive_store, pointer) for pointer in selected]
            for future in as_completed(futures):
                snapshot_id, payload, duration = future.result()
                payloads[snapshot_id] = payload
                latencies.append(duration)
        wall_duration = time.perf_counter() - wall_started
        r2_rows.append(
            {
                "batch_size": batch_size,
                "workers": args.r2_workers,
                "wall_seconds": round(wall_duration, 3),
                "objects_per_second": round(batch_size / wall_duration, 2),
                "latency_seconds": _summary(latencies),
            }
        )

    extractor = PICSExtractor()
    validation_latencies: list[float] = []
    validated = 0
    for archive_document in payloads.values():
        raw_payload = archive_document.get("_raw_payload")
        if not isinstance(raw_payload, dict):
            continue
        appid = int(raw_payload.get("appid") or archive_document["appid"])
        started = time.perf_counter()
        validate_pics_product_payload(
            appid=appid,
            claimed_through_change_number=0,
            raw_payload=raw_payload,
            previous_snapshot=archive_document,
            extractor=extractor,
        )
        validation_latencies.append(time.perf_counter() - started)
        validated += 1

    print(
        json.dumps(
            {
                "kind": "bounded-read-only-production",
                "batch_sizes": batch_sizes,
                "pointer_batch_reads": pointer_rows,
                "legacy_50_per_app_pointer_reads": {
                    "wall_seconds": round(sum(per_app_durations), 3),
                    "latency_seconds": _summary(per_app_durations),
                },
                "r2_reads": r2_rows,
                "validation_extraction": {
                    "validated": validated,
                    "latency_seconds": _summary(validation_latencies),
                },
                "writes": 0,
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
