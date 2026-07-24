from copy import deepcopy

import pytest

from src.database.durable_payload import (
    PICSPayloadValidationError,
    validate_pics_product_payload,
)


def build_payload(*, change_number: int = 120, missing_token: bool = False):
    return {
        "appid": 730,
        "_change_number": change_number,
        "_missing_token": missing_token,
        "_sha": "a" * 40,
        "_size": 1234,
        "common": {
            "name": "Counter-Strike 2",
            "type": "game",
            "genres": {"0": "1"},
            "category": {"category_2": "1"},
            "associations": {
                "0": {"type": "developer", "name": "Valve"},
                "1": {"type": "publisher", "name": "Valve"},
            },
            "review_score": "8",
            "store_tags": {},
        },
        "extended": {
            "isfreeapp": "1",
            "listofdlc": "",
        },
        "config": {},
        "depots": {
            "branches": {
                "public": {
                    "buildid": "123",
                    "timeupdated": "1700000000",
                }
            }
        },
    }


def test_complete_empty_family_is_retained_as_complete():
    result = validate_pics_product_payload(
        appid=730,
        claimed_through_change_number=100,
        raw_payload=build_payload(),
    )

    evidence = result.extracted.source_evidence
    assert evidence is not None
    assert evidence.family_is_complete("store_tags")
    assert result.normalized_snapshot["store_tags"] == []
    assert result.extracted.is_free is True
    assert (
        result.archive_document["_source_evidence"]["relationship_families"]["store_tags"]["status"]
        == "complete"
    )


def test_absent_family_preserves_previous_values():
    payload = build_payload()
    del payload["common"]["store_tags"]
    previous = {
        "appid": 730,
        "name": "Old name",
        "type": "game",
        "store_tags": [10, 20],
        "genres": [99],
    }

    result = validate_pics_product_payload(
        appid=730,
        claimed_through_change_number=100,
        raw_payload=payload,
        previous_snapshot=previous,
    )

    evidence = result.extracted.source_evidence
    assert evidence is not None
    assert evidence.relationship_families["store_tags"].status == "absent"
    assert result.normalized_snapshot["store_tags"] == [10, 20]
    assert result.normalized_snapshot["genres"] == [1]


def test_absent_promoted_scalar_preserves_previous_snapshot_evidence():
    payload = build_payload()
    del payload["extended"]["isfreeapp"]
    previous = {
        "appid": 730,
        "name": "Counter-Strike 2",
        "type": "game",
        "is_free": True,
        "metacritic_score": 88,
    }

    result = validate_pics_product_payload(
        appid=730,
        claimed_through_change_number=100,
        raw_payload=payload,
        previous_snapshot=previous,
    )

    assert result.normalized_snapshot["is_free"] is True
    assert result.normalized_snapshot["metacritic_score"] == 88


def test_partial_payload_never_converts_missing_family_to_empty():
    payload = build_payload(missing_token=True)

    with pytest.raises(PICSPayloadValidationError) as raised:
        validate_pics_product_payload(
            appid=730,
            claimed_through_change_number=100,
            raw_payload=payload,
        )

    assert raised.value.error_code == "missing_access_token"
    assert raised.value.retryable is False


@pytest.mark.parametrize(
    ("family", "malformed_value"),
    [
        ("category", {"category_bad": "1"}),
        ("genres", {"0": "not-an-id"}),
        ("store_tags", {"0": None}),
        ("associations", {"0": {"type": "developer"}}),
    ],
)
def test_malformed_relationship_member_is_partial_and_preserves_previous(
    family,
    malformed_value,
):
    payload = build_payload()
    payload["common"][family] = malformed_value
    snapshot_key = {
        "category": "categories",
        "genres": "genres",
        "store_tags": "store_tags",
        "associations": "franchise_names",
    }[family]
    previous = {snapshot_key: [99]}

    result = validate_pics_product_payload(
        appid=730,
        claimed_through_change_number=100,
        raw_payload=payload,
        previous_snapshot=previous,
    )

    evidence_family = "categories" if family == "category" else family
    assert result.extracted.source_evidence is not None
    assert (
        result.extracted.source_evidence.relationship_families[evidence_family].status == "partial"
    )
    assert result.normalized_snapshot[snapshot_key] == [99]


def test_malformed_dlc_member_is_partial_and_preserves_previous():
    payload = build_payload()
    payload["extended"]["listofdlc"] = "10,not-an-id"

    result = validate_pics_product_payload(
        appid=730,
        claimed_through_change_number=100,
        raw_payload=payload,
        previous_snapshot={"dlc_appids": [42]},
    )

    assert result.extracted.source_evidence is not None
    assert result.extracted.source_evidence.relationship_families["dlc"].status == "partial"
    assert result.normalized_snapshot["dlc_appids"] == [42]


def test_stale_product_payload_is_retryable():
    with pytest.raises(PICSPayloadValidationError) as raised:
        validate_pics_product_payload(
            appid=730,
            claimed_through_change_number=121,
            raw_payload=build_payload(change_number=120),
        )

    assert raised.value.error_code == "stale_product_payload"
    assert raised.value.retryable is True


def test_raw_payload_hash_and_archive_document_are_deterministic():
    first = validate_pics_product_payload(
        appid=730,
        claimed_through_change_number=100,
        raw_payload=build_payload(),
    )
    reordered = deepcopy(build_payload())
    reordered["common"] = dict(reversed(list(reordered["common"].items())))
    second = validate_pics_product_payload(
        appid=730,
        claimed_through_change_number=100,
        raw_payload=reordered,
    )

    assert first.raw_payload_sha256 == second.raw_payload_sha256
    assert first.normalized_snapshot_sha256 == second.normalized_snapshot_sha256
    assert first.archive_document == second.archive_document


def test_unix_timestamps_are_normalized_to_utc():
    result = validate_pics_product_payload(
        appid=730,
        claimed_through_change_number=100,
        raw_payload=build_payload(),
    )

    assert result.normalized_snapshot["last_content_update"] == "2023-11-14T22:13:20+00:00"
