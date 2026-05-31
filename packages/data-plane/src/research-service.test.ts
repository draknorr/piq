import assert from 'node:assert/strict';
import test from 'node:test';

import { loadReadonlyAnalysisConfig } from './config.js';
import { PublisherIQResearchService, validateReadonlySql } from './research-service.js';

test('research archive search is optional and disabled by default', async () => {
  await withArchiveFilesystem(false, async () => {
    const service = new PublisherIQResearchService({});
    const result = await service.searchReportArchive({
      query: 'tag genre market shifts',
      limit: 3,
    });

    assert.equal(result.totalMatches, 0);
    assert.deepEqual(result.items, []);
  });
});

test('research archive search can scan local prior-work artifacts when explicitly enabled', async () => {
  await withArchiveFilesystem(true, async () => {
    const service = new PublisherIQResearchService({});
    const result = await service.searchReportArchive({
      query: 'tag genre market shifts',
      limit: 3,
    });

    assert.ok(result.totalMatches >= 1);
    assert.match(result.items[0].title.toLowerCase(), /tag|genre|market/);
    assert.ok(result.items[0].artifactCount >= 1);
  });
});

test('report recreation pack degrades when prior-work archive scanning is disabled', async () => {
  await withArchiveFilesystem(false, async () => {
    const service = new PublisherIQResearchService({});
    const pack = await service.buildReportRecreationPack({
      budget: 'lite',
      reportId: 'tag genre market shifts 2026 04 06',
    });

    assert.equal(pack.packType, 'report_recreation');
    assert.equal(pack.costEstimate.budget, 'lite');
    assert.equal(pack.artifacts.length, 0);
    assert.ok(pack.limitations.some((limitation) => limitation.includes('disabled')));
  });
});

test('report recreation pack carries prior-work artifacts when explicitly enabled', async () => {
  await withArchiveFilesystem(true, async () => {
    const service = new PublisherIQResearchService({});
    const pack = await service.buildReportRecreationPack({
      budget: 'lite',
      reportId: 'tag genre market shifts 2026 04 06',
    });

    assert.equal(pack.packType, 'report_recreation');
    assert.equal(pack.costEstimate.budget, 'lite');
    assert.ok(pack.sections.some((section) => section.id === 'archive-artifacts'));
    assert.ok(pack.limitations.some((limitation) => limitation.includes('indexed prior-work')));
  });
});

test('research packs preserve the requested budget in cost metadata', async () => {
  const service = new PublisherIQResearchService({});

  const genre = await service.buildGenreGrowthPack({ budget: 'lite', year: 2026 });
  assert.equal(genre.costEstimate.budget, 'lite');

  const youtube = await service.buildYoutubeCreatorPack({
    budget: 'full',
    game: 'Not A Real Game',
  });
  assert.equal(youtube.costEstimate.budget, 'full');

  const company = await service.buildCompanyDiligencePack({
    budget: 'lite',
    company: 'Not A Real Company',
  });
  assert.equal(company.costEstimate.budget, 'lite');

  const unreleased = await service.buildUnreleasedOpportunityPack({
    budget: 'full',
    filters: {},
  });
  assert.equal(unreleased.costEstimate.budget, 'full');
});

test('readonly sql validation rejects writes and sensitive schemas', () => {
  const insert = validateReadonlySql('INSERT INTO legacy.apps(appid) VALUES (1)', {
    expectedRows: 1,
    role: 'researcher',
  });
  assert.ok(insert.rejectedReasons.some((reason) => reason.includes('SELECT')));

  const sensitive = validateReadonlySql('SELECT * FROM chat.credit_transactions LIMIT 10', {
    expectedRows: 10,
    role: 'researcher',
  });
  assert.ok(sensitive.rejectedReasons.some((reason) => reason.includes('schema chat')));

  const userControl = validateReadonlySql('SELECT * FROM core.user_profiles LIMIT 10', {
    expectedRows: 10,
    role: 'researcher',
  });
  assert.ok(userControl.rejectedReasons.some((reason) => reason.includes('sensitive relation')));
});

