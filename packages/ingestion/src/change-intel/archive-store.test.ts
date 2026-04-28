import assert from 'node:assert/strict';
import test from 'node:test';

import {
  archiveJsonPayload,
  createChangeIntelArchiveStore,
  type ArchivePayload,
  type ArchivePointer,
  type ChangeIntelArchiveStore,
} from './archive-store.js';

class MemoryArchiveStore implements ChangeIntelArchiveStore {
  payloads: ArchivePayload[] = [];

  async read(pointer: Pick<ArchivePointer, 'bucket' | 'key'>): Promise<Buffer> {
    const payload = this.payloads.find((item) => item.keyParts?.join('/') === pointer.key);
    return Buffer.from(String(payload?.body ?? ''), 'utf8');
  }

  async write(payload: ArchivePayload): Promise<ArchivePointer> {
    this.payloads.push(payload);
    return {
      bucket: 'memory',
      byteSize: Buffer.byteLength(String(payload.body)),
      contentHash: payload.contentHash ?? 'memory-hash',
      contentType: payload.contentType,
      key: payload.keyParts?.join('/') ?? 'payload',
    };
  }
}

test('createChangeIntelArchiveStore is disabled unless explicitly configured', () => {
  assert.equal(createChangeIntelArchiveStore({}), null);
});

test('createChangeIntelArchiveStore requires a bucket when object storage is enabled', () => {
  assert.throws(
    () =>
      createChangeIntelArchiveStore({
        CHANGE_INTEL_ARCHIVE_TARGET: 'object_storage',
      }),
    /CHANGE_INTEL_ARCHIVE_BUCKET/
  );
});

test('archiveJsonPayload writes stable JSON payloads through the configured store', async () => {
  const store = new MemoryArchiveStore();

  const pointer = await archiveJsonPayload({
    kind: 'steam-news-version',
    keyParts: ['gid-1'],
    payload: { gid: 'gid-1', title: 'Patch notes' },
    store,
  });

  assert.deepEqual(pointer, {
    bucket: 'memory',
    byteSize: 37,
    contentHash: 'memory-hash',
    contentType: 'application/json',
    key: 'gid-1',
  });
  assert.equal(store.payloads.length, 1);
  assert.equal(store.payloads[0]?.body, '{"gid":"gid-1","title":"Patch notes"}');
  assert.equal(store.payloads[0]?.kind, 'steam-news-version');
});
