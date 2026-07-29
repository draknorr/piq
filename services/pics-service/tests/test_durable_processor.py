import threading
import time
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import gevent
import pytest

from src.database.durable_work import PICSWorkClaim
from src.database.tiger_change_history import ArchivePointer
from src.workers.durable_processor import DurablePICSProcessor


def make_claim(*, appid=7, attempts=1):
    return PICSWorkClaim(
        id=41,
        appid=appid,
        stream_key="shadow-test",
        work_mode="shadow",
        lane="live",
        priority=200,
        claimed_through_change_number=20,
        attempts=attempts,
        max_attempts=3,
        claim_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        worker_id="test-worker",
    )


def make_payload(*, appid=7, missing_token=False):
    return {
        "appid": appid,
        "_change_number": 20,
        "_missing_token": missing_token,
        "_sha": "a" * 40,
        "_size": 100,
        "common": {
            "name": "Test app",
            "type": "game",
            "category": {},
            "genres": {},
            "store_tags": {},
            "associations": {},
        },
        "extended": {"listofdlc": ""},
        "config": {},
        "depots": {},
    }


class FakeFetcher:
    def __init__(self, payload):
        self.payload = payload
        self.requested = []

    def fetch_apps_batch(self, appids):
        self.requested.append(appids)
        return {appids[0]: self.payload}


class FailingFetcher:
    def fetch_apps_batch(self, _appids):
        raise RuntimeError("Steam unavailable")


class FakeArchiveStore:
    def __init__(self):
        self.writes = []

    def write_json(self, **kwargs):
        self.writes.append(kwargs)
        return ArchivePointer(
            bucket="test-bucket",
            byte_size=10,
            content_hash="b" * 64,
            content_type="application/json",
            key=f"test/{len(self.writes)}.json",
        )

    def read_json(self, **_kwargs):
        raise AssertionError("No previous snapshot should be read")


class FailingArchiveStore(FakeArchiveStore):
    def write_json(self, **kwargs):
        self.writes.append(kwargs)
        raise RuntimeError("R2 unavailable")


class FakeWorkStore:
    def __init__(self, claim):
        self.claim = claim
        self.claim_calls = []
        self.heartbeats = []
        self.completed = []
        self.blocked = []
        self.failed = []
        self.latest_snapshot_calls = []

    def claim_work(self, **kwargs):
        self.claim_calls.append(kwargs)
        return [self.claim] if kwargs["lane_group"] == "live" else []

    def heartbeat_claims(self, **kwargs):
        self.heartbeats.append(kwargs)
        return len(kwargs["claims"])

    def get_latest_snapshots(self, appids):
        self.latest_snapshot_calls.append(list(appids))
        return {}

    def complete_shadow_claim(self, **kwargs):
        self.completed.append(kwargs)
        return "completed"

    def block_claim(self, **kwargs):
        self.blocked.append(kwargs)

    def fail_claim(self, **kwargs):
        self.failed.append(kwargs)
        claim = kwargs["claim"]
        return "retrying" if claim.attempts < claim.max_attempts else "dead_letter"


class FailingSettlementWorkStore(FakeWorkStore):
    def complete_shadow_claim(self, **kwargs):
        self.completed.append(kwargs)
        raise RuntimeError("Tiger settlement unavailable")


def test_processor_rejects_product_batches_above_existing_cap(monkeypatch):
    monkeypatch.setattr(
        "src.workers.durable_processor.settings.pics_consumer_live_batch_size",
        40,
    )
    monkeypatch.setattr(
        "src.workers.durable_processor.settings.pics_consumer_catchup_batch_size",
        161,
    )

    with pytest.raises(ValueError, match="cannot exceed 200"):
        DurablePICSProcessor(
            work_mode="shadow",
            stream_key="shadow-test",
            work_store=FakeWorkStore(make_claim()),
            archive_store=FakeArchiveStore(),
            worker_id="test-worker",
        )


