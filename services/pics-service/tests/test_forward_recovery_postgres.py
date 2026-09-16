"""Opt-in tests against a newly created, disposable local PostgreSQL database."""

import hashlib
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse

import psycopg
import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.database.durable_intake import (  # noqa: E402
    PICSArchiveReference,
    PICSForwardRecovery,
    PICSSourceAppChange,
    TigerPICSDurableIntakeStore,
)


def test_postgres_recovery_rollback_concurrency_and_exact_head(monkeypatch):
    url = os.getenv("PICS_RECOVERY_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requires an explicitly supplied disposable local PostgreSQL database")
    target = urlparse(url)
    assert target.hostname in {"127.0.0.1", "localhost"}
    assert target.path == "/pics_recovery_test"
    sql_root = ROOT / "packages/data-plane/sql/tiger-bootstrap"
    with psycopg.connect(url, autocommit=True) as db:
        # Plain CREATE deliberately refuses a reused fixture instead of deleting data.
        db.execute(
            """CREATE EXTENSION pgcrypto;
            CREATE SCHEMA ops; CREATE SCHEMA docs; CREATE SCHEMA legacy;
            CREATE TABLE legacy.apps(appid integer PRIMARY KEY);
            CREATE TABLE docs.app_source_snapshots(id bigint PRIMARY KEY);
            CREATE TABLE ops.pics_sync_state(id integer PRIMARY KEY,
                last_change_number bigint,updated_at timestamptz DEFAULT now());
            CREATE TABLE ops.sync_status(appid integer PRIMARY KEY,last_pics_sync timestamptz);
            CREATE TABLE ops.app_catalog_state(appid integer PRIMARY KEY,
                first_observation_kind text);
            INSERT INTO ops.pics_sync_state(id,last_change_number) VALUES(1,10);"""
        )
        db.execute((sql_root / "0088_durable_pics_intake.sql").read_text())
        db.execute(
            (sql_root / "0092_pics_cursor_checkpoint_reconciliation.sql")
            .read_text()
            .split("CREATE OR REPLACE VIEW")[0]
        )
        db.execute(
            """ALTER TABLE ops.pics_work_state ADD COLUMN needs_token boolean DEFAULT false,
            ADD COLUMN claimed_needs_token boolean;"""
        )

    store = TigerPICSDurableIntakeStore(url, connection_factory=lambda: psycopg.connect(url))
    archive = PICSArchiveReference("test", "gap", "a" * 64, 123, "application/json")
    common = dict(force_full_update=False, force_full_package_update=False, lane="live")
    gap = store.persist_batch(
        archive=archive,
        from_change_number=10,
        to_change_number=20,
        response_since_change_number=10,
        app_changes=[],
        force_full_app_update=True,
        work_mode="durable",
        stream_key="primary",
        **common,
    )
    changes = [
        PICSSourceAppChange(7, 21, False),
        PICSSourceAppChange(7, 22, True),
        PICSSourceAppChange(9, 30, False),
    ]
    head_archive = PICSArchiveReference("test", "head", "b" * 64, 456, "application/json")
    head_args = dict(
        archive=head_archive,
        from_change_number=20,
        to_change_number=30,
        response_since_change_number=20,
        app_changes=changes,
        force_full_app_update=False,
        **common,
    )
    head = store.persist_batch(work_mode="shadow", stream_key="forward-test", **head_args)
    evidence = store.read_forward_recovery_evidence(gap.batch_id, head.batch_id)
    recovery = PICSForwardRecovery(*evidence, "local integration", datetime.now(timezone.utc))

    def apply():
        return store.persist_batch(
            work_mode="durable", stream_key="primary", forward_recovery=recovery, **head_args
        )

    original = store._mark_pics_readiness_pending

    def abort_after_admission(cursor, **_kwargs):
        cursor.execute("SELECT 1/0")

    monkeypatch.setattr(store, "_mark_pics_readiness_pending", abort_after_admission)
    with pytest.raises(psycopg.errors.DivisionByZero):
        apply()
    with psycopg.connect(url) as db:
        assert db.execute(
            "SELECT last_change_number FROM ops.pics_sync_state WHERE id=1"
        ).fetchone() == (10,)
        assert db.execute("SELECT count(*) FROM ops.pics_cursor_checkpoints").fetchone() == (0,)
        assert db.execute(
            "SELECT count(*) FROM ops.pics_work_state WHERE stream_key='primary'"
        ).fetchone() == (0,)
        assert db.execute("SELECT count(*) FROM ops.pics_change_batches").fetchone() == (2,)
    monkeypatch.setattr(store, "_mark_pics_readiness_pending", original)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: apply(), range(2)))
    assert sorted(result.idempotent_replay for result in results) == [False, True]
    assert len({result.batch_id for result in results}) == 1
    with psycopg.connect(url) as db:
        assert db.execute(
            "SELECT last_change_number FROM ops.pics_sync_state WHERE id=1"
        ).fetchone() == (30,)
        assert db.execute(
            "SELECT from_change_number,to_change_number FROM ops.pics_cursor_checkpoints"
        ).fetchall() == [(10, 20)]
        assert db.execute(
            "SELECT appid,latest_change_number,needs_token FROM ops.pics_work_state "
            "WHERE stream_key='primary' ORDER BY appid"
        ).fetchall() == [(7, 22, True), (9, 30, False)]
        assert db.execute(
            "SELECT source_index,appid,source_change_number,needs_token "
            "FROM ops.pics_change_batch_apps WHERE batch_id=%s ORDER BY source_index",
            (results[0].batch_id,),
        ).fetchall() == [(0, 7, 21, False), (1, 7, 22, True), (2, 9, 30, False)]

    # Exercise the complete worker path with real SQL and hash-checked local
    # archive bodies. No Steam calls or production archive writes are involved.
    from src.config.settings import settings
    from src.workers.durable_change_intake import (
        DurableChangeIntakeWorker,
        IncompletePICSChangeResponseError,
    )

    class MemoryArchive:
        documents = {}

        def write_json(self, **kwargs):
            payload = kwargs["payload"]
            body = json.dumps(payload, sort_keys=True).encode()
            digest = hashlib.sha256(body).hexdigest()
            self.documents[digest] = body
            return SimpleNamespace(
                bucket="local",
                key=digest,
                content_hash=digest,
                byte_size=len(body),
                content_type="application/json",
            )

        def read_json_verified(self, **kwargs):
            body = self.documents[kwargs["key"]]
            assert len(body) == kwargs["expected_byte_size"]
            assert hashlib.sha256(body).hexdigest() == kwargs["expected_content_hash"]
            return json.loads(body)

    def response(since):
        return SimpleNamespace(
            change_number=40 if since == 30 else 50,
            since_change_number=since,
            force_full_update=False,
            force_full_app_update=since == 30,
            force_full_package_update=False,
            app_change_details=[] if since == 30 else [PICSSourceAppChange(9, 50, True)],
            package_changes=[],
        )

    monkeypatch.setattr(settings, "pics_forward_recovery_enabled", True)
    monkeypatch.setattr(settings, "pics_forward_recovery_requested_by", "local integration")
    worker = DurableChangeIntakeWorker.__new__(DurableChangeIntakeWorker)
    worker._store = store
    worker._archive_store = MemoryArchive()
    worker._work_mode = "durable"
    worker._stream_key = "primary"
    worker._lane = "live"
    worker._processing_job = None
    worker._forward_recovery_gap = None
    worker._forward_recovery_next_attempt = 0
    worker._consecutive_poll_failures = 3
    worker._fetcher = SimpleNamespace(get_changes_since=response)
    with pytest.raises(IncompletePICSChangeResponseError):
        worker.poll_once(30)
    assert worker._try_forward_recovery(30) == 50
    with psycopg.connect(url) as db:
        assert db.execute(
            "SELECT last_change_number FROM ops.pics_sync_state WHERE id=1"
        ).fetchone() == (50,)
        assert db.execute("SELECT count(*) FROM ops.pics_cursor_checkpoints").fetchone() == (2,)
        assert db.execute(
            "SELECT latest_change_number,needs_token FROM ops.pics_work_state "
            "WHERE stream_key='primary' AND appid=9"
        ).fetchone() == (50, True)
