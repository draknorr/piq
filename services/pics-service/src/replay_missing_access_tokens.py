"""Bounded dry-run and exact-app replay for missing_access_token PICS work."""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import asdict
from datetime import datetime
from typing import Any

from .config.settings import settings
from .database.durable_work import TigerPICSDurableWorkStore
from .database.tiger_change_history import S3ArchiveStore


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _parse_appids(values: list[str]) -> list[int]:
    appids = {
        int(item) for value in values for item in value.split(",") if item.strip() and int(item) > 0
    }
    if len(appids) > 100:
        raise ValueError("At most 100 exact appids may be targeted")
    return sorted(appids)


def _plan_sha256(plan: dict[str, Any]) -> str:
    body = json.dumps(
        plan,
        sort_keys=True,
        separators=(",", ":"),
        default=_json_default,
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _json_safe(value: Any) -> Any:
    """Canonicalize database-native values before hashing and R2 archival."""

    return json.loads(json.dumps(value, default=_json_default))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--appid", action="append", default=[])
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--execute-plan-sha256")
    parser.add_argument("--requested-by", default="dry-run")
    parser.add_argument("--reason", default="missing_access_token_replay")
    args = parser.parse_args()

    appids = _parse_appids(args.appid)
    store = TigerPICSDurableWorkStore.from_settings(settings)
    candidates = store.preview_missing_access_token_replay(
        appids=appids,
        limit=args.limit,
    )
    plan = _json_safe(
        {
            "schemaVersion": "pics-token-replay-plan/v1",
            "requestedBy": args.requested_by,
            "reason": args.reason,
            "exactAppids": appids,
            "affected": [asdict(candidate) for candidate in candidates],
        }
    )
    plan_sha256 = _plan_sha256(plan)
    if not args.apply:
        print(
            json.dumps(
                {**plan, "dryRun": True, "planSha256": plan_sha256},
                indent=2,
                sort_keys=True,
                default=_json_default,
            )
        )
        return
    if not appids:
        raise ValueError("--apply requires at least one exact --appid")
    if {candidate.appid for candidate in candidates} != set(appids):
        raise RuntimeError("One or more exact appids are no longer replay-eligible")
    if args.execute_plan_sha256 != plan_sha256:
        raise RuntimeError("--execute-plan-sha256 does not match the fresh exact-app dry-run")

    archive_store = S3ArchiveStore.from_env()
    pointer = archive_store.write_json(
        content_hash=None,
        key_parts=[str(appid) for appid in appids],
        kind="pics-token-replay",
        payload={**plan, "dryRun": False, "planSha256": plan_sha256},
    )
    requeued = store.requeue_missing_access_token(
        appids=appids,
        requested_by=args.requested_by,
        reason=args.reason,
        archive={
            "bucket": pointer.bucket,
            "key": pointer.key,
            "content_hash": pointer.content_hash,
        },
    )
    print(
        json.dumps(
            {
                "requeued": requeued,
                "appids": appids,
                "planSha256": plan_sha256,
                "archive": {
                    "bucket": pointer.bucket,
                    "key": pointer.key,
                    "contentHash": pointer.content_hash,
                },
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