def test_shadow_processor_validates_archives_and_acknowledges_without_promoting():
    claim = make_claim()
    work_store = FakeWorkStore(claim)
    archive_store = FakeArchiveStore()
    fetcher = FakeFetcher(make_payload())
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=archive_store,
        worker_id="test-worker",
    )

    stats = processor.process_once(fetcher)

    assert stats.claimed == 1
    assert stats.completed == 1
    assert stats.snapshots_changed == 1
    assert stats.events_created == 0
    assert fetcher.requested == [[7]]
    assert len(work_store.heartbeats) == 2
    assert work_store.latest_snapshot_calls == [[7]]
    assert len(work_store.completed) == 1
    assert len(work_store.blocked) == 0
    assert len(work_store.failed) == 0
    assert archive_store.writes[0]["kind"] == "pics-product-payload"
    assert [call["lane_group"] for call in work_store.claim_calls] == [
        "live",
        "catchup",
    ]


def test_missing_access_token_is_archived_and_source_blocked():
    claim = make_claim()
    work_store = FakeWorkStore(claim)
    archive_store = FakeArchiveStore()
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=archive_store,
        worker_id="test-worker",
    )

    stats = processor.process_once(FakeFetcher(make_payload(missing_token=True)))

    assert stats.source_blocked == 1
    assert stats.completed == 0
    assert len(work_store.blocked) == 1
    assert work_store.blocked[0]["blocking_reason"] == "missing_access_token"
    assert archive_store.writes[0]["kind"] == "pics-product-payload-blocked"


def test_missing_product_response_is_retried():
    claim = make_claim()
    work_store = FakeWorkStore(claim)
    archive_store = FakeArchiveStore()
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=archive_store,
        worker_id="test-worker",
    )

    stats = processor.process_once(FakeFetcher(None))

    assert stats.retried == 1
    assert stats.completed == 0
    assert len(work_store.failed) == 1
    assert work_store.failed[0]["error_code"] == "payload_missing"
    assert work_store.failed[0]["retryable"] is True


def test_final_missing_product_response_is_archived_and_source_blocked():
    claim = make_claim(attempts=3)
    work_store = FakeWorkStore(claim)
    archive_store = FakeArchiveStore()
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=archive_store,
        worker_id="test-worker",
    )

    stats = processor.process_once(FakeFetcher(None))

    assert stats.source_blocked == 1
    assert stats.retried == 0
    assert stats.dead_lettered == 0
    assert stats.completed == 0
    assert len(work_store.failed) == 0
    assert len(work_store.blocked) == 1
    assert work_store.blocked[0]["blocking_reason"] == "payload_missing"
    assert work_store.blocked[0]["provenance"]["archive"]["key"] == "test/1.json"
    assert archive_store.writes[0]["kind"] == "pics-product-payload-blocked"
    blocked_document = archive_store.writes[0]["payload"]
    assert blocked_document["appid"] == 7
    assert blocked_document["attempts"] == 3
    assert blocked_document["max_attempts"] == 3
    assert blocked_document["error_code"] == "payload_missing"
    assert blocked_document["raw_payload"] is None


def test_other_final_retryable_validation_error_still_dead_letters():
    claim = make_claim(attempts=3)
    work_store = FakeWorkStore(claim)
    archive_store = FakeArchiveStore()
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=archive_store,
        worker_id="test-worker",
    )

    stats = processor.process_once(FakeFetcher(make_payload(appid=8)))

    assert stats.source_blocked == 0
    assert stats.retried == 0
    assert stats.dead_lettered == 1
    assert len(work_store.blocked) == 0
    assert len(work_store.failed) == 1
    assert work_store.failed[0]["error_code"] == "appid_mismatch"
    assert archive_store.writes == []


def test_final_missing_product_response_requires_durable_archive_evidence():
    claim = make_claim(attempts=3)
    work_store = FakeWorkStore(claim)
    archive_store = FailingArchiveStore()
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=archive_store,
        worker_id="test-worker",
    )

    with pytest.raises(RuntimeError, match="R2 unavailable"):
        processor.process_once(FakeFetcher(None))

    assert len(archive_store.writes) == 1
    assert len(work_store.blocked) == 0
    assert len(work_store.failed) == 0


