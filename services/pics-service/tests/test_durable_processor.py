import threading
import time
from dataclasses import replace
from datetime import datetime, timedelta, timezone

import gevent
import pytest

from src.database.durable_work import PICSWorkClaim
from src.database.tiger_change_history import ArchivePointer
from src.workers.durable_processor import DurablePICSProcessor, PICSClaimOutcome


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
        self.token_requested = []

    def fetch_apps_batch(self, appids):
        self.requested.append(appids)
        return {appids[0]: self.payload}

    def fetch_token_required_apps(self, appids):
        self.token_requested.append(appids)
        return {appids[0]: self.payload}


class FailingFetcher:
    def fetch_apps_batch(self, _appids):
        raise RuntimeError("Steam unavailable")


class FailingTokenFetcher:
    def fetch_token_required_apps(self, _appids):
        raise RuntimeError("access_token=must-not-be-archived Steam token acquisition unavailable")


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


@pytest.mark.parametrize("admission_fails", [False, True])
def test_automatic_feeder_runs_after_live_claim_and_preserves_live_on_failure(
    monkeypatch, admission_fails
):
    from contextlib import contextmanager

    from src.config.settings import settings

    monkeypatch.setattr(settings, "pics_successor_feeder_enabled", True)
    monkeypatch.setattr(settings, "pics_consumer_live_batch_size", 1)
    monkeypatch.setattr(settings, "pics_consumer_catchup_batch_size", 10)
    store = FakeWorkStore(make_claim())
    order = []

    @contextmanager
    def gate():
        order.append("gate")
        yield True

    def feed(*, limit):
        order.append("feed")
        assert limit == 10
        if admission_fails:
            raise RuntimeError("uncertain admission commit")
        return {"status": "enqueued", "enqueued": 1}

    def claim(**kwargs):
        lane = kwargs["lane_group"]
        order.append(lane)
        if not kwargs["limit"]:
            return []
        return [replace(make_claim(appid=7 if lane == "live" else 8), lane=lane)]

    store.catchup_gate = gate
    store.feed_successor_backlog = feed
    store.claim_work = claim
    processor = DurablePICSProcessor(
        work_mode="durable",
        stream_key="primary",
        work_store=store,
        promoter=object(),
        archive_store=FakeArchiveStore(),
        worker_id="test-worker",
    )
    settled = []

    def settle(**kwargs):
        settled.append(kwargs["claim"].appid)
        return PICSClaimOutcome(completed=1)

    monkeypatch.setattr(processor, "_process_and_settle_claim", settle)
    stats = processor.process_once(FakeFetcher(make_payload()))
    assert order == ["live", "gate", "feed", "catchup"]
    assert 7 in settled
    assert stats.completed == (1 if admission_fails else 2)
    assert stats.catchup_claimed == (0 if admission_fails else 1)
    assert stats.recovery_feed == (
        {"status": "error", "enqueued": None}
        if admission_fails
        else {"status": "enqueued", "enqueued": 1}
    )
    assert "recovery_feed" in stats.phase_seconds


@pytest.mark.parametrize("guard", ["disabled", "shadow", "zero_quota", "heavy_gate"])
def test_automatic_feeder_respects_admission_guards(monkeypatch, guard):
    from contextlib import contextmanager

    from src.config.settings import settings

    monkeypatch.setattr(settings, "pics_successor_feeder_enabled", guard != "disabled")
    monkeypatch.setattr(settings, "pics_consumer_live_batch_size", 0)
    monkeypatch.setattr(
        settings, "pics_consumer_catchup_batch_size", 0 if guard == "zero_quota" else 10
    )
    store = FakeWorkStore(make_claim())
    store.claim_work = lambda **kwargs: []

    def forbidden(**kwargs):
        raise AssertionError("admission must not run")

    @contextmanager
    def gate():
        yield guard != "heavy_gate"

    store.feed_successor_backlog = forbidden
    store.catchup_gate = gate
    mode = "shadow" if guard == "shadow" else "durable"
    processor = DurablePICSProcessor(
        work_mode=mode,
        stream_key="shadow-test" if mode == "shadow" else "primary",
        work_store=store,
        promoter=object(),
        archive_store=FakeArchiveStore(),
    )
    stats = processor.process_once(FakeFetcher(make_payload()))
    assert stats.recovery_feed is None and stats.claimed == 0


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


