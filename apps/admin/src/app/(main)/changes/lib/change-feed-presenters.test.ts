import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChangeDetailEvent, JsonValue } from './change-feed-types';
import { buildDiffPreviews, formatChangeLabel } from './change-feed-presenters';

function changeEvent(overrides: Partial<ChangeDetailEvent>): ChangeDetailEvent {
  return {
    eventId: overrides.eventId ?? 1,
    appid: overrides.appid ?? 2868840,
    source: overrides.source ?? 'media',
    changeType: overrides.changeType ?? 'header_url_changed',
    occurredAt: overrides.occurredAt ?? '2026-03-18T16:03:27.184Z',
    beforeValue: overrides.beforeValue ?? null,
    afterValue: overrides.afterValue ?? null,
    context: overrides.context ?? {},
  };
}

test('query-only hero asset URL changes render as timestamp notes', () => {
  const diffs = buildDiffPreviews([
    changeEvent({
      beforeValue: 'https://cdn.example.com/apps/1/header.jpg?t=100',
      afterValue: 'https://cdn.example.com/apps/1/header.jpg?t=200',
    }),
  ]);

  assert.equal(diffs.length, 1);
  assert.equal(diffs[0]?.kind, 'note');
  assert.equal(diffs[0]?.label, 'Header art');
  assert.equal(
    diffs[0]?.note,
    'Steam asset timestamp refreshed; image path unchanged. t: 100 -> 200'
  );
  assert.equal(diffs[0]?.beforeImageUrl, null);
  assert.equal(diffs[0]?.afterImageUrl, null);
});

test('verified same-path content hash changes still render media diffs', () => {
  const beforeUrl = 'https://cdn.example.com/apps/1/header.jpg?t=100';
  const afterUrl = 'https://cdn.example.com/apps/1/header.jpg?t=200';
  const diffs = buildDiffPreviews([
    changeEvent({
      beforeValue: beforeUrl,
      afterValue: afterUrl,
      context: { mediaChangeReason: 'content_hash_changed' },
    }),
  ]);

  assert.equal(diffs.length, 1);
  assert.equal(diffs[0]?.kind, 'media');
  assert.equal(diffs[0]?.beforeImageUrl, beforeUrl);
  assert.equal(diffs[0]?.afterImageUrl, afterUrl);
});

test('paired query-only screenshot churn collapses into one timestamp note', () => {
  const beforeUrl = 'https://cdn.example.com/apps/1/ss_a.jpg?t=100';
  const afterUrl = 'https://cdn.example.com/apps/1/ss_a.jpg?t=200';
  const diffs = buildDiffPreviews([
    changeEvent({
      eventId: 10,
      changeType: 'screenshot_removed',
      beforeValue: [beforeUrl],
    }),
    changeEvent({
      eventId: 11,
      changeType: 'screenshot_added',
      afterValue: [afterUrl],
    }),
  ]);

  assert.equal(diffs.length, 1);
  assert.equal(diffs[0]?.kind, 'note');
  assert.equal(diffs[0]?.label, 'Screenshots');
  assert.equal(
    diffs[0]?.note,
    'Steam asset timestamp refreshed; image path unchanged. t: 100 -> 200'
  );
});

test('mixed screenshot churn keeps real added and removed images', () => {
  const timestampBefore = 'https://cdn.example.com/apps/1/ss_a.jpg?t=100';
  const timestampAfter = 'https://cdn.example.com/apps/1/ss_a.jpg?t=200';
  const removedReal = 'https://cdn.example.com/apps/1/ss_old.jpg?t=100';
  const addedReal = 'https://cdn.example.com/apps/1/ss_new.jpg?t=200';
  const diffs = buildDiffPreviews([
    changeEvent({
      eventId: 20,
      changeType: 'screenshot_removed',
      beforeValue: [timestampBefore, removedReal] satisfies JsonValue,
    }),
    changeEvent({
      eventId: 21,
      changeType: 'screenshot_added',
      afterValue: [timestampAfter, addedReal] satisfies JsonValue,
    }),
  ]);

  assert.equal(diffs.length, 3);
  assert.equal(diffs[0]?.kind, 'note');
  assert.deepEqual(diffs[1]?.added, [addedReal]);
  assert.deepEqual(diffs[2]?.removed, [removedReal]);
});

