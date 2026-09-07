#!/usr/bin/env python3
"""Verify two retained PICS batch archives using bounded SELECTs and R2 GETs only.

This tool cannot prepare, activate, enqueue, replay or otherwise write to Tiger/R2.
Run it again immediately before a separately approved successor activation.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

SERVICE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVICE_ROOT))

import psycopg  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

from src.config.settings import settings  # noqa: E402
from src.database.durable_intake import PICSSourceAppChange, hash_pics_app_changes  # noqa: E402
from src.database.tiger_change_history import S3ArchiveStore  # noqa: E402

MAX_SOURCE_ITEMS = 100_000
MAX_ARCHIVE_BYTES = 32 * 1024 * 1024


def verify_batch_document(
    batch: dict[str, Any], document: dict[str, Any], children: list[dict[str, Any]]
) -> dict[str, Any]:
    """Verify flags and every source position, including duplicates/token bits."""
    if document.get("_archive_schema_version") != "pics-change-response/v2":
        raise ValueError("Unsupported change-response archive schema")
    for key in (
        "stream_key",
        "work_mode",
        "lane",
        "from_change_number",
        "to_change_number",
        "response_since_change_number",
        "source_app_count",
        "distinct_app_count",
        "app_changes_sha256",
        "force_full_update",
        "force_full_app_update",
        "force_full_package_update",
    ):
        if (
            key not in document
            or type(document[key]) is not type(batch[key])  # noqa: E721 - strict JSON types
            or document[key] != batch[key]
        ):
            raise ValueError(f"Archive field differs from retained batch: {key}")
    changes = document.get("app_changes")
    if not isinstance(changes, list) or len(changes) != batch["source_app_count"]:
        raise ValueError("Archive source count mismatch")
    if len(changes) != len(children) or len(changes) != batch["durable_app_count"]:
        raise ValueError("Durable child count mismatch")
    parsed = []
    for index, (change, child) in enumerate(zip(changes, children)):
        if not isinstance(change, dict):
            raise ValueError("Malformed source item")
        expected = dict(
            source_index=child["source_index"],
            appid=child["appid"],
            change_number=child["source_change_number"],
            needs_token=child["needs_token"],
        )
        if change != expected or change.get("source_index") != index:
            raise ValueError("Archive source position differs from durable child")
        if any(
            not isinstance(change.get(key), int) or isinstance(change.get(key), bool)
            for key in ("source_index", "appid", "change_number")
        ):
            raise ValueError("Source integer fields must be exact integers")
        if (
            not isinstance(change.get("needs_token"), bool)
            or change["appid"] <= 0
            or change["change_number"] < 0
        ):
            raise ValueError("Invalid source identity, watermark or token bit")
        parsed.append(
            PICSSourceAppChange(
                appid=change["appid"],
                change_number=change["change_number"],
                needs_token=change["needs_token"],
            )
        )
    digest = hash_pics_app_changes(parsed)
    if (
        digest != batch["app_changes_sha256"]
        or len({item.appid for item in parsed}) != batch["distinct_app_count"]
    ):
        raise ValueError("Source manifest hash or distinct count mismatch")
    return dict(
        batchId=str(batch["id"]),
        archiveHash=batch["archive_content_hash"],
        manifestSha256=digest,
        count=len(parsed),
        verified=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gap-batch-id", required=True, type=UUID)
    parser.add_argument("--head-batch-id", required=True, type=UUID)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    database_url = settings.pics_intake_tiger_url or settings.tiger_primary_url
    if not database_url:
        raise SystemExit("PICS_INTAKE_TIGER_URL or TIGER_PRIMARY_URL is required")
    batches = {}
    with psycopg.connect(
        database_url,
        application_name="publisheriq-pics-successor-readonly",
        connect_timeout=10,
        row_factory=dict_row,
        options=(
            "-c default_transaction_read_only=on " "-c statement_timeout=12000 -c lock_timeout=1000"
        ),
    ) as db:
        with db.transaction():
            db.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            for label, batch_id in (("gap", args.gap_batch_id), ("head", args.head_batch_id)):
                batch = db.execute(
                    "SELECT * FROM ops.pics_change_batches WHERE id=%s LIMIT 1", (batch_id,)
                ).fetchone()
                if batch is None:
                    raise ValueError(f"Missing {label} batch")
                if not 0 <= batch["source_app_count"] <= MAX_SOURCE_ITEMS:
                    raise ValueError("Batch exceeds bounded verification item cap")
                if (
                    not batch["archive_content_hash"]
                    or not 0 <= batch["archive_byte_size"] <= MAX_ARCHIVE_BYTES
                ):
                    raise ValueError("Archive missing or exceeds bounded verification byte cap")
                children = db.execute(
                    """SELECT source_index, appid, source_change_number, needs_token
                    FROM ops.pics_change_batch_apps WHERE batch_id=%s
                    ORDER BY source_index LIMIT %s""",
                    (batch_id, MAX_SOURCE_ITEMS + 1),
                ).fetchall()
                batches[label] = (batch, children)
    gap, head = batches["gap"][0], batches["head"][0]
    if (
        gap["source_complete"]
        or gap["status"] != "source_blocked"
        or gap["primary_cursor_advanced"]
    ):
        raise ValueError("Gap does not prove an unavailable interval")
    if not (gap["force_full_update"] or gap["force_full_app_update"]):
        raise ValueError("Gap does not require a full refresh")
    if (
        head["work_mode"] != "shadow"
        or head["stream_key"] == "primary"
        or not head["source_complete"]
        or head["primary_cursor_advanced"]
    ):
        raise ValueError("Head must be complete shadow evidence")
    if head["to_change_number"] <= gap["from_change_number"]:
        raise ValueError("Head must be after the gap boundary")
    archive_store = S3ArchiveStore.from_env()
    report: dict[str, Any] = {"version": "pics-successor-evidence/v1"}
    for label, (batch, children) in batches.items():
        document = archive_store.read_json_verified(
            bucket=batch["archive_bucket"],
            key=batch["archive_key"],
            expected_content_hash=batch["archive_content_hash"],
            expected_byte_size=batch["archive_byte_size"],
            expected_content_type=batch["archive_content_type"],
        )
        report[label] = verify_batch_document(batch, document, children)
    report["verifiedAt"] = datetime.now(timezone.utc).isoformat()
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Verified two archived batches; report written to {args.output}")


if __name__ == "__main__":
    main()
