# ruff: noqa: E402, I001

import hashlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.database.tiger_change_history import S3ArchiveStore  # noqa: E402


class FakeBody:
    def __init__(self, body: bytes):
        self._body = body

    def read(self) -> bytes:
        return self._body


class FakeS3Client:
    def __init__(self, body: bytes, content_type: str = "application/json"):
        self._body = body
        self._content_type = content_type

    def get_object(self, **_kwargs):
        return {
            "Body": FakeBody(self._body),
            "ContentType": self._content_type,
        }


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

    with pytest.raises(ValueError, match=message):
        make_store(body).read_json_verified(**expected)


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