@pytest.mark.parametrize("live_demand", [0, 30, 80, 120])
def test_live_borrowing_preserves_total_cap_and_catchup_reserve(monkeypatch, live_demand):
    from dataclasses import replace

    from src.config.settings import settings

    monkeypatch.setattr(settings, "pics_consumer_live_borrowing_enabled", True)
    monkeypatch.setattr(settings, "pics_consumer_live_batch_size", 40)
    monkeypatch.setattr(settings, "pics_consumer_catchup_batch_size", 60)
    monkeypatch.setattr(settings, "pics_consumer_catchup_min_batch_size", 20)
    store = FakeWorkStore(make_claim())

    def claim_work(**kwargs):
        store.claim_calls.append(kwargs)
        live = kwargs["lane_group"] == "live"
        count = min(live_demand, kwargs["limit"]) if live else kwargs["limit"]
        return [
            replace(
                make_claim(),
                id=(1 if live else 1001) + i,
                appid=(1 if live else 1001) + i,
                lane="live" if live else "catchup",
            )
            for i in range(count)
        ]

    store.claim_work = claim_work
    fetcher = FakeFetcher(None)
    fetcher.fetch_apps_batch = lambda appids: {appid: make_payload(appid=appid) for appid in appids}
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=store,
        archive_store=FakeArchiveStore(),
        worker_id="test-worker",
    )
    stats = processor.process_once(fetcher)
    assert stats.claimed == stats.completed == 100
    assert stats.live_claimed == min(live_demand, 80)
    assert stats.catchup_claimed == 100 - min(live_demand, 80)
    assert stats.catchup_claimed >= 20
    assert store.claim_calls[0]["limit"] == 80


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


def test_token_required_claim_never_uses_anonymous_product_info():
    claim = replace(make_claim(), needs_token=True)
    work_store = FakeWorkStore(claim)
    fetcher = FakeFetcher(make_payload())
    archive_store = FakeArchiveStore()
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=archive_store,
        worker_id="test-worker",
    )

    stats = processor.process_once(fetcher)

    assert stats.completed == 1
    assert stats.r2_writes == 2
    assert fetcher.requested == []
    assert fetcher.token_requested == [[7]]
    assert [write["kind"] for write in archive_store.writes] == [
        "pics-token-request-evidence",
        "pics-product-payload",
    ]


def test_token_required_block_archives_redacted_acquisition_and_payload_evidence():
    claim = replace(make_claim(), needs_token=True)
    work_store = FakeWorkStore(claim)
    archive_store = FakeArchiveStore()
    payload = make_payload(missing_token=True)
    payload["_token_request"] = {
        "needsToken": True,
        "status": "unavailable",
        "errorClass": "MissingAccessToken",
        "accessToken": "must-not-be-archived",
    }
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=archive_store,
        worker_id="test-worker",
    )

    stats = processor.process_once(FakeFetcher(payload))

    assert stats.source_blocked == 1
    assert stats.r2_writes == 2
    assert [write["kind"] for write in archive_store.writes] == [
        "pics-token-request-evidence",
        "pics-product-payload-blocked",
    ]
    token_document = archive_store.writes[0]["payload"]
    assert token_document["token_request"] == {
        "needsToken": True,
        "status": "unavailable",
        "errorClass": "MissingAccessToken",
    }
    blocked_payload = archive_store.writes[1]["payload"]["raw_payload"]
    assert "accessToken" not in blocked_payload["_token_request"]
    assert blocked_payload["_token_evidence_archive"]["key"] == "test/1.json"


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
    archive_store = FakeArchiveStore()
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=archive_store,
        worker_id="test-worker",
    )

    stats = processor.process_once(FailingFetcher())

    assert stats.claimed == 1
    assert stats.retried == 1
    assert stats.completed == 0
    assert stats.r2_writes == 1
    assert len(work_store.failed) == 1
    assert work_store.failed[0]["error_code"] == "product_fetch_failed"
    assert "evidence=test-bucket/test/1.json" in work_store.failed[0]["error_message"]
    assert archive_store.writes[0]["kind"] == "pics-product-request-failure"
    assert archive_store.writes[0]["payload"]["request_kind"] == "anonymous"