test('description rewrite objects become readable text sections', () => {
  const diffs = buildDiffPreviews([
    changeEvent({
      source: 'storefront',
      changeType: 'description_rewrite',
      beforeValue: {
        about:
          '<p class="bb_paragraph">Explore &amp; survive.</p><video poster="https://cdn.example.com/poster.avif?t=1"><source src="https://cdn.example.com/movie.webm?t=1"></video>',
        detailed: '<p>Old world.</p>',
      } satisfies JsonValue,
      afterValue: {
        about: '<p class="bb_paragraph">Explore &amp; survive with friends.</p>',
        detailed: '<p>Old world.</p><p>New bosses.</p>',
      } satisfies JsonValue,
    }),
  ]);

  assert.equal(diffs.length, 1);
  assert.equal(diffs[0]?.kind, 'text');
  assert.equal(diffs[0]?.label, 'Store description');
  assert.equal(diffs[0]?.textSections?.length, 2);
  assert.equal(diffs[0]?.textSections?.[0]?.label, 'About this game');
  assert.equal(diffs[0]?.textSections?.[0]?.beforeText, 'Explore & survive.');
  assert.equal(diffs[0]?.textSections?.[0]?.afterText, 'Explore & survive with friends.');
  assert.equal(diffs[0]?.textSections?.[1]?.label, 'Detailed description');
  assert.equal(diffs[0]?.textSections?.[1]?.afterText, 'Old world.\n\nNew bosses.');
  assert.ok(!diffs[0]?.beforeText?.includes('<video'));
  assert.ok(!diffs[0]?.beforeText?.includes('poster.avif'));
});

test('description markup-only changes render as a readable note', () => {
  const diffs = buildDiffPreviews([
    changeEvent({
      source: 'storefront',
      changeType: 'description_rewrite',
      beforeValue: {
        about:
          '<video class="bb_img" autoplay muted poster="https://cdn.example.com/poster.avif?t=100"><source src="https://cdn.example.com/movie.webm?t=100"></video>',
      } satisfies JsonValue,
      afterValue: {
        about:
          '<video class="bb_img" autoplay muted poster="https://cdn.example.com/poster.avif?t=200"><source src="https://cdn.example.com/movie.webm?t=200"></video>',
      } satisfies JsonValue,
    }),
  ]);

  assert.equal(diffs.length, 1);
  assert.equal(diffs[0]?.kind, 'note');
  assert.equal(diffs[0]?.label, 'Store description');
  assert.match(diffs[0]?.note ?? '', /Readable description copy did not change/);
});

test('short description rewrites keep full readable strings', () => {
  const diffs = buildDiffPreviews([
    changeEvent({
      source: 'storefront',
      changeType: 'short_description_rewrite',
      beforeValue: 'Battle beyond the Underworld.',
      afterValue: 'Fight deeper into the Underworld.',
    }),
  ]);

  assert.equal(diffs.length, 1);
  assert.equal(diffs[0]?.kind, 'text');
  assert.equal(diffs[0]?.label, 'Short description');
  assert.equal(diffs[0]?.textSections?.length, 1);
  assert.equal(diffs[0]?.textSections?.[0]?.beforeText, 'Battle beyond the Underworld.');
  assert.equal(diffs[0]?.textSections?.[0]?.afterText, 'Fight deeper into the Underworld.');
});

test('central registry labels demo relationship changes explicitly', () => {
  assert.equal(formatChangeLabel('demo_references_changed'), 'Playable demo');
});

test('unregistered change types remain readable without becoming store-page labels', () => {
  assert.equal(formatChangeLabel('new_unregistered_signal'), 'New Unregistered Signal');
});
