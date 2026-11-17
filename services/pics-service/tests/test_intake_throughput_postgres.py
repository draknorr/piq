"""Queue coalescing against a disposable local database, never a production URL."""

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import psycopg
import pytest

from src.database.durable_intake import (
    PICSArchiveReference,
    PICSSourceAppChange,
    TigerPICSDurableIntakeStore,
)


def test_intake_keeps_queue_position_backoff_and_active_claims():
    url = os.getenv("PICS_THROUGHPUT_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Requires an explicitly supplied disposable local PostgreSQL database")
    target = urlparse(url)
    assert target.hostname in {"127.0.0.1", "localhost"}
    assert target.path == "/pics_throughput_test"
    sql_root = Path(__file__).resolve().parents[3] / "packages/data-plane/sql/tiger-bootstrap"
    with psycopg.connect(url, autocommit=True) as db:
        # Refuse a reused fixture; do not erase existing tables or data.
        db.execute("""CREATE EXTENSION pgcrypto;
            CREATE SCHEMA ops; CREATE SCHEMA docs; CREATE SCHEMA legacy;
            CREATE TABLE legacy.apps(appid integer PRIMARY KEY);
            CREATE TABLE docs.app_source_snapshots(id bigint PRIMARY KEY);
            CREATE TABLE ops.pics_sync_state(id integer PRIMARY KEY,
                last_change_number bigint, updated_at timestamptz DEFAULT now());
            CREATE TABLE ops.sync_status(appid integer PRIMARY KEY,last_pics_sync timestamptz);
            CREATE TABLE ops.app_catalog_state(appid integer PRIMARY KEY,
                first_observation_kind text);
            CREATE TABLE ops.pics_reconciliation_successors(run_id uuid PRIMARY KEY,
                catchup_paused boolean DEFAULT true);
            INSERT INTO ops.pics_sync_state(id,last_change_number) VALUES(1,0);""")
        db.execute((sql_root / "0088_durable_pics_intake.sql").read_text())
        db.execute(
            (sql_root / "0092_pics_cursor_checkpoint_reconciliation.sql")
            .read_text()
            .split("CREATE OR REPLACE VIEW")[0]
        )
        db.execute("""ALTER TABLE ops.pics_work_state
            ADD COLUMN needs_token boolean DEFAULT false,
            ADD COLUMN claimed_needs_token boolean;""")

    store = TigerPICSDurableIntakeStore(url, connection_factory=lambda: psycopg.connect(url))
    observed = datetime.now(timezone.utc)

    def admit(start, end, changes):
        return store.persist_batch(
            archive=PICSArchiveReference(
                "local", f"batch-{end}", "a" * 64, 123, "application/json"
            ),
            from_change_number=start,
            to_change_number=end,
            response_since_change_number=start,
            app_changes=changes,
            force_full_update=False,
            force_full_app_update=False,
            force_full_package_update=False,
            lane="live",
            work_mode="durable",
            stream_key="primary",
            received_at=observed + timedelta(seconds=end),
        )

    states = ("pending", "retrying", "claimed", "completed", "source_blocked", "dead_letter")
    first = admit(0, 10, [PICSSourceAppChange(i, 10, False) for i in range(1, 7)])
    past = observed - timedelta(hours=12)
    future = observed + timedelta(hours=1)
    with psycopg.connect(url) as db:
        for appid, state in enumerate(states, 1):
            due = future if state == "retrying" else past
            db.execute(
                """UPDATE ops.pics_work_state SET state=%s, next_attempt_at=%s,
                dirty_since=%s, attempts=2,
                claimed_at=CASE WHEN %s='claimed' THEN now() END,
                worker_id=CASE WHEN %s='claimed' THEN 'owner' END,
                claim_expires_at=CASE WHEN %s='claimed' THEN now()+interval '5 minutes' END,
                claimed_through_change_number=CASE WHEN %s='claimed' THEN 10 END,
                claimed_needs_token=CASE WHEN %s='claimed' THEN false END,
                dead_lettered_at=CASE WHEN %s='dead_letter' THEN now() END
                WHERE appid=%s""",
                (state, due, past, *([state] * 6), appid),
            )
        db.execute("UPDATE ops.app_data_readiness SET status='ready', retryable=false")
        before = db.execute(
            "SELECT appid,row_to_json(w)::text FROM ops.pics_work_state w ORDER BY appid"
        ).fetchall()
        readiness = db.execute(
            "SELECT appid,row_to_json(r)::text FROM ops.app_data_readiness r ORDER BY appid"
        ).fetchall()

    # An idempotent replay of the same audited batch does not reopen settled work.
    replay = admit(0, 10, [PICSSourceAppChange(i, 10, False) for i in range(1, 7)])
    assert replay.idempotent_replay and replay.batch_id == first.batch_id
    with psycopg.connect(url) as db:
        assert (
            db.execute(
                "SELECT appid,row_to_json(w)::text FROM ops.pics_work_state w ORDER BY appid"
            ).fetchall()
            == before
        )
        assert (
            db.execute(
                "SELECT appid,row_to_json(r)::text FROM ops.app_data_readiness r ORDER BY appid"
            ).fetchall()
            == readiness
        )
    newer = admit(10, 40, [PICSSourceAppChange(i, 40, False) for i in range(1, 7)])
    with psycopg.connect(url) as db:
        rows = db.execute(
            "SELECT appid,state,next_attempt_at,dirty_since,latest_change_number,"
            "attempts,worker_id,claimed_through_change_number,latest_batch_id "
            "FROM ops.pics_work_state ORDER BY appid"
        ).fetchall()
        for appid, state, due, dirty, change, attempts, owner, claimed, batch in rows:
            assert change == 40 and batch == newer.batch_id and dirty == past
            if appid <= 3:
                assert due == (future if appid == 2 else past)
                assert attempts == 2
            else:
                assert due >= observed and attempts == 0
            assert state == ("claimed" if appid == 3 else "pending")
            assert owner == ("owner" if appid == 3 else None)
            assert claimed == (10 if appid == 3 else None)
        assert db.execute(
            "SELECT count(*) FROM ops.app_data_readiness WHERE status='pending'"
        ).fetchone() == (6,)
        # A refreshed old pending app keeps its place ahead of newly admitted work.
        ordered = db.execute(
            "SELECT appid FROM ops.pics_work_state WHERE state='pending' "
            "AND next_attempt_at <= now() ORDER BY priority DESC, "
            "next_attempt_at,dirty_since,id LIMIT 1"
        ).fetchone()
        assert ordered == (1,)

    # Further changes coalesce onto the leased row, preserving the claimed version.
    token = admit(40, 50, [PICSSourceAppChange(3, 50, True)])
    with psycopg.connect(url) as db:
        assert db.execute(
            "SELECT needs_token,latest_batch_id,claimed_needs_token,"
            "claimed_through_change_number,state FROM ops.pics_work_state "
            "WHERE appid=3"
        ).fetchone() == (True, token.batch_id, False, 10, "claimed")
        assert db.execute("SELECT count(*) FROM ops.pics_change_batch_apps").fetchone() == (13,)
        assert db.execute("SELECT last_change_number FROM ops.pics_sync_state").fetchone() == (50,)

    # Exercise the drain promotion pipeline on real PostgreSQL. The statement
    # bodies and transaction boundary stay identical. Count queued statements
    # and explicit fetch dependencies without a timing-sensitive assertion.
    from contextlib import nullcontext

    from src.database.durable_payload import validate_pics_product_payload
    from src.database.durable_promotion import TigerPICSDurablePromoter

    with psycopg.connect(url, autocommit=True) as db:
        db.execute("""
            ALTER TABLE legacy.apps ADD COLUMN name text, ADD COLUMN type text,
                ADD COLUMN updated_at timestamptz;
            ALTER TABLE ops.sync_status ADD COLUMN pics_change_number bigint,
                ADD COLUMN updated_at timestamptz;
            CREATE TABLE legacy.steam_categories(category_id integer PRIMARY KEY,name text);
            CREATE TABLE legacy.app_categories(appid integer,category_id integer,
                PRIMARY KEY(appid,category_id));
            CREATE TABLE legacy.steam_genres(genre_id integer PRIMARY KEY,name text);
            CREATE TABLE legacy.app_genres(appid integer,genre_id integer,is_primary boolean,
                PRIMARY KEY(appid,genre_id));
            CREATE TABLE legacy.steam_tags(tag_id integer PRIMARY KEY,
                name text,updated_at timestamptz);
            CREATE TABLE legacy.app_steam_tags(appid integer,tag_id integer,rank integer,
                PRIMARY KEY(appid,tag_id));
            CREATE TABLE legacy.app_franchises(appid integer,franchise_id bigint,
                PRIMARY KEY(appid,franchise_id));
            CREATE TABLE legacy.app_dlc(parent_appid integer,dlc_appid integer,source text,
                PRIMARY KEY(parent_appid,dlc_appid));
            CREATE TABLE ops.app_field_evidence(appid integer,field_name text,source text,
                evidence_state text,value jsonb,source_at timestamptz,version text,provenance jsonb,
                created_at timestamptz,updated_at timestamptz,PRIMARY KEY(appid,field_name,source));
            """)
    raw = {
        "appid": 7,
        "_change_number": 50,
        "_missing_token": False,
        "_sha": "a" * 40,
        "_size": 100,
        "common": {
            "name": "Pipeline test",
            "type": "game",
            "category": {"1": "1"},
            "genres": {"0": "1"},
            "store_tags": {"0": "123"},
            "associations": {},
        },
        "extended": {"listofdlc": "8,9"},
        "config": {},
        "depots": {},
    }
    payload = validate_pics_product_payload(
        appid=7, claimed_through_change_number=50, raw_payload=raw
    )
    snapshots = []
    calls = []

    class RollbackFixtureError(Exception):
        pass

    class CountingCursor(psycopg.Cursor):
        def execute(self, *args, **kwargs):
            self.execute_calls = getattr(self, "execute_calls", 0) + 1
            return super().execute(*args, **kwargs)

        def fetchone(self):
            self.fetch_calls = getattr(self, "fetch_calls", 0) + 1
            return super().fetchone()

    for pipeline in (False, True):
        with psycopg.connect(url, autocommit=True, cursor_factory=CountingCursor) as db:
            expected_error = psycopg.errors.DivisionByZero if pipeline else RollbackFixtureError
            with pytest.raises(expected_error):
                with db.transaction():
                    with db.pipeline() if pipeline else nullcontext():
                        with db.cursor() as cursor:
                            TigerPICSDurablePromoter._apply_relationships(cursor, payload.extracted)
                            TigerPICSDurablePromoter._record_field_evidence(
                                cursor,
                                app=payload.extracted,
                                source_change_number=50,
                                source_at=observed,
                            )
                            TigerPICSDurablePromoter._update_sync_status(
                                cursor, appid=7, change_number=50
                            )
                            calls.append((cursor.execute_calls, cursor.fetch_calls))
                    # Pipeline exit must flush before a following readiness/ack statement.
                    snapshots.append(
                        (
                            db.execute(
                                "SELECT tag_id,rank FROM legacy.app_steam_tags "
                                "WHERE appid=7 ORDER BY rank"
                            ).fetchall(),
                            db.execute(
                                "SELECT field_name,value FROM ops.app_field_evidence "
                                "WHERE appid=7 ORDER BY field_name"
                            ).fetchall(),
                            db.execute(
                                "SELECT pics_change_number FROM ops.sync_status WHERE appid=7"
                            ).fetchone(),
                        )
                    )
                    if pipeline:
                        # A server-side failure after queued writes rolls back every write.
                        with db.pipeline():
                            db.execute(
                                "UPDATE ops.sync_status SET pics_change_number=999 WHERE appid=7"
                            )
                            db.execute("SELECT 1/0")
                    raise RollbackFixtureError()
            assert db.execute("SELECT count(*) FROM ops.sync_status WHERE appid=7").fetchone() == (
                0,
            )
            assert db.execute("SELECT count(*) FROM ops.app_field_evidence").fetchone() == (0,)
    assert snapshots[0] == snapshots[1]
    assert snapshots[0][0] == [(123, 0)]
    assert snapshots[0][2] == (50,)
    assert calls[0] == calls[1]
    assert calls[1][0] >= 12 and calls[1][1] == 1
    print(f"relationship/evidence statements and fetch dependencies: {calls}")

    # Verify the actual SQL store can supply a full pass: an old independent
    # 500-row claim clamp and pointer lookup bound must not halve the new quota.
    from src.database.durable_work import TigerPICSDurableWorkStore

    admit(50, 60, [PICSSourceAppChange(i, 60, False) for i in range(10000, 11000)])
    work = TigerPICSDurableWorkStore(url, connection_factory=lambda: psycopg.connect(url))
    claims = work.claim_work(
        work_mode="durable",
        stream_key="primary",
        worker_id="large-pass",
        lane_group="live",
        limit=1000,
        lease_seconds=300,
    )
    assert len(claims) == len({c.appid for c in claims}) == 1000
    with psycopg.connect(url) as db:
        db.execute("""ALTER TABLE docs.app_source_snapshots ADD COLUMN appid integer,
            ADD COLUMN source text, ADD COLUMN content_hash text, ADD COLUMN archive_bucket text,
            ADD COLUMN archive_key text, ADD COLUMN archive_content_hash text,
            ADD COLUMN first_seen_at timestamptz DEFAULT now();""")
        db.execute(
            """INSERT INTO docs.app_source_snapshots(id,appid,source,content_hash,
            archive_bucket,archive_key,archive_content_hash)
            SELECT appid,appid,'pics',%s,'local','prior/'||appid,%s
            FROM unnest(%s::int[]) appid""",
            ("c" * 64, "a" * 64, [c.appid for c in claims]),
        )
    pointers = work.get_latest_snapshots([c.appid for c in claims])
    assert len(pointers) == 1000
    assert set(pointers) == {c.appid for c in claims}
    assert work.heartbeat_claims(claims=claims, worker_id="large-pass", lease_seconds=300) == 1000
    with pytest.raises(ValueError, match="At most 1000"):
        work.get_latest_snapshots(list(range(1, 1002)))
