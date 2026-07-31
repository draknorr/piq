"""Bounded leased consumers for durable PICS app work."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import socket
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional
from uuid import uuid4

import gevent

from ..config.settings import settings
from ..database.durable_payload import (
    PICSPayloadValidationError,
    ValidatedPICSPayload,
    validate_pics_product_payload,
)
from ..database.durable_promotion import TigerPICSDurablePromoter
from ..database.durable_work import (
    PICSLatestSnapshot,
    PICSWorkClaim,
    TigerPICSDurableWorkStore,
)
from ..database.tiger_change_history import ArchivePointer, S3ArchiveStore
from ..extractors.common import PICSExtractor
from ..steam.pics import PICSFetcher

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PICSProcessingStats:
    """One bounded consumer pass."""

    claimed: int
    completed: int
    retried: int
    dead_lettered: int
    source_blocked: int
    snapshots_changed: int
    events_created: int
    live_claimed: int = 0
    catchup_claimed: int = 0
    duration_seconds: float = 0.0
    product_info_requests: int = 0
    heartbeat_transactions: int = 0
    tiger_transactions: int = 0
    tiger_transactions_per_settlement: Optional[float] = None
    r2_reads: int = 0
    r2_writes: int = 0
    phase_seconds: Dict[str, float] = field(default_factory=dict)
    phase_latency_seconds: Dict[str, Dict[str, float | int]] = field(default_factory=dict)
    queue_metrics: Optional[Dict[str, Any]] = None


@dataclass(frozen=True)
class PICSClaimOutcome:
    """Settlement and phase evidence for one claimed app."""

    completed: int = 0
    retried: int = 0
    dead_lettered: int = 0
    source_blocked: int = 0
    snapshot_changed: int = 0
    event_count: int = 0
    tiger_transactions: int = 0
    r2_reads: int = 0
    r2_writes: int = 0
    phase_seconds: Dict[str, float] = field(default_factory=dict)


class DurablePICSProcessor:
    """Claim, validate, archive, promote, and acknowledge PICS app work."""

    MAX_PRODUCT_INFO_BATCH_SIZE = 200

    def __init__(
        self,
        *,
        work_mode: str,
        stream_key: str,
        work_store: Optional[TigerPICSDurableWorkStore] = None,
        promoter: Optional[TigerPICSDurablePromoter] = None,
        archive_store: Optional[S3ArchiveStore] = None,
        worker_id: Optional[str] = None,
    ):
        if work_mode not in {"shadow", "durable"}:
            raise ValueError("DurablePICSProcessor requires shadow or durable mode")
        if work_mode == "durable" and stream_key != "primary":
            raise ValueError("Durable processing must use the primary stream")
        if work_mode == "shadow" and stream_key == "primary":
            raise ValueError("Shadow processing cannot use the primary stream")
        if settings.pics_change_history_target.strip().lower() != "tiger":
            raise ValueError("Durable PICS processing requires PICS_CHANGE_HISTORY_TARGET=tiger")
        if settings.pics_latest_state_target.strip().lower() != "tiger":
            raise ValueError("Durable PICS processing requires PICS_LATEST_STATE_TARGET=tiger")
        live_batch_size = int(settings.pics_consumer_live_batch_size)
        catchup_batch_size = int(settings.pics_consumer_catchup_batch_size)
        if live_batch_size < 0 or catchup_batch_size < 0:
            raise ValueError("PICS consumer batch sizes cannot be negative")
        if live_batch_size + catchup_batch_size > self.MAX_PRODUCT_INFO_BATCH_SIZE:
            raise ValueError(
                "Combined PICS consumer batch size cannot exceed "
                f"{self.MAX_PRODUCT_INFO_BATCH_SIZE}"
            )
        if not 1 <= int(settings.pics_consumer_concurrency) <= 8:
            raise ValueError("PICS_CONSUMER_CONCURRENCY must be between 1 and 8")
        if int(settings.pics_consumer_heartbeat_interval_seconds) < 10:
            raise ValueError("PICS_CONSUMER_HEARTBEAT_INTERVAL_SECONDS must be at least 10")

        self._work_mode = work_mode
        self._stream_key = stream_key
        self._work_store = work_store or TigerPICSDurableWorkStore.from_settings(settings)
        self._promoter = promoter
        if work_mode == "durable" and self._promoter is None:
            self._promoter = TigerPICSDurablePromoter.from_settings(
                settings,
                self._work_store,
            )
        self._archive_store = archive_store or S3ArchiveStore.from_env()
        self._worker_id = worker_id or self._default_worker_id()
        self._extractor = PICSExtractor()

    @property
    def worker_id(self) -> str:
        return self._worker_id

    def process_once(self, fetcher: PICSFetcher) -> PICSProcessingStats:
        """Process protected live/new capacity plus a separate catch-up quota."""

        pass_started = time.perf_counter()
        phase_seconds: Dict[str, float] = {}
        phase_samples: Dict[str, List[float]] = {}
        heartbeat_transactions = 0
        tiger_transactions = 0

        phase_started = time.perf_counter()
        live_claims = self._work_store.claim_work(
            work_mode=self._work_mode,
            stream_key=self._stream_key,
            worker_id=self._worker_id,
            lane_group="live",
            limit=settings.pics_consumer_live_batch_size,
            lease_seconds=settings.pics_consumer_lease_seconds,
        )
        phase_seconds["claim_live"] = time.perf_counter() - phase_started
        tiger_transactions += int(settings.pics_consumer_live_batch_size > 0)

        phase_started = time.perf_counter()
        catchup_claims = self._work_store.claim_work(
            work_mode=self._work_mode,
            stream_key=self._stream_key,
            worker_id=self._worker_id,
            lane_group="catchup",
            limit=settings.pics_consumer_catchup_batch_size,
            lease_seconds=settings.pics_consumer_lease_seconds,
        )
        phase_seconds["claim_catchup"] = time.perf_counter() - phase_started
        tiger_transactions += int(settings.pics_consumer_catchup_batch_size > 0)

        claims = [*live_claims, *catchup_claims]
        if not claims:
            queue_metrics, queue_duration, queue_transactions = self._queue_metrics()
            phase_seconds["queue_metrics"] = queue_duration
            phase_seconds["total"] = time.perf_counter() - pass_started
            stats = PICSProcessingStats(
                claimed=0,
                completed=0,
                retried=0,
                dead_lettered=0,
                source_blocked=0,
                snapshots_changed=0,
                events_created=0,
                live_claimed=0,
                catchup_claimed=0,
                duration_seconds=phase_seconds["total"],
                tiger_transactions=tiger_transactions + queue_transactions,
                phase_seconds=self._rounded_phases(phase_seconds),
                queue_metrics=queue_metrics,
            )
            self._log_processing_metrics(stats)
            return stats

        phase_started = time.perf_counter()
        self._heartbeat_all(claims)
        phase_seconds["lease_heartbeat"] = time.perf_counter() - phase_started
        heartbeat_transactions += 1
        tiger_transactions += 1
        phase_started = time.perf_counter()
        raw_by_appid: Dict[int, Dict[str, Any]] = {}
        outcomes: List[PICSClaimOutcome] = []
        failed_claim_ids = set()
        anonymous_claims = [claim for claim in claims if not claim.needs_token]
        token_claims = [claim for claim in claims if claim.needs_token]
        fetch_groups = [
            (
                anonymous_claims,
                lambda: fetcher.fetch_apps_batch([claim.appid for claim in anonymous_claims]),
            ),
            (
                token_claims,
                lambda: fetcher.fetch_token_required_apps([claim.appid for claim in token_claims]),
            ),
        ]
        for group, fetch_group in fetch_groups:
            if not group:
                continue
            try:
                raw_by_appid.update(fetch_group())
            except Exception as error:
                logger.exception(
                    "Durable PICS %s batch fetch failed for %s claims",
                    "token-required" if group[0].needs_token else "anonymous",
                    len(group),
                )
                for claim in group:
                    failure_message = self._redact_error_message(str(error))
                    archive_written = 0
                    archive_started = time.perf_counter()
                    try:
                        failure_archive = self._archive_request_failure(
                            claim=claim,
                            error=error,
                            request_kind=("token_required" if claim.needs_token else "anonymous"),
                        )
                        failure_message = (
                            f"{failure_message}; evidence="
                            f"{failure_archive.bucket}/{failure_archive.key} "
                            f"sha256={failure_archive.content_hash}"
                        )
                        archive_written = 1
                    except Exception as archive_error:
                        logger.exception(
                            "Unable to archive PICS request failure for work %s",
                            claim.id,
                        )
                        failure_message = (
                            f"{failure_message}; evidence_archive_failed="
                            f"{type(archive_error).__name__}"
                        )
                    settlement_started = time.perf_counter()
                    state = self._fail_claim(
                        claim,
                        "product_fetch_failed",
                        failure_message,
                        True,
                    )
                    outcomes.append(
                        PICSClaimOutcome(
                            retried=int(state == "retrying"),
                            dead_lettered=int(state == "dead_letter"),
                            tiger_transactions=1,
                            r2_writes=archive_written,
                            phase_seconds={
                                "r2_request_failure_write": (time.perf_counter() - archive_started),
                                "tiger_failure_settlement": (
                                    time.perf_counter() - settlement_started
                                ),
                            },
                        )
                    )
                    failed_claim_ids.add(claim.id)
        phase_seconds["steam_product_info"] = time.perf_counter() - phase_started
        process_claims = [claim for claim in claims if claim.id not in failed_claim_ids]

        phase_started = time.perf_counter()
        latest_by_appid = (
            self._work_store.get_latest_snapshots([claim.appid for claim in process_claims])
            if process_claims
            else {}
        )
        phase_seconds["latest_snapshot_lookup"] = time.perf_counter() - phase_started
        tiger_transactions += int(bool(process_claims))

        phase_started = time.perf_counter()
        if process_claims:
            self._heartbeat_all(process_claims)
            heartbeat_transactions += 1
            tiger_transactions += 1
        phase_seconds["lease_heartbeat"] += time.perf_counter() - phase_started
        last_heartbeat_at = time.monotonic()

        concurrency = max(1, min(int(settings.pics_consumer_concurrency), 8))
        heartbeat_interval = max(
            10,
            min(
                int(settings.pics_consumer_heartbeat_interval_seconds),
                max(10, int(settings.pics_consumer_lease_seconds) // 3),
            ),
        )
        downstream_started = time.perf_counter()
        thread_pool = gevent.get_hub().threadpool
        for wave_start in range(0, len(process_claims), concurrency):
            remaining_claims = process_claims[wave_start:]
            if time.monotonic() - last_heartbeat_at >= heartbeat_interval:
                phase_started = time.perf_counter()
                self._heartbeat_all(remaining_claims)
                phase_seconds["lease_heartbeat"] += time.perf_counter() - phase_started
                heartbeat_transactions += 1
                tiger_transactions += 1
                last_heartbeat_at = time.monotonic()

            wave = process_claims[wave_start : wave_start + concurrency]
            jobs = [
                thread_pool.spawn(
                    self._process_and_settle_claim,
                    claim=claim,
                    raw_payload=self._lookup_payload(raw_by_appid, claim.appid),
                    previous_pointer=latest_by_appid.get(claim.appid),
                )
                for claim in wave
            ]
            first_error: Optional[Exception] = None
            for job in jobs:
                try:
                    outcomes.append(job.get())
                except Exception as error:
                    if first_error is None:
                        first_error = error
            if first_error is not None:
                raise first_error
        phase_seconds["downstream"] = time.perf_counter() - downstream_started

        for outcome in outcomes:
            tiger_transactions += outcome.tiger_transactions
            for phase, duration in outcome.phase_seconds.items():
                phase_samples.setdefault(phase, []).append(duration)
        queue_metrics, queue_duration, queue_transactions = self._queue_metrics()
        phase_seconds["queue_metrics"] = queue_duration
        tiger_transactions += queue_transactions
        for phase, samples in phase_samples.items():
            phase_seconds[phase] = sum(samples)
        phase_seconds["total"] = time.perf_counter() - pass_started

        completed = sum(outcome.completed for outcome in outcomes)
        retried = sum(outcome.retried for outcome in outcomes)
        dead_lettered = sum(outcome.dead_lettered for outcome in outcomes)
        source_blocked = sum(outcome.source_blocked for outcome in outcomes)
        settlements = completed + retried + dead_lettered + source_blocked
        stats = PICSProcessingStats(
            claimed=len(claims),
            completed=completed,
            retried=retried,
            dead_lettered=dead_lettered,
            source_blocked=source_blocked,
            snapshots_changed=sum(outcome.snapshot_changed for outcome in outcomes),
            events_created=sum(outcome.event_count for outcome in outcomes),
            live_claimed=len(live_claims),
            catchup_claimed=len(catchup_claims),
            duration_seconds=phase_seconds["total"],
            product_info_requests=int(getattr(fetcher, "last_product_info_attempts", 1)),
            heartbeat_transactions=heartbeat_transactions,
            tiger_transactions=tiger_transactions,
            tiger_transactions_per_settlement=self._transactions_per_settlement(
                tiger_transactions,
                settlements,
            ),
            r2_reads=sum(outcome.r2_reads for outcome in outcomes),
            r2_writes=sum(outcome.r2_writes for outcome in outcomes),
            phase_seconds=self._rounded_phases(phase_seconds),
            phase_latency_seconds=self._summarize_phase_samples(phase_samples),
            queue_metrics=queue_metrics,
        )
        self._log_processing_metrics(stats)
        return stats

    def _process_and_settle_claim(
        self,
        *,
        claim: PICSWorkClaim,
        raw_payload: Any,
        previous_pointer: Optional[PICSLatestSnapshot],
    ) -> PICSClaimOutcome:
        phase_seconds: Dict[str, float] = {}
        try:
            result = self._process_claim(
                claim=claim,
                raw_payload=raw_payload,
                previous_pointer=previous_pointer,
                phase_seconds=phase_seconds,
            )
            return PICSClaimOutcome(
                completed=1,
                snapshot_changed=int(result["snapshot_changed"]),
                event_count=int(result["event_count"]),
                tiger_transactions=1,
                r2_reads=int(previous_pointer is not None),
                r2_writes=int(result["archive_written"]),
                phase_seconds=phase_seconds,
            )
        except PICSPayloadValidationError as error:
            final_source_omission = (
                error.error_code == "payload_missing" and claim.attempts >= claim.max_attempts
            )
            if error.retryable and not final_source_omission:
                phase_started = time.perf_counter()
                state = self._fail_claim(claim, error.error_code, str(error), True)
                phase_seconds["tiger_failure_settlement"] = time.perf_counter() - phase_started
                return PICSClaimOutcome(
                    retried=int(state == "retrying"),
                    dead_lettered=int(state == "dead_letter"),
                    tiger_transactions=1,
                    r2_reads=int(previous_pointer is not None),
                    phase_seconds=phase_seconds,
                )

            phase_started = time.perf_counter()
            provenance = self._archive_blocked_payload(
                claim=claim,
                raw_payload=raw_payload,
                error=error,
            )
            phase_seconds["r2_write"] = time.perf_counter() - phase_started
            phase_started = time.perf_counter()
            self._work_store.block_claim(
                claim=claim,
                worker_id=self._worker_id,
                blocking_reason=error.error_code,
                detail=str(error),
                provenance=provenance,
            )
            phase_seconds["tiger_source_block"] = time.perf_counter() - phase_started
            return PICSClaimOutcome(
                source_blocked=1,
                tiger_transactions=1,
                r2_reads=int(previous_pointer is not None),
                r2_writes=(1 + int(self._has_token_evidence_archive(raw_payload))),
                phase_seconds=phase_seconds,
            )
        except Exception as error:
            logger.exception(
                "Durable PICS processing failed for work %s app %s",
                claim.id,
                claim.appid,
            )
            phase_started = time.perf_counter()
            state = self._fail_claim(
                claim,
                "processing_error",
                str(error),
                True,
            )
            phase_seconds["tiger_failure_settlement"] = time.perf_counter() - phase_started
            prior_tiger_attempts = int(
                "tiger_promotion" in phase_seconds or "tiger_shadow_settlement" in phase_seconds
            )
            return PICSClaimOutcome(
                retried=int(state == "retrying"),
                dead_lettered=int(state == "dead_letter"),
                tiger_transactions=1 + prior_tiger_attempts,
                r2_reads=int(previous_pointer is not None),
                r2_writes=sum(
                    (
                        int(self._has_token_evidence_archive(raw_payload)),
                        int("r2_write" in phase_seconds),
                    )
                ),
                phase_seconds=phase_seconds,
            )

    def _process_claim(
        self,
        *,
        claim: PICSWorkClaim,
        raw_payload: Any,
        previous_pointer: Optional[PICSLatestSnapshot],
        phase_seconds: Dict[str, float],
    ) -> Dict[str, int | bool]:
        if claim.needs_token:
            phase_started = time.perf_counter()
            try:
                if not isinstance(raw_payload, dict):
                    raise RuntimeError("Token-required PICS work returned no auditable payload")
                raw_payload["_token_request"] = self._redact_token_request_evidence(
                    raw_payload.get("_token_request")
                )
                token_archive = self._archive_token_request_evidence(
                    claim=claim,
                    raw_payload=raw_payload,
                )
                raw_payload["_token_evidence_archive"] = {
                    "bucket": token_archive.bucket,
                    "key": token_archive.key,
                    "contentHash": token_archive.content_hash,
                    "byteSize": token_archive.byte_size,
                    "contentType": token_archive.content_type,
                }
            finally:
                phase_seconds["r2_token_evidence_write"] = time.perf_counter() - phase_started
        phase_started = time.perf_counter()
        try:
            previous_snapshot = self._read_previous_snapshot(previous_pointer)
        finally:
            phase_seconds["prior_r2_read"] = time.perf_counter() - phase_started
        phase_started = time.perf_counter()
        payload = validate_pics_product_payload(
            appid=claim.appid,
            claimed_through_change_number=claim.claimed_through_change_number,
            raw_payload=raw_payload,
            previous_snapshot=previous_snapshot,
            extractor=self._extractor,
        )
        phase_seconds["validation_extraction"] = time.perf_counter() - phase_started
        snapshot_changed = (
            previous_pointer is None
            or previous_pointer.content_hash != payload.normalized_snapshot_sha256
        )
        archive = None
        if snapshot_changed:
            phase_started = time.perf_counter()
            try:
                archive = self._archive_validated_payload(claim=claim, payload=payload)
            finally:
                phase_seconds["r2_write"] = time.perf_counter() - phase_started

        if claim.work_mode == "shadow":
            phase_started = time.perf_counter()
            try:
                next_state = self._work_store.complete_shadow_claim(
                    claim=claim,
                    worker_id=self._worker_id,
                )
            finally:
                phase_seconds["tiger_shadow_settlement"] = time.perf_counter() - phase_started
            logger.info(
                "Validated shadow PICS work %s for app %s (changed=%s, archive=%s, next_state=%s)",
                claim.id,
                claim.appid,
                snapshot_changed,
                archive.key if archive else None,
                next_state,
            )
            return {
                "snapshot_changed": snapshot_changed,
                "event_count": 0,
                "archive_written": int(archive is not None)
                + int(self._has_token_evidence_archive(raw_payload)),
            }

        if self._promoter is None:
            raise RuntimeError("Durable PICS promoter is not configured")
        phase_started = time.perf_counter()
        try:
            result = self._promoter.promote(
                claim=claim,
                worker_id=self._worker_id,
                payload=payload,
                previous_pointer=previous_pointer,
                previous_snapshot=previous_snapshot,
                archive=archive,
            )
        finally:
            phase_seconds["tiger_promotion"] = time.perf_counter() - phase_started
        logger.info(
            "Promoted durable PICS work %s for app %s through %s "
            "(snapshot=%s, changed=%s, events=%s, next_state=%s)",
            claim.id,
            claim.appid,
            result.completed_through_change_number,
            result.snapshot_id,
            result.snapshot_changed,
            result.event_count,
            result.next_work_state,
        )
        return {
            "snapshot_changed": result.snapshot_changed,
            "event_count": result.event_count,
            "archive_written": int(archive is not None)
            + int(self._has_token_evidence_archive(raw_payload)),
        }

    def _archive_token_request_evidence(
        self,
        *,
        claim: PICSWorkClaim,
        raw_payload: Dict[str, Any],
    ) -> ArchivePointer:
        evidence = raw_payload.get(
            "_token_request",
            {"needsToken": True, "status": "unknown"},
        )
        document = {
            "_archive_schema_version": "pics-token-request-evidence/v1",
            "appid": claim.appid,
            "stream_key": claim.stream_key,
            "work_mode": claim.work_mode,
            "work_id": claim.id,
            "claimed_through_change_number": claim.claimed_through_change_number,
            "token_request": evidence,
        }
        return self._archive_store.write_json(
            content_hash=None,
            key_parts=[
                claim.stream_key,
                str(claim.appid),
                str(claim.claimed_through_change_number),
                str(evidence.get("status", "unknown")) if isinstance(evidence, dict) else "unknown",
            ],
            kind="pics-token-request-evidence",
            payload=document,
        )

    def _archive_request_failure(
        self,
        *,
        claim: PICSWorkClaim,
        error: Exception,
        request_kind: str,
    ) -> ArchivePointer:
        return self._archive_store.write_json(
            content_hash=None,
            key_parts=[
                claim.stream_key,
                str(claim.appid),
                str(claim.claimed_through_change_number),
                request_kind,
            ],
            kind="pics-product-request-failure",
            payload={
                "_archive_schema_version": "pics-product-request-failure/v1",
                "appid": claim.appid,
                "stream_key": claim.stream_key,
                "work_mode": claim.work_mode,
                "work_id": claim.id,
                "claimed_through_change_number": (claim.claimed_through_change_number),
                "needs_token": claim.needs_token,
                "request_kind": request_kind,
                "error_class": type(error).__name__,
                "error": self._redact_error_message(str(error)),
            },
        )

    @staticmethod
    def _redact_token_request_evidence(value: Any) -> Dict[str, Any]:
        if not isinstance(value, dict):
            return {"needsToken": True, "status": "unknown"}
        allowed = {
            "needsToken",
            "status",
            "expiresAt",
            "expiresInSeconds",
            "errorClass",
            "refreshReason",
        }
        return {
            key: item
            for key, item in value.items()
            if key in allowed and isinstance(item, (bool, float, int, str))
        } or {"needsToken": True, "status": "unknown"}

    @staticmethod
    def _has_token_evidence_archive(raw_payload: Any) -> bool:
        return isinstance(raw_payload, dict) and isinstance(
            raw_payload.get("_token_evidence_archive"),
            dict,
        )

    @staticmethod
    def _redact_error_message(value: str) -> str:
        return re.sub(
            r"(?i)(access[_-]?token\s*[:=]\s*)[^\s,;]+",
            r"\1[REDACTED]",
            value,
        )[:2_000]

    def _read_previous_snapshot(
        self,
        pointer: Optional[PICSLatestSnapshot],
    ) -> Optional[Dict[str, Any]]:
        if pointer is None:
            return None
        payload = self._archive_store.read_json(
            bucket=pointer.archive_bucket,
            key=pointer.archive_key,
        )
        actual_hash = self._hash_json(payload)
        if actual_hash != pointer.archive_content_hash:
            raise RuntimeError(
                f"R2 PICS snapshot hash mismatch for snapshot {pointer.id}: "
                f"expected {pointer.archive_content_hash}, got {actual_hash}"
            )
        return payload

    def _archive_validated_payload(
        self,
        *,
        claim: PICSWorkClaim,
        payload: ValidatedPICSPayload,
    ) -> ArchivePointer:
        return self._archive_store.write_json(
            content_hash=None,
            key_parts=[
                claim.stream_key,
                str(claim.appid),
                str(payload.source_change_number),
                payload.raw_payload_sha256,
            ],
            kind="pics-product-payload",
            payload=payload.archive_document,
        )

    def _archive_blocked_payload(
        self,
        *,
        claim: PICSWorkClaim,
        raw_payload: Any,
        error: PICSPayloadValidationError,
    ) -> Dict[str, Any]:
        document = {
            "_archive_schema_version": "pics-product-payload-blocked/v1",
            "appid": claim.appid,
            "stream_key": claim.stream_key,
            "work_mode": claim.work_mode,
            "claimed_through_change_number": (claim.claimed_through_change_number),
            "attempts": claim.attempts,
            "max_attempts": claim.max_attempts,
            "needs_token": claim.needs_token,
            "error_code": error.error_code,
            "error": str(error),
            "raw_payload": raw_payload,
        }
        pointer = self._archive_store.write_json(
            content_hash=None,
            key_parts=[
                claim.stream_key,
                str(claim.appid),
                str(claim.claimed_through_change_number),
                error.error_code,
            ],
            kind="pics-product-payload-blocked",
            payload=document,
        )
        return {
            "archive": {
                "bucket": pointer.bucket,
                "key": pointer.key,
                "contentHash": pointer.content_hash,
                "byteSize": pointer.byte_size,
                "contentType": pointer.content_type,
            }
        }

    def _queue_metrics(self) -> tuple[Optional[Dict[str, Any]], float, int]:
        """Read operational queue metrics without making settlement depend on them."""

        get_metrics = getattr(self._work_store, "get_queue_metrics", None)
        if get_metrics is None:
            return None, 0.0, 0
        started = time.perf_counter()
        try:
            metrics = asdict(
                get_metrics(
                    work_mode=self._work_mode,
                    stream_key=self._stream_key,
                )
            )
            observed_at = metrics.get("observed_at")
            isoformat = getattr(observed_at, "isoformat", None)
            if callable(isoformat):
                metrics["observed_at"] = isoformat()
            for key, value in tuple(metrics.items()):
                if isinstance(value, float):
                    metrics[key] = round(value, 3)
            return metrics, time.perf_counter() - started, 1
        except Exception as error:
            logger.warning("Unable to read durable PICS queue metrics: %s", error)
            return None, time.perf_counter() - started, 1

    @staticmethod
    def _summarize_phase_samples(
        samples_by_phase: Dict[str, List[float]],
    ) -> Dict[str, Dict[str, float | int]]:
        summaries: Dict[str, Dict[str, float | int]] = {}
        for phase, samples in sorted(samples_by_phase.items()):
            if not samples:
                continue
            ordered = sorted(samples)
            p50_index = max(0, math.ceil(len(ordered) * 0.50) - 1)
            p95_index = max(0, math.ceil(len(ordered) * 0.95) - 1)
            summaries[phase] = {
                "count": len(ordered),
                "total": round(sum(ordered), 3),
                "p50": round(ordered[p50_index], 3),
                "p95": round(ordered[p95_index], 3),
                "max": round(ordered[-1], 3),
            }
        return summaries

    @staticmethod
    def _rounded_phases(phases: Dict[str, float]) -> Dict[str, float]:
        return {key: round(value, 3) for key, value in sorted(phases.items())}

    @staticmethod
    def _transactions_per_settlement(
        tiger_transactions: int,
        settlements: int,
    ) -> Optional[float]:
        if settlements <= 0:
            return None
        return round(tiger_transactions / settlements, 3)

    @staticmethod
    def _log_processing_metrics(stats: PICSProcessingStats) -> None:
        logger.info(
            "Durable PICS processing metrics %s",
            json.dumps(asdict(stats), sort_keys=True, separators=(",", ":")),
        )

    def _heartbeat_all(self, claims: List[PICSWorkClaim]) -> None:
        heartbeat_count = self._work_store.heartbeat_claims(
            claims=claims,
            worker_id=self._worker_id,
            lease_seconds=settings.pics_consumer_lease_seconds,
        )
        if heartbeat_count != len(claims):
            raise RuntimeError(
                f"Only {heartbeat_count}/{len(claims)} PICS work leases were renewed"
            )

    def _fail_claim(
        self,
        claim: PICSWorkClaim,
        error_code: str,
        error_message: str,
        retryable: bool,
    ) -> str:
        exponent = max(0, min(claim.attempts - 1, 10))
        delay = min(
            settings.pics_consumer_retry_base_seconds * (2**exponent),
            settings.pics_consumer_retry_max_seconds,
        )
        return self._work_store.fail_claim(
            claim=claim,
            worker_id=self._worker_id,
            error_code=error_code,
            error_message=error_message,
            retryable=retryable,
            retry_delay_seconds=delay,
        )

    @staticmethod
    def _lookup_payload(raw_by_appid: Any, appid: int) -> Any:
        if not isinstance(raw_by_appid, dict):
            return None
        return raw_by_appid.get(appid) or raw_by_appid.get(str(appid))

    @staticmethod
    def _hash_json(value: Any) -> str:
        body = json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        return hashlib.sha256(body.encode("utf-8")).hexdigest()

    @staticmethod
    def _default_worker_id() -> str:
        configured = (settings.pics_consumer_worker_id or "").strip()
        if configured:
            return configured
        return f"{socket.gethostname()}:{os.getpid()}:{uuid4().hex[:12]}"
