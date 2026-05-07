import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateUnreleasedCsv } from './unreleased-export';
import type { UnreleasedGame } from './unreleased-types';

const baseGame: UnreleasedGame = {
  appid: 123,
  name: 'Example Game',
  type: 'game',
  release_date: '2026-06-01',
  release_date_raw: 'Jun 1, 2026',
  release_status: 'dated_future',
  days_until_release: 25,
  latest_added_at: '2026-05-01T00:00:00.000Z',
  is_free: false,
  current_price_cents: 1999,
  current_discount_percent: 10,
  has_purchase_packages: true,
  has_workshop: false,
  release_state: 'prerelease',
  app_state: 'available',
  platforms: 'windows,mac',
  platform_array: ['windows', 'mac'],
  controller_support: null,
  is_adult_content: false,
  publisher_id: 1,
  publisher_name: 'Example Publisher',
  publisher_steam_vanity_url: null,
  publisher_game_count: 4,
  publisher_released_game_count: 3,
  publisher_total_owners: 10000,
  publisher_max_game_reviews: 500,
  developer_id: 2,
  developer_name: 'Example Developer',
  developer_steam_vanity_url: null,
  developer_game_count: 2,
  is_self_published: false,
  publisher_status: 'small_publisher',
  genre_ids: [1],
  genre_names: ['Action'],
  tag_ids: [10],
  tag_names: ['Co-op'],
  primary_tag_name: 'Co-op',
  category_ids: [20],
  category_names: ['Online Co-op'],
  primary_category_name: 'Online Co-op',
  screenshot_count: 6,
  movie_count: 1,
  latest_storefront_snapshot_at: '2026-05-02T00:00:00.000Z',
  latest_news_at: '2026-05-03T00:00:00.000Z',
  latest_news_title: 'Playtest live',
  latest_news_url: 'https://store.steampowered.com/news/app/123/view/456',
  latest_change_at: '2026-05-04T00:00:00.000Z',
  latest_change_type: 'description_rewrite',
  latest_change_summary: 'description rewrite',
  latest_activity_at: '2026-05-04T00:00:00.000Z',
  signal_families_30d: ['store-page'],
  story_kinds_30d: ['description'],
  announcement_count_30d: 2,
  change_count_30d: 5,
  release_count_30d: 1,
  pricing_count_30d: 1,
  store_page_count_30d: 2,
  media_count_30d: 1,
  taxonomy_count_30d: 1,
  platform_count_30d: 0,
  build_count_30d: 0,
  opportunity_score: 88,
  data_updated_at: '2026-05-04T00:00:00.000Z',
  projection_refreshed_at: '2026-05-04T00:00:00.000Z',
};

describe('generateUnreleasedCsv', () => {
  it('always includes identity columns before visible columns', () => {
    const [headers, row] = generateUnreleasedCsv([baseGame], ['media']).split('\n');

    assert.equal(headers, 'appid,name,steam_url,publisheriq_url,screenshots,trailers,media_count_30d');
    assert.equal(row, '123,Example Game,https://store.steampowered.com/app/123,/apps/123,6,1,1');
  });

  it('orders exported fields by visible column order', () => {
    const [headers] = generateUnreleasedCsv([baseGame], ['latest_news', 'release']).split('\n');

    assert.equal(
      headers,
      'appid,name,steam_url,publisheriq_url,latest_news_at,latest_news_title,latest_news_url,release_date,release_date_raw,release_status,days_until_release'
    );
  });

  it('does not duplicate export fields for overlapping grouped columns', () => {
    const [headers] = generateUnreleasedCsv([baseGame], ['taxonomy', 'tags']).split('\n');

    assert.equal(headers, 'appid,name,steam_url,publisheriq_url,genres,tags,categories');
  });
});
