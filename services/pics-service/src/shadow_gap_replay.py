"""Operator CLI for a reviewed PICS shadow-gap replay."""

from __future__ import annotations

import argparse
import json
from uuid import UUID

from .config.settings import settings
from .database.durable_intake import TigerPICSDurableIntakeStore
from .database.shadow_gap_replay import (
    PICSShadowGapReplayExecutor,
    TigerPICSShadowGapReplayPlanner,
    plan_summary,
)
from .database.tiger_change_history import S3ArchiveStore


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Plan a bounded PICS shadow-to-primary replay. The command is "
            "read-only unless --execute-plan-sha256 exactly matches the dry-run plan."
        )
    )
    parser.add_argument("--gap-evidence-batch-id", required=True, type=UUID)
    parser.add_argument("--source-stream-key", required=True)
    parser.add_argument("--first-source-batch-id", required=True, type=UUID)
    parser.add_argument("--expected-start-change-number", required=True, type=int)
    parser.add_argument("--target-change-number", required=True, type=int)
    parser.add_argument("--requested-by", required=True)
    parser.add_argument("--max-batches", type=int, default=1000)
    parser.add_argument(
        "--execute-plan-sha256",
        help=(
            "Enable Tiger/R2 writes only when this exactly matches the current "
            "credential-free dry-run plan hash."
        ),
    )
    return parser


def main() -> None:
    args = _parser().parse_args()
    database_url = settings.pics_intake_tiger_url or settings.tiger_primary_url
    if not database_url:
        raise ValueError("PICS_INTAKE_TIGER_URL or TIGER_PRIMARY_URL is required")

    planner = TigerPICSShadowGapReplayPlanner(
        database_url,
        statement_timeout_seconds=settings.pics_intake_statement_timeout_seconds,
    )
    plan = planner.build_plan(
        gap_evidence_batch_id=args.gap_evidence_batch_id,
        source_stream_key=args.source_stream_key,
        first_source_batch_id=args.first_source_batch_id,
        expected_start_change_number=args.expected_start_change_number,
        target_change_number=args.target_change_number,
        requested_by=args.requested_by,
        max_batches=args.max_batches,
    )
    summary = plan_summary(plan)
    print(json.dumps(summary, sort_keys=True, indent=2))

    if args.execute_plan_sha256 is None:
        return

    executor = PICSShadowGapReplayExecutor(
        intake_store=TigerPICSDurableIntakeStore.from_settings(settings),
        archive_store=S3ArchiveStore.from_env(),
    )
    result = executor.execute(
        plan,
        approved_plan_sha256=args.execute_plan_sha256,
    )
    print(
        json.dumps(
            {
                "planSha256": result.plan_sha256,
                "startChangeNumber": result.start_change_number,
                "targetChangeNumber": result.target_change_number,
                "previouslyCompletedSteps": result.previously_completed_steps,
                "newlyCommittedBatchIds": [
                    str(batch_id) for batch_id in result.newly_committed_batch_ids
                ],
            },
            sort_keys=True,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