def test_token_acquisition_failure_is_archived_before_bounded_retry():
    claim = replace(make_claim(), needs_token=True)
    work_store = FakeWorkStore(claim)
    archive_store = FakeArchiveStore()
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=work_store,
        archive_store=archive_store,
        worker_id="test-worker",
    )

    stats = processor.process_once(FailingTokenFetcher())

    assert stats.retried == 1
    assert stats.r2_writes == 1
    assert archive_store.writes[0]["kind"] == "pics-product-request-failure"
    failure = archive_store.writes[0]["payload"]
    assert failure["needs_token"] is True
    assert failure["request_kind"] == "token_required"
    assert failure["error_class"] == "RuntimeError"
    assert "must-not-be-archived" not in failure["error"]
    assert "[REDACTED]" in failure["error"]
    assert "must-not-be-archived" not in work_store.failed[0]["error_message"]


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


def test_capacity_deferral_does_not_dead_letter_exhausted_attempt(monkeypatch):
    from src.database.durable_work import PICSHeavyPhaseBusyError

    claim = replace(make_claim(attempts=3), lane="catchup")
    store = FakeWorkStore(claim)
    deferred = []
    store.defer_catchup_claim = lambda **kwargs: deferred.append(kwargs)
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=store,
        archive_store=FakeArchiveStore(),
        worker_id="test-worker",
    )

    def busy(**kwargs):
        raise PICSHeavyPhaseBusyError()

    monkeypatch.setattr(processor, "_process_claim", busy)
    result = processor._process_and_settle_claim(
        claim=claim,
        raw_payload=make_payload(),
        previous_pointer=None,
    )
    assert result.capacity_deferred == 1
    assert result.dead_lettered == result.retried == result.completed == 0
    assert deferred == [dict(claim=claim, worker_id="test-worker")]
    assert not store.failed


def test_periodic_lease_renewal_runs_while_steam_fetch_waits(monkeypatch):
    import src.workers.durable_processor as module

    claim = make_claim()
    store = FakeWorkStore(claim)
    progress = []
    processor = DurablePICSProcessor(
        work_mode="shadow",
        stream_key="shadow-test",
        work_store=store,
        archive_store=FakeArchiveStore(),
        worker_id="test-worker",
        on_progress=lambda: progress.append(time.monotonic()),
    )
    # Real renewal loop with a fast timer; production keeps a ten-second floor.
    real_event = module.Event

    class FastEvent(real_event):
        def wait(self, timeout=None):
            return super().wait(timeout=min(timeout, 0.01) if timeout is not None else None)

    monkeypatch.setattr(module, "Event", FastEvent)
    fetcher = FakeFetcher(make_payload())
    progress_during_wait = []

    def slow_fetch(appids):
        before = len(progress)
        gevent.sleep(0.055)
        progress_during_wait.append(len(progress) - before)
        return {7: make_payload()}

    fetcher.fetch_apps_batch = slow_fetch
    stats = processor.process_once(fetcher)
    assert stats.completed == 1
    assert stats.heartbeat_transactions >= 4
    assert len(store.heartbeats) == stats.heartbeat_transactions
    assert progress_during_wait == [0]  # renewal is not worker progress
    observed = len(store.heartbeats)
    gevent.sleep(0.02)
    assert len(store.heartbeats) == observed
