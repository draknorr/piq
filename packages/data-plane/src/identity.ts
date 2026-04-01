import { createHash } from 'node:crypto';

import type { EntityKind, EntityPlatform } from './contracts.js';

const ENTITY_NAMESPACE = '8b8600d2-2b09-4f74-b95c-77f95fdf00f4';

function uuidToBytes(uuid: string): Uint8Array {
  const normalized = uuid.replace(/-/g, '');
  return Uint8Array.from(
    normalized.match(/.{1,2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []
  );
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function uuidV5(namespace: string, value: string): string {
  const namespaceBytes = uuidToBytes(namespace);
  const valueBytes = Buffer.from(value, 'utf8');
  const hash = createHash('sha1')
    .update(namespaceBytes)
    .update(valueBytes)
    .digest();

  const bytes = Uint8Array.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}

export function buildEntityUid(
  platform: EntityPlatform,
  entityKind: EntityKind,
  platformEntityId: string
): string {
  return uuidV5(ENTITY_NAMESPACE, `${platform}:${entityKind}:${platformEntityId}`);
}
