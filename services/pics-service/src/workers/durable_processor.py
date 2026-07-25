"""Bounded leased consumers for durable PICS app work."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import socket
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from uuid import uuid4

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


class DurablePICSProcessor:
    """Claim, validate, archive, promote, and acknowledge PICS app work."""

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

        claims = [
            *self._work_store.claim_work(
                work_mode=self._work_mode,
                stream_key=self._stream_key,
                worker_id=self._worker_id,
                lane_group="live",
                limit=settings.pics_consumer_live_batch_size,
                lease_seconds=settings.pics_consumer_lease_seconds,
            ),
            *self._work_store.claim_work(
                work_mode=self._work_mode,
                stream_key=self._stream_key,
                worker_id=self._worker_id,
                lane_group="catchup",
                limit=settings.pics_consumer_catchup_batch_size,
                lease_seconds=settings.pics_consumer_lease_seconds,
            ),
        ]
        if not claims:
            return PICSProcessingStats(0, 0, 0, 0, 0, 0, 0)

        self._heartbeat_all(claims)
        try:
            raw_by_appid = fetcher.fetch_apps_batch([claim.appid for claim in claims])
        except Exception as error:
            logger.exception("Durable PICS batch fetch failed for %s claims", len(claims))
            retried = 0
            dead_lettered = 0
            for claim in claims:
                state = self._fail_claim(
                    claim,
                    "product_fetch_failed",
                    str(error),
                    True,
                )
                retried += int(state == "retrying")
                dead_lettered += int(state == "dead_letter")
            return PICSProcessingStats(
                claimed=len(claims),
                completed=0,
                retried=retried,
                dead_lettered=dead_lettered,
                source_blocked=0,
                snapshots_changed=0,
                events_created=0,
            )
        self._heartbeat_all(claims)

        completed = 0
        retried = 0
        dead_lettered = 0
        source_blocked = 0
        snapshots_changed = 0
        events_created = 0

        for claim_index, claim in enumerate(claims):
            # Refresh every unprocessed lease before each potentially variable
            # R2/Tiger promotion. Completed claims are intentionally excluded.
            self._heartbeat_all(claims[claim_index:])
            raw_payload = self._lookup_payload(raw_by_appid, claim.appid)
            try:
                result = self._process_claim(claim=claim, raw_payload=raw_payload)
                completed += 1
                snapshots_changed += int(result["snapshot_changed"])
                events_created += int(result["event_count"])
            except PICSPayloadValidationError as error:
                final_source_omission = (
                    error.error_code == "payload_missing"
                    and claim.attempts >= claim.max_attempts
                )
                if error.retryable and not final_source_omission:
                    state = self._fail_claim(claim, error.error_code, str(error), True)
                    retried += int(state == "retrying")
                    dead_lettered += int(state == "dead_letter")
                else:
                    provenance = self._archive_blocked_payload(
                        claim=claim,
                        raw_payload=raw_payload,
                        error=error,
                    )
                    self._work_store.block_claim(
                        claim=claim,
                        worker_id=self._worker_id,
                        blocking_reason=error.error_code,
                        detail=str(error),
                        provenance=provenance,
                    )
                    source_blocked += 1
            except Exception as error:
                logger.exception(
                    "Durable PICS processing failed for work %s app %s",
                    claim.id,
                    claim.appid,
                )
                state = self._fail_claim(
                    claim,
                    "processing_error",
                    str(error),
                    True,
                )
                retried += int(state == "retrying")
                dead_lettered += int(state == "dead_letter")

        return PICSProcessingStats(
            claimed=len(claims),
            completed=completed,
            retried=retried,
            dead_lettered=dead_lettered,
            source_blocked=source_blocked,
            snapshots_changed=snapshots_changed,
            events_created=events_created,
        )

    def _process_claim(
        self,
        *,
        claim: PICSWorkClaim,
        raw_payload: Any,
    ) -> Dict[str, int | bool]:
        previous_pointer = self._work_store.get_latest_snapshot(claim.appid)
        previous_snapshot = self._read_previous_snapshot(previous_pointer)
        payload = validate_pics_product_payload(
            appid=claim.appid,
            claimed_through_change_number=claim.claimed_through_change_number,
            raw_payload=raw_payload,
            previous_snapshot=previous_snapshot,
            extractor=self._extractor,
        )
        snapshot_changed = (
            previous_pointer is None
            or previous_pointer.content_hash != payload.normalized_snapshot_sha256
        )
        archive = (
            self._archive_validated_payload(claim=claim, payload=payload)
            if snapshot_changed
            else None
        )

        if claim.work_mode == "shadow":
            next_state = self._work_store.complete_shadow_claim(
                claim=claim,
                worker_id=self._worker_id,
            )
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
            }

        if self._promoter is None:
            raise RuntimeError("Durable PICS promoter is not configured")
        result = self._promoter.promote(
            claim=claim,
            worker_id=self._worker_id,
            payload=payload,
            previous_pointer=previous_pointer,
            previous_snapshot=previous_snapshot,
            archive=archive,
        )
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
        }

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
