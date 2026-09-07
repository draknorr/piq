# ruff: noqa: E402, I001

import hashlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.database.tiger_change_history import S3ArchiveStore  # noqa: E402


class FakeBody:
    def __init__(self, body: bytes, chunk_size=None):
        self._body = body
        self.chunk_size = chunk_size
        self.position = 0
        self.read_sizes = []
        self.closed = False

    def read(self, size=None) -> bytes:
        assert size is not None and size > 0, "verified reads must be bounded"
        self.read_sizes.append(size)
        if self.chunk_size is not None:
            size = min(size, self.chunk_size)
        chunk = self._body[self.position : self.position + size]
        self.position += len(chunk)
        return chunk

    def close(self):
        self.closed = True


class FakeS3Client:
    def __init__(self, body: bytes, content_type: str = "application/json"):
        self._body = body
        self._content_type = content_type
        self.stream = FakeBody(body)
        self.content_length = None

    def get_object(self, **_kwargs):
        response = {
            "Body": self.stream,
            "ContentType": self._content_type,
        }
        if self.content_length is not None:
            response["ContentLength"] = self.content_length
        return response


def make_store(body: bytes, content_type: str = "application/json"):
    store = S3ArchiveStore.__new__(S3ArchiveStore)
    store._client = FakeS3Client(body, content_type)
    return store


def test_verified_archive_read_checks_hash_size_type_and_json_shape():
    body = b'{"ok":true}'
    store = make_store(body)

    assert store.read_json_verified(
        bucket="archive",
        key="source.json",
        expected_content_hash=hashlib.sha256(body).hexdigest(),
        expected_byte_size=len(body),
        expected_content_type="application/json",
    ) == {"ok": True}
    assert store._client.stream.closed


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"expected_byte_size": 999}, "byte-size mismatch"),
        ({"expected_content_hash": "0" * 64}, "SHA-256 mismatch"),
        ({"expected_content_type": "text/plain"}, "content-type mismatch"),
    ],
)
def test_verified_archive_read_fails_closed_on_pointer_mismatch(kwargs, message):
    body = b'{"ok":true}'
    expected = {
        "bucket": "archive",
        "key": "source.json",
        "expected_content_hash": hashlib.sha256(body).hexdigest(),
        "expected_byte_size": len(body),
        "expected_content_type": "application/json",
    }
    expected.update(kwargs)

    store = make_store(body)
    with pytest.raises(ValueError, match=message):
        store.read_json_verified(**expected)
    assert store._client.stream.closed


def test_verified_archive_read_rejects_non_object_json():
    body = b"[]"

    with pytest.raises(ValueError, match="must be an object"):
        make_store(body).read_json_verified(
            bucket="archive",
            key="source.json",
            expected_content_hash=hashlib.sha256(body).hexdigest(),
            expected_byte_size=len(body),
            expected_content_type="application/json",
        )


def test_verified_archive_supports_partial_stream_reads_and_closes_response():
    body = b'{"value":"' + b"x" * 70_000 + b'"}'
    store = make_store(body)
    store._client.stream.chunk_size = 997
    assert store.read_json_verified(
        bucket="archive",
        key="source.json",
        expected_content_hash=hashlib.sha256(body).hexdigest(),
        expected_byte_size=len(body),
        expected_content_type="application/json",
    ) == {"value": "x" * 70_000}
    assert max(store._client.stream.read_sizes) <= 64 * 1024
    assert store._client.stream.closed


@pytest.mark.parametrize("advertise_size", [False, True])
def test_verified_archive_stops_oversize_stream_before_loading_it(advertise_size):
    body = b"x" * 1_000_000
    store = make_store(body)
    if advertise_size:
        store._client.content_length = len(body)
    with pytest.raises(ValueError, match="byte-size mismatch"):
        store.read_json_verified(
            bucket="archive",
            key="source.json",
            expected_content_hash="0" * 64,
            expected_byte_size=10,
            expected_content_type="application/json",
        )
    assert store._client.stream.position == (0 if advertise_size else 11)
    assert store._client.stream.closed


def test_verified_archive_closes_a_failed_stream():
    store = make_store(b"{}")

    def fail_read(_size):
        raise TimeoutError("injected archive timeout")

    store._client.stream.read = fail_read
    with pytest.raises(TimeoutError, match="injected archive timeout"):
        store.read_json_verified(
            bucket="archive",
            key="source.json",
            expected_content_hash="0" * 64,
            expected_byte_size=2,
            expected_content_type="application/json",
        )
    assert store._client.stream.closed


@pytest.mark.parametrize("size", [-1, True, None, 2.5])
def test_verified_archive_rejects_invalid_bounds_before_get(size):
    store = make_store(b"{}")
    with pytest.raises(ValueError, match="nonnegative integer"):
        store.read_json_verified(
            bucket="archive",
            key="source.json",
            expected_content_hash="0" * 64,
            expected_byte_size=size,
            expected_content_type="application/json",
        )
    assert store._client.stream.read_sizes == []