test('readonly analysis can use a separate sandbox database url', () => {
  const config = loadReadonlyAnalysisConfig({
    DATA_PLANE_MAX_POOL_SIZE: '3',
    DATA_PLANE_STATEMENT_TIMEOUT_MS: '9000',
    RESEARCH_SQL_DATABASE_URL: 'postgres://readonly.example/publisheriq',
  } as NodeJS.ProcessEnv);

  assert.equal(config.connectionString, 'postgres://readonly.example/publisheriq');
  assert.equal(config.maxPoolSize, 3);
  assert.equal(config.source, 'tiger');
  assert.equal(config.statementTimeoutMs, 9000);
});

test('readonly sql validation explains allowed schemas after bad schema guesses', () => {
  const result = validateReadonlySql('SELECT table_name FROM information_schema.tables LIMIT 10', {
    expectedRows: 10,
    role: 'researcher',
  });

  assert.ok(
    result.rejectedReasons.some(
      (reason) =>
        reason.includes('Allowed schemas: legacy, metrics, docs, events, core')
        && reason.includes('get_publisheriq_data_dictionary')
        && reason.includes('metrics.apps_page_projection')
    )
  );
});

test('readonly sql validation accepts top indie ranking shape', () => {
  const sql = `
    SELECT p.appid, p.name, p.total_reviews
    FROM metrics.apps_page_projection p
    JOIN legacy.app_steam_tags ast ON ast.appid = p.appid
    JOIN legacy.steam_tags st ON st.tag_id = ast.tag_id
    WHERE p.type = 'game'
      AND p.is_released = true
      AND p.is_delisted = false
      AND lower(st.name) = 'indie'
    ORDER BY p.total_reviews DESC NULLS LAST
    LIMIT 10
  `;

  const result = validateReadonlySql(sql, {
    expectedRows: 10,
    role: 'researcher',
  });

  assert.deepEqual(result.rejectedReasons, []);
});

test('readonly sql validation requires role and large-table time bounds', () => {
  const roleBlocked = validateReadonlySql('SELECT appid FROM legacy.apps LIMIT 10', {
    expectedRows: 10,
    role: 'internal',
  });
  assert.ok(roleBlocked.rejectedReasons.some((reason) => reason.includes('researcher or admin')));

  const unboundedDaily = validateReadonlySql('SELECT appid FROM metrics.daily_metrics LIMIT 10', {
    expectedRows: 10,
    role: 'researcher',
  });
  assert.ok(unboundedDaily.rejectedReasons.some((reason) => reason.includes('metric_date')));

  const boundedDaily = validateReadonlySql(
    "SELECT appid FROM metrics.daily_metrics WHERE metric_date >= DATE '2026-01-01' LIMIT 10",
    {
      expectedRows: 10,
      role: 'researcher',
    }
  );
  assert.deepEqual(boundedDaily.rejectedReasons, []);
});

test('game research pack handles unresolved games without database access', async () => {
  const service = new PublisherIQResearchService({
    resolveEntities: async () => ({
      ambiguity: {
        candidateNames: [],
        message: null,
        requiresClarification: false,
      },
      entities: [],
      provenance: {
        capturedAt: '2026-05-31T00:00:00.000Z',
        source: 'tiger',
        tables: [],
      },
    }),
  });

  const pack = await service.buildGameResearchPack({ game: 'Not A Real Game' });
  assert.equal(pack.packType, 'game_research');
  assert.ok(pack.limitations.some((limitation) => limitation.includes('could not be resolved')));
});

async function withArchiveFilesystem<T>(
  enabled: boolean,
  callback: () => Promise<T>
): Promise<T> {
  const previous = process.env.RESEARCH_ARCHIVE_SCAN_FILESYSTEM;
  if (enabled) {
    process.env.RESEARCH_ARCHIVE_SCAN_FILESYSTEM = 'true';
  } else {
    delete process.env.RESEARCH_ARCHIVE_SCAN_FILESYSTEM;
  }

  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.RESEARCH_ARCHIVE_SCAN_FILESYSTEM;
    } else {
      process.env.RESEARCH_ARCHIVE_SCAN_FILESYSTEM = previous;
    }
  }
}
