import copy
import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest

from src.database.durable_intake import PICSSourceAppChange, hash_pics_app_changes

spec = importlib.util.spec_from_file_location(
    "verify_successor_evidence", Path(__file__).parents[1] / "scripts/verify_successor_evidence.py"
)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def fixture(empty=False):
    changes = [] if empty else [PICSSourceAppChange(7, 20, False), PICSSourceAppChange(7, 21, True)]
    batch = dict(
        id=uuid4(),
        stream_key="shadow-test",
        work_mode="shadow",
        lane="live",
        from_change_number=19,
        to_change_number=21,
        response_since_change_number=19,
        source_app_count=len(changes),
        durable_app_count=len(changes),
        distinct_app_count=int(bool(changes)),
        app_changes_sha256=hash_pics_app_changes(changes),
        force_full_update=False,
        force_full_app_update=False,
        force_full_package_update=False,
        archive_content_hash="a" * 64,
    )
    document = {
        key: value
        for key, value in batch.items()
        if key not in {"id", "durable_app_count", "archive_content_hash"}
    }
    document["_archive_schema_version"] = "pics-change-response/v2"
    document["app_changes"] = [
        dict(
            source_index=i,
            appid=item.appid,
            change_number=item.change_number,
            needs_token=item.needs_token,
        )
        for i, item in enumerate(changes)
    ]
    children = [
        dict(
            source_index=i,
            appid=item.appid,
            source_change_number=item.change_number,
            needs_token=item.needs_token,
        )
        for i, item in enumerate(changes)
    ]
    return batch, document, children


@pytest.mark.parametrize("empty", [False, True])
def test_verifier_preserves_empty_and_duplicate_source_positions(empty):
    batch, document, children = fixture(empty)
    report = verifier.verify_batch_document(batch, document, children)
    assert report["verified"] and report["count"] == len(children)
    assert report["manifestSha256"] == batch["app_changes_sha256"]


@pytest.mark.parametrize(
    "mutation", ["token", "position", "flag", "count", "integer", "hash", "missing"]
)
def test_verifier_rejects_corrupt_source_evidence(mutation):
    batch, source, children = fixture()
    document = copy.deepcopy(source)
    if mutation == "token":
        document["app_changes"][1]["needs_token"] = False
    if mutation == "position":
        document["app_changes"].reverse()
    if mutation == "flag":
        document["force_full_app_update"] = True
    if mutation == "count":
        document["app_changes"].pop()
    if mutation == "integer":
        document["app_changes"][0]["source_index"] = False
    if mutation == "hash":
        document["app_changes_sha256"] = "f" * 64
    if mutation == "missing":
        del document["force_full_update"]
    with pytest.raises(ValueError):
        verifier.verify_batch_document(batch, document, children)
