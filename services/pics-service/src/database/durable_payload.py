"""Validation and evidence-preserving normalization for durable PICS payloads."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional

from ..extractors.common import ExtractedPICSData, PICSExtractor, PICSPayloadEvidence
from .change_intelligence import hash_normalized_snapshot, normalize_pics_snapshot

PICS_DURABLE_ARCHIVE_SCHEMA_VERSION = "pics-product-payload-archive/v1"
_SHA1_RE = re.compile(r"^[0-9a-f]{40}$")


class PICSPayloadValidationError(RuntimeError):
    """A source payload that cannot be promoted safely."""

    def __init__(self, message: str, *, error_code: str, retryable: bool):
        super().__init__(message)
        self.error_code = error_code
        self.retryable = retryable


@dataclass(frozen=True)
class ValidatedPICSPayload:
    """One source-complete PICS product payload prepared for promotion."""

    appid: int
    claimed_through_change_number: int
    source_change_number: int
    raw_payload: Dict[str, Any]
    raw_payload_sha256: str
    extracted: ExtractedPICSData
    normalized_snapshot: Dict[str, Any]
    normalized_snapshot_sha256: str
    archive_document: Dict[str, Any]


def validate_pics_product_payload(
    *,
    appid: int,
    claimed_through_change_number: int,
    raw_payload: Any,
    previous_snapshot: Optional[Mapping[str, Any]] = None,
    extractor: Optional[PICSExtractor] = None,
) -> ValidatedPICSPayload:
    """Validate source metadata and preserve missing-versus-empty semantics."""

    expected_appid = int(appid)
    claimed_through = int(claimed_through_change_number)
    if expected_appid <= 0 or claimed_through < 0:
        raise ValueError("appid must be positive and claimed cursor must be nonnegative")
    if not isinstance(raw_payload, dict):
        raise PICSPayloadValidationError(
            f"PICS returned no product payload for app {expected_appid}",
            error_code="payload_missing",
            retryable=True,
        )

    payload_appid = _safe_int(raw_payload.get("appid"))
    if payload_appid is not None and payload_appid != expected_appid:
        raise PICSPayloadValidationError(
            f"PICS payload appid {payload_appid} does not match claim {expected_appid}",
            error_code="appid_mismatch",
            retryable=True,
        )

    extracted = (extractor or PICSExtractor()).extract(expected_appid, raw_payload)
    evidence = extracted.source_evidence
    if evidence is None:
        raise PICSPayloadValidationError(
            f"PICS payload evidence is missing for app {expected_appid}",
            error_code="evidence_missing",
            retryable=True,
        )
    if evidence.missing_token:
        raise PICSPayloadValidationError(
            f"PICS requires an unavailable access token for app {expected_appid}",
            error_code="missing_access_token",
            retryable=False,
        )
    if not evidence.source_complete:
        raise PICSPayloadValidationError(
            f"PICS payload is not source-complete for app {expected_appid}",
            error_code="payload_incomplete",
            retryable=False,
        )
    if evidence.source_change_number is None:
        raise PICSPayloadValidationError(
            f"PICS payload has no source change number for app {expected_appid}",
            error_code="change_number_missing",
            retryable=True,
        )
    if evidence.source_change_number < claimed_through:
        raise PICSPayloadValidationError(
            f"PICS payload change {evidence.source_change_number} is older than "
            f"claimed work {claimed_through} for app {expected_appid}",
            error_code="stale_product_payload",
            retryable=True,
        )
    if evidence.source_sha is None or not _SHA1_RE.fullmatch(evidence.source_sha):
        raise PICSPayloadValidationError(
            f"PICS payload SHA-1 metadata is invalid for app {expected_appid}",
            error_code="source_sha_invalid",
            retryable=True,
        )
    if evidence.source_size is None or evidence.source_size < 0:
        raise PICSPayloadValidationError(
            f"PICS payload size metadata is invalid for app {expected_appid}",
            error_code="source_size_invalid",
            retryable=True,
        )

    raw_payload_copy = _canonicalize(raw_payload)
    raw_payload_sha256 = _hash_json(raw_payload_copy)
    normalized = normalize_pics_snapshot(extracted)
    effective_snapshot = merge_incomplete_snapshot(
        previous_snapshot=previous_snapshot,
        current_snapshot=normalized,
        evidence=evidence,
    )
    normalized_hash = hash_normalized_snapshot(effective_snapshot)
    evidence_document = serialize_payload_evidence(evidence)
    archive_document = {
        **effective_snapshot,
        "_archive_schema_version": PICS_DURABLE_ARCHIVE_SCHEMA_VERSION,
        "_source_evidence": evidence_document,
        "_raw_payload": raw_payload_copy,
        "_raw_payload_sha256": raw_payload_sha256,
    }

    return ValidatedPICSPayload(
        appid=expected_appid,
        claimed_through_change_number=claimed_through,
        source_change_number=evidence.source_change_number,
        raw_payload=raw_payload_copy,
        raw_payload_sha256=raw_payload_sha256,
        extracted=extracted,
        normalized_snapshot=effective_snapshot,
        normalized_snapshot_sha256=normalized_hash,
        archive_document=archive_document,
    )


def merge_incomplete_snapshot(
    *,
    previous_snapshot: Optional[Mapping[str, Any]],
    current_snapshot: Dict[str, Any],
    evidence: PICSPayloadEvidence,
) -> Dict[str, Any]:
    """Preserve previous values when the source omitted a field or family."""

    merged = dict(current_snapshot)
    previous = dict(previous_snapshot or {})
    if not previous:
        return merged

    scalar_sources = {
        "name": "name",
        "type": "type",
        "release_state": "release_state",
        "review_score": "review_score",
        "review_percentage": "review_percentage",
        "metacritic_score": "metacritic_score",
        "metacritic_url": "metacritic_url",
        "parent_appid": "parent_appid",
        "platforms": "platforms",
        "controller_support": "controller_support",
        "steam_deck_category": "steam_deck",
        "steam_deck_details": "steam_deck",
        "content_descriptors": "content_descriptors",
        "languages": "languages",
        "homepage_url": "homepage_url",
        "app_state": "app_state",
        "current_build_id": "current_build_id",
        "last_content_update": "last_content_update",
        "store_asset_mtime": "store_asset_mtime",
        "steam_release_date": "steam_release_date",
        "original_release_date": "original_release_date",
        "has_workshop": "has_workshop",
        "is_free": "is_free",
    }
    for snapshot_key, evidence_field in scalar_sources.items():
        if not evidence.field_is_present(evidence_field) and snapshot_key in previous:
            merged[snapshot_key] = previous[snapshot_key]

    family_sources = {
        "categories": "categories",
        "genres": "genres",
        "store_tags": "store_tags",
        "franchise_names": "associations",
        "dlc_appids": "dlc",
    }
    for snapshot_key, family_name in family_sources.items():
        if not evidence.family_is_complete(family_name) and snapshot_key in previous:
            merged[snapshot_key] = previous[snapshot_key]

    associations_complete = evidence.family_is_complete("associations")
    if (
        not associations_complete
        and not evidence.field_is_present("developer")
        and "developer_names" in previous
    ):
        merged["developer_names"] = previous["developer_names"]
    if (
        not associations_complete
        and not evidence.field_is_present("publisher")
        and "publisher_names" in previous
    ):
        merged["publisher_names"] = previous["publisher_names"]
    if not evidence.field_is_present("primary_genre") and "primary_genre" in previous:
        merged["primary_genre"] = previous["primary_genre"]

    return merged


def serialize_payload_evidence(evidence: PICSPayloadEvidence) -> Dict[str, Any]:
    """Convert evidence to a stable JSON object for R2 and readiness provenance."""

    return {
        "schema_version": evidence.schema_version,
        "source_complete": evidence.source_complete,
        "missing_token": evidence.missing_token,
        "source_change_number": evidence.source_change_number,
        "source_sha": evidence.source_sha,
        "source_size": evidence.source_size,
        "present_fields": sorted(evidence.present_fields),
        "relationship_families": {
            family_name: {
                "source_path": family.source_path,
                "status": family.status,
            }
            for family_name, family in sorted(evidence.relationship_families.items())
        },
    }


def _safe_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _hash_json(value: Any) -> str:
    body = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _canonicalize(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _canonicalize(value[key]) for key in sorted(value, key=str)}
    if isinstance(value, list):
        return [_canonicalize(item) for item in value]
    if isinstance(value, tuple):
        return [_canonicalize(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)