def test_valid_payload_r2_failure_releases_claim_without_acknowledgement():
    claim = make_claim()
    work_store = FakeWorkStore(claim)
    archive_store = FailingArchiveStore()
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=archive_store,
        worker_id="test-worker",
    )

    stats = processor.process_once(FakeFetcher(make_payload()))

    assert stats.retried == 1
    assert stats.completed == 0
    assert len(work_store.completed) == 0
    assert len(work_store.failed) == 1
    assert work_store.failed[0]["error_code"] == "processing_error"
    assert stats.phase_latency_seconds["r2_write"]["count"] == 1


def test_tiger_settlement_failure_releases_claim_and_retains_archive():
    claim = make_claim()
    work_store = FailingSettlementWorkStore(claim)
    archive_store = FakeArchiveStore()
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=archive_store,
        worker_id="test-worker",
    )

    stats = processor.process_once(FakeFetcher(make_payload()))

    assert stats.retried == 1
    assert stats.completed == 0
    assert len(archive_store.writes) == 1
    assert len(work_store.completed) == 1
    assert len(work_store.failed) == 1
    assert stats.r2_writes == 1
    assert stats.phase_latency_seconds["tiger_shadow_settlement"]["count"] == 1


def test_batch_fetch_failure_releases_claim_for_bounded_retry():
    claim = make_claim()
    work_store = FakeWorkStore(claim)
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=FakeArchiveStore(),
        worker_id="test-worker",
    )

    stats = processor.process_once(FailingFetcher())

    assert stats.claimed == 1
    assert stats.retried == 1
    assert stats.completed == 0
    assert len(work_store.failed) == 1
    assert work_store.failed[0]["error_code"] == "product_fetch_failed"


def test_unprocessed_leases_use_batched_barrier_heartbeats():
    first = make_claim(appid=7)
    second = replace(first, id=42, appid=8)
    work_store = FakeWorkStore(first)
    work_store.claim_work = lambda **kwargs: (
        [first, second] if kwargs["lane_group"] == "live" else []
    )
    fetcher = FakeFetcher(make_payload())
    fetcher.fetch_apps_batch = lambda appids: {appid: make_payload(appid=appid) for appid in appids}
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=FakeArchiveStore(),
        worker_id="test-worker",
    )

    stats = processor.process_once(fetcher)

    assert stats.completed == 2
    assert [len(call["claims"]) for call in work_store.heartbeats] == [2, 2]
    assert work_store.latest_snapshot_calls == [[7, 8]]


def test_blocking_downstream_work_is_bounded_and_does_not_starve_gevent(
    monkeypatch,
):
    claims = [replace(make_claim(), id=100 + index, appid=1000 + index) for index in range(8)]
    work_store = FakeWorkStore(claims[0])
    work_store.claim_work = lambda **kwargs: (claims if kwargs["lane_group"] == "live" else [])
    active = 0
    max_active = 0
    lock = threading.Lock()

    class SlowArchiveStore(FakeArchiveStore):
        def write_json(self, **kwargs):
            nonlocal active, max_active
            with lock:
                active += 1
                max_active = max(max_active, active)
            try:
                time.sleep(0.03)
                return super().write_json(**kwargs)
            finally:
                with lock:
                    active -= 1

    fetcher = FakeFetcher(None)
    fetcher.fetch_apps_batch = lambda appids: {appid: make_payload(appid=appid) for appid in appids}
    monkeypatch.setattr(
        "src.workers.durable_processor.settings.pics_consumer_concurrency",
        4,
    )
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=SlowArchiveStore(),
        worker_id="test-worker",
    )
    gevent_ticks = []
    ticker = gevent.spawn_later(
        0.01,
        lambda: gevent_ticks.append(time.monotonic()),
    )

    stats = processor.process_once(fetcher)
    ticker.join(timeout=1)

    assert stats.completed == 8
    assert 1 < max_active <= 4
    assert gevent_ticks
    assert stats.heartbeat_transactions == 2
    assert stats.tiger_transactions_per_settlement is not None
    assert stats.phase_latency_seconds["r2_write"]["count"] == 8
