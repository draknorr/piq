import json
import sys
from datetime import datetime, timezone

import pytest

from src import replay_missing_access_tokens as replay_module
from src.database.durable_work import PICSTokenReplayCandidate
from src.database.tiger_change_history import ArchivePointer


class FakeWorkStore:
    def __init__(self):
        self.requeues = []

    def preview_missing_access_token_replay(self, *, appids, limit):
        assert appids == [5005180]
        assert limit == 1
        return [
            PICSTokenReplayCandidate(
                work_id=41,
                appid=5005180,
                stream_key="primary",
                lane="live",
                latest_change_number=37667191,
                needs_token=True,
                blocked_at=datetime(2026, 7, 31, tzinfo=timezone.utc),
                storefront_status="ready",
                storefront_source_at=datetime(2026, 7, 31, tzinfo=timezone.utc),
                storefront_field_coverage={"genres": "known"},
                storefront_snapshot_summary={"genreCount": 3},
            )
        ]

    def requeue_missing_access_token(self, **kwargs):
        self.requeues.append(kwargs)
        return 1


class FakeArchiveStore:
    def __init__(self):
        self.writes = []

    def write_json(self, **kwargs):
        self.writes.append(kwargs)
        return ArchivePointer(
            bucket="test-bucket",
            key="replays/5005180.json",
            content_hash="a" * 64,
            byte_size=100,
            content_type="application/json",
        )


def _configure(monkeypatch):
    store = FakeWorkStore()
    archive = FakeArchiveStore()
    monkeypatch.setattr(
        replay_module.TigerPICSDurableWorkStore,
        "from_settings",
        staticmethod(lambda _settings: store),
    )
    monkeypatch.setattr(
        replay_module.S3ArchiveStore,
        "from_env",
        staticmethod(lambda: archive),
    )
    return store, archive


def test_token_replay_defaults_to_read_only_and_prints_a_review_hash(
    monkeypatch,
    capsys,
):
    store, archive = _configure(monkeypatch)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "replay_missing_access_tokens",
            "--appid",
            "5005180",
            "--limit",
            "1",
            "--requested-by",
            "operator@example.com",
            "--reason",
            "incident-5005180",
        ],
    )

    replay_module.main()

    output = json.loads(capsys.readouterr().out)
    assert output["dryRun"] is True
    assert len(output["planSha256"]) == 64
    assert output["exactAppids"] == [5005180]
    assert archive.writes == []
    assert store.requeues == []


def test_token_replay_requires_the_fresh_exact_dry_run_hash(
    monkeypatch,
):
    store, archive = _configure(monkeypatch)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "replay_missing_access_tokens",
            "--appid",
            "5005180",
            "--limit",
            "1",
            "--apply",
            "--execute-plan-sha256",
            "0" * 64,
        ],
    )

    with pytest.raises(RuntimeError, match="fresh exact-app dry-run"):
        replay_module.main()

    assert archive.writes == []
    assert store.requeues == []


def test_token_replay_archives_and_requeues_only_the_reviewed_plan(
    monkeypatch,
    capsys,
):
    store, archive = _configure(monkeypatch)
    common_args = [
        "--appid",
        "5005180",
        "--limit",
        "1",
        "--requested-by",
        "operator@example.com",
        "--reason",
        "incident-5005180",
    ]
    monkeypatch.setattr(
        sys,
        "argv",
        ["replay_missing_access_tokens", *common_args],
    )
    replay_module.main()
    plan_sha256 = json.loads(capsys.readouterr().out)["planSha256"]
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "replay_missing_access_tokens",
            *common_args,
            "--apply",
            "--execute-plan-sha256",
            plan_sha256,
        ],
    )

    replay_module.main()

    output = json.loads(capsys.readouterr().out)
    assert output["requeued"] == 1
    assert output["planSha256"] == plan_sha256
    assert archive.writes[0]["payload"]["planSha256"] == plan_sha256
    assert store.requeues[0]["appids"] == [5005180]
