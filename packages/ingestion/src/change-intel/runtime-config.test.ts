import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readChangeIntelRuntimeConfig,
  shouldWriteSupabase,
  shouldWriteTiger,
} from './runtime-config.js';

test('readChangeIntelRuntimeConfig defaults to the current Supabase-safe path', () => {
  const config = readChangeIntelRuntimeConfig({});

  assert.deepEqual(config, {
    archiveTarget: 'disabled',
    readTarget: 'supabase',
    shadowStrict: false,
    tigerDatabaseUrl: null,
    writeTarget: 'supabase',
  });
  assert.equal(shouldWriteSupabase(config), true);
  assert.equal(shouldWriteTiger(config), false);
});

test('readChangeIntelRuntimeConfig enables explicit shadow Tiger writes without moving reads', () => {
  const config = readChangeIntelRuntimeConfig({
    CHANGE_INTEL_ARCHIVE_TARGET: 'object_storage',
    CHANGE_INTEL_SHADOW_STRICT: 'true',
    CHANGE_INTEL_TIGER_URL: 'postgres://tiger.example/db',
    CHANGE_INTEL_WRITE_TARGET: 'shadow',
  });

  assert.equal(config.archiveTarget, 'object_storage');
  assert.equal(config.readTarget, 'supabase');
  assert.equal(config.shadowStrict, true);
  assert.equal(config.tigerDatabaseUrl, 'postgres://tiger.example/db');
  assert.equal(config.writeTarget, 'shadow');
  assert.equal(shouldWriteSupabase(config), true);
  assert.equal(shouldWriteTiger(config), true);
});

test('readChangeIntelRuntimeConfig falls back on invalid target values', () => {
  const config = readChangeIntelRuntimeConfig({
    CHANGE_INTEL_ARCHIVE_TARGET: 's3',
    CHANGE_INTEL_READ_TARGET: 'warehouse',
    CHANGE_INTEL_WRITE_TARGET: 'off',
    TIGER_PRIMARY_URL: 'postgres://fallback.example/db',
  });

  assert.equal(config.archiveTarget, 'disabled');
  assert.equal(config.readTarget, 'supabase');
  assert.equal(config.writeTarget, 'supabase');
  assert.equal(config.tigerDatabaseUrl, 'postgres://fallback.example/db');
});
