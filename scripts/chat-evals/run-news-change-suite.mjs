#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { loadAutolabEnv, validateAutolabEnv } from '../chat-autolab/lib/env.mjs';

const ROOT = process.cwd();
const DEFAULT_ORIGIN = process.env.CHAT_EVAL_ORIGIN || 'https://www.publisheriq.app';
const DEFAULT_CONCURRENCY = Number(process.env.NEWS_CHANGE_EVAL_CONCURRENCY || '1');
const DEFAULT_DELAY_MS = Number(process.env.NEWS_CHANGE_EVAL_DELAY_MS || '1500');
const DEFAULT_RECENT_DAYS = Number(process.env.NEWS_CHANGE_RECENT_DAYS || '14');
const DEFAULT_TOPIC_DAYS = Number(process.env.NEWS_CHANGE_TOPIC_DAYS || '30');
const DEFAULT_NEWS_ROW_LIMIT = Number(process.env.NEWS_CHANGE_FIXTURE_ROW_LIMIT || '800');
const OUT_DIR = path.join(
  '/tmp',
  'publisheriq-chat-evals',
  `news-change-suite-${new Date().toISOString().replace(/[:.]/g, '-')}`
);

const EMPTY_TITLE_CANDIDATES = [
  'Hades II',
  'Elden Ring',
  'Balatro',
  'Celeste',
  'Hollow Knight',
  'Half-Life 2',
  'Slay the Spire',
  'Baldur\'s Gate 3',
];

const RICH_TITLE_CANDIDATES = [
  'ARC Raiders',
  'Mafia: The Old Country',
  'The Finals',
  'BODYCAM',
  'No Rest for the Wicked',
  'Deadlock',
  'R.E.P.O.',
  'Tempest Rising',
];

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'your',
  'about',
  'their',
  'they',
  'them',
  'have',
  'has',
  'just',
  'more',
  'most',
  'will',
  'what',
  'when',
  'where',
  'which',
  'recent',
  'steam',
  'news',
  'update',
  'updates',
  'announcement',
  'announcements',
  'latest',
  'newest',
  'game',
  'games',
  'posted',
  'mentions',
  'mentioned',
  'release',
  'released',
  'notes',
  'item',
  'items',
]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = await loadAutolabEnv();
  validateAutolabEnv(env);

  const origin = args.origin || DEFAULT_ORIGIN;
  const outDir = args.outDir ? path.resolve(args.outDir) : OUT_DIR;
  await fs.mkdir(outDir, { recursive: true });

  const fixtures = await resolveFixtures(env, {
    recentDays: DEFAULT_RECENT_DAYS,
    topicDays: DEFAULT_TOPIC_DAYS,
    newsRowLimit: DEFAULT_NEWS_ROW_LIMIT,
  });
  await writeAtomic(path.join(outDir, 'fixtures.json'), `${JSON.stringify(fixtures, null, 2)}\n`);

  const baseEntries = buildBaseEntries(fixtures);
  const skippedEntries = buildSkippedEntries(fixtures);
  const effectiveBaseEntries =
    args.maxPrompts > 0 ? baseEntries.slice(0, args.maxPrompts) : baseEntries;

  const baseIncludePath = path.join(outDir, 'include-prompts.base.txt');
  await writeIncludeFile(baseIncludePath, effectiveBaseEntries);

  if (args.prepareOnly) {
    await writeAtomic(
      path.join(outDir, 'scorecard.md'),
      renderPrepareOnlyScorecard({
        origin,
        fixtures,
        baseEntries: effectiveBaseEntries,
        skippedEntries,
      })
    );
    console.log(`Prepared news change suite inputs in ${outDir}`);
    return;
  }

  const baseRunDir = path.join(outDir, 'base-run');
  await runEval({
    env,
    origin,
    includePath: baseIncludePath,
    outDir: baseRunDir,
    docPath: path.join(baseRunDir, 'report.md'),
    concurrency: DEFAULT_CONCURRENCY,
    delayMs: DEFAULT_DELAY_MS,
  });

  const baseResults = await loadJson(path.join(baseRunDir, 'results.json'));
  const chipEntries = args.skipChips ? [] : buildChipEntries(fixtures, baseResults);
  const effectiveChipEntries =
    args.maxPrompts > 0 ? [] : chipEntries;

  let chipResults = [];
  if (effectiveChipEntries.length > 0) {
    const chipIncludePath = path.join(outDir, 'include-prompts.chips.txt');
    await writeIncludeFile(chipIncludePath, effectiveChipEntries);
    const chipRunDir = path.join(outDir, 'chip-run');
    await runEval({
      env,
      origin,
      includePath: chipIncludePath,
      outDir: chipRunDir,
      docPath: path.join(chipRunDir, 'report.md'),
      concurrency: DEFAULT_CONCURRENCY,
      delayMs: DEFAULT_DELAY_MS,
    });
    chipResults = await loadJson(path.join(chipRunDir, 'results.json'));
  }

  const allEntries = [...effectiveBaseEntries, ...effectiveChipEntries];
  const allResults = [...baseResults, ...chipResults];
  const baseline = await loadBaseline(args.baselineDir);
  const judgedResults = judgeResults({
    entries: allEntries,
    results: allResults,
    baseline,
  });
  const summary = buildSummary(judgedResults);

  await writeAtomic(
    path.join(outDir, 'judged-results.json'),
    `${JSON.stringify(judgedResults, null, 2)}\n`
  );
  await writeAtomic(
    path.join(outDir, 'scorecard.md'),
    renderScorecard({
      origin,
      outDir,
      fixtures,
      skippedEntries,
      judgedResults,
      summary,
      baseline,
    })
  );

  console.log(`Wrote ${path.join(outDir, 'scorecard.md')}`);
}

function parseArgs(argv) {
  const args = {
    origin: '',
    outDir: '',
    baselineDir: '',
    maxPrompts: 0,
    prepareOnly: false,
    skipChips: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case '--origin':
        args.origin = argv[index + 1] || '';
        index += 1;
        break;
      case '--out-dir':
        args.outDir = argv[index + 1] || '';
        index += 1;
        break;
      case '--baseline-dir':
        args.baselineDir = argv[index + 1] || '';
        index += 1;
        break;
      case '--max-prompts':
        args.maxPrompts = Number(argv[index + 1] || '0');
        index += 1;
        break;
      case '--prepare-only':
        args.prepareOnly = true;
        break;
      case '--skip-chips':
        args.skipChips = true;
        break;
      default:
        break;
    }
  }

  return args;
}

async function resolveFixtures(env, options) {
  const recentRows = await fetchRecentProjectionRows(env, options.recentDays, options.newsRowLimit);
  const richTitles = pickRichRecentTitles(recentRows);
  const emptyTitle = await pickEmptyRecentTitle(env, options.recentDays);

  return {
    generatedAt: new Date().toISOString(),
    recentDays: options.recentDays,
    topicDays: options.topicDays,
    richRecentTitles: richTitles,
    emptyRecentTitle: emptyTitle,
  };
}

async function fetchRecentProjectionRows(env, recentDays, limit) {
  const sinceIso = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000).toISOString();
  return supabaseRest(env, 'steam_news_latest_projection', {
    select: 'appid,app_name,sort_time,title,contents,feed_scope,app_type',
    feed_scope: 'eq.community_announcements',
    app_type: 'eq.game',
    sort_time: `gte.${sinceIso}`,
    order: 'sort_time.desc',
    limit: String(limit),
  });
}

function pickRichRecentTitles(rows) {
  const aggregate = new Map();

  for (const row of rows) {
    if (!Number.isInteger(row.appid) || typeof row.app_name !== 'string') {
      continue;
    }

    const existing = aggregate.get(row.appid) || {
      appid: row.appid,
      name: row.app_name,
      count: 0,
      latestSortTime: row.sort_time || null,
      latestTitle: row.title || null,
      latestContents: row.contents || null,
    };
    existing.count += 1;
    if (!existing.latestSortTime || String(row.sort_time || '') > String(existing.latestSortTime || '')) {
      existing.latestSortTime = row.sort_time || null;
      existing.latestTitle = row.title || null;
      existing.latestContents = row.contents || null;
    }
    aggregate.set(row.appid, existing);
  }

  const viable = [...aggregate.values()]
    .filter((item) => item.count >= 3 && isSubstantialNewsItem(item.latestTitle, item.latestContents))
    .sort((left, right) => {
      const leftPriority = richTitlePriority(left.name);
      const rightPriority = richTitlePriority(right.name);
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      if (right.count !== left.count) return right.count - left.count;
      return String(right.latestSortTime || '').localeCompare(String(left.latestSortTime || ''));
    });

  return viable.slice(0, 3);
}

async function pickEmptyRecentTitle(env, recentDays) {
  for (const candidate of EMPTY_TITLE_CANDIDATES) {
    let rows;
    try {
      rows = await supabaseRest(env, 'apps', {
        select: 'appid,name',
        type: 'eq.game',
        name: `ilike.*${candidate}*`,
        limit: '5',
      });
    } catch {
      continue;
    }
    const exact = rows.find((row) => normalizeText(row.name) === normalizeText(candidate));
    const selected = exact || rows[0];
    if (!selected) {
      continue;
    }

    let recentNews;
    try {
      recentNews = await supabaseRpc(env, 'get_chat_recent_news', {
        p_appids: [selected.appid],
        p_days: recentDays,
        p_limit: 3,
      });
    } catch {
      continue;
    }

    if (Array.isArray(recentNews) && recentNews.length === 0) {
      return {
        appid: selected.appid,
        name: selected.name,
      };
    }
  }

  return null;
}

function buildBaseEntries(fixtures) {
  const entries = [];
  const rich = fixtures.richRecentTitles[0] || null;
  const empty = fixtures.emptyRecentTitle;
  const richPair = fixtures.richRecentTitles.slice(0, 2);
  const richTriple = fixtures.richRecentTitles.slice(0, 3);

  if (rich) {
    entries.push(
      entry('detail_positive_1', `What changed in the newest Steam announcement for ${rich.name}?`, 'news_detail', true),
      entry('detail_positive_2', `Tell me what actually changed in ${rich.name}'s latest Steam news.`, 'news_detail', false),
      entry('digest_positive_1', `Summarize recent Steam news for ${rich.name}.`, 'news_digest', true),
      entry('digest_positive_2', `Give me the key recent Steam news changes for ${rich.name}.`, 'news_digest', false),
      entry('regression_single_seed', `Show me the recent Steam changes for ${rich.name}`, 'change_regression_control', true),
      entry('regression_before_after', `What changed on ${rich.name} before and after its latest major update?`, 'change_regression_control', false),
      entry('regression_lookup', `Tell me about ${rich.name}`, 'change_regression_control', false),
    );
  }

  if (empty) {
    entries.push(
      entry('detail_empty_1', `What actually changed in the latest Steam news for ${empty.name}?`, 'news_detail', true),
      entry('detail_empty_2', `What changed in the newest Steam announcement for ${empty.name}?`, 'news_detail', false),
      entry('digest_empty_1', `Summarize the most important recent Steam news updates for ${empty.name}.`, 'news_digest', true),
      entry('digest_empty_2', `What are the most important recent Steam announcements for ${empty.name}?`, 'news_digest', false),
    );
  }

  if (richPair.length === 2) {
    const joined = joinTitles(richPair.map((item) => item.name));
    entries.push(
      entry('multi_2_summary', `Summarize the most meaningful recent Steam news across ${joined}.`, 'news_digest', true),
      entry('multi_2_compare', `Which of ${joined} had the most material recent Steam news change, and why?`, 'news_digest', true),
    );
  }

  if (richTriple.length === 3) {
    const joined = joinTitles(richTriple.map((item) => item.name));
    entries.push(
      entry('multi_3_summary', `Summarize the most meaningful recent Steam news across ${joined}.`, 'news_digest', false),
      entry('multi_3_compare', `Which of ${joined} had the most material recent Steam news change, and why?`, 'news_digest', true),
    );
  }

  entries.push(
    entry('topic_developer_diary_1', 'What games have released developer diaries lately?', 'news_topic_search', true),
    entry('topic_developer_diary_2', 'Which games published dev diaries recently?', 'news_topic_search', false),
    entry('topic_behind_scenes', 'What games posted behind-the-scenes updates lately?', 'news_topic_search', true),
    entry('topic_roadmap_1', 'Which games talked about a roadmap recently on Steam?', 'news_topic_search', true),
    entry('topic_roadmap_2', "Which games talked about what's next in recent Steam news?", 'news_topic_search', false),
    entry('topic_demo_1', 'What games mentioned a demo or playtest in recent Steam news?', 'news_topic_search', true),
    entry('topic_demo_2', 'What games announced a public playtest lately?', 'news_topic_search', false),
    entry('topic_patch_notes_1', 'Which games posted patch notes lately?', 'news_topic_search', true),
    entry('topic_patch_notes_2', 'Which games published release notes recently?', 'news_topic_search', false),
    entry('topic_all_scope', 'What games mentioned a roadmap in all recent news, not just official Steam announcements?', 'news_topic_search', true),
    entry('topic_seed', 'What games have released developer diaries lately?', 'news_topic_search', false),
    entry('regression_cross_game', 'Which upcoming games changed release timing recently?', 'change_regression_control', false),
    entry('regression_store_refresh', 'Find games that refreshed screenshots or trailers without an announcement', 'change_regression_control', false),
    entry('regression_trending', "What's breaking out right now?", 'change_regression_control', false),
    entry('regression_multi_seed', 'Show me the biggest Steam store-page changes in the last 30 days', 'change_regression_control', true),
  );

  return dedupeEntries(entries);
}

function buildSkippedEntries(fixtures) {
  const skipped = [];

  if (!fixtures.richRecentTitles[0]) {
    skipped.push('No rich recent-news title with a substantial latest item was available.');
  }

  if (!fixtures.emptyRecentTitle) {
    skipped.push('No stable empty recent-news title could be resolved from the configured candidate list.');
  }

  if (fixtures.richRecentTitles.length < 2) {
    skipped.push('Two-title recent-news comparison prompts were skipped because only one rich title was available.');
  }

  if (fixtures.richRecentTitles.length < 3) {
    skipped.push('Three-title recent-news comparison prompts were skipped because fewer than three rich titles were available.');
  }

  return skipped;
}

function buildChipEntries(fixtures, results) {
  const entries = [];
  const rich = fixtures.richRecentTitles[0] || null;
  const multiSeed = results.find((row) => row.prompt_text === 'Show me the biggest Steam store-page changes in the last 30 days');

  if (rich) {
    entries.push(
      entry('chip_single_detail', `What actually changed in the latest Steam news for ${rich.name}?`, 'news_chip_followup', true),
      entry('chip_single_digest', `Summarize the most important recent Steam news updates for ${rich.name}.`, 'news_chip_followup', true),
    );
  }

  const multiTitles = extractEntityTitles(multiSeed).slice(0, 3);
  if (multiTitles.length >= 2) {
    const joined = joinTitles(multiTitles);
    entries.push(
      entry('chip_multi_summary', `Summarize the most meaningful recent Steam news across ${joined}.`, 'news_chip_followup', true),
      entry('chip_multi_compare', `Which of ${joined} had the most material recent Steam news change, and why?`, 'news_chip_followup', true),
    );
  }

  entries.push(
    entry('chip_topic_roadmap', 'What games mentioned a roadmap in recent Steam news?', 'news_chip_followup', true),
    entry('chip_topic_demo', 'Which games announced a demo or playtest lately?', 'news_chip_followup', true),
  );

  return dedupeEntries(entries);
}

function dedupeEntries(entries) {
  const seen = new Set();
  return entries.filter((item) => {
    const key = normalizeText(item.prompt);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function extractEntityTitles(result) {
  if (!result || !Array.isArray(result.tool_calls)) {
    return [];
  }

  const titles = [];
  for (const tool of result.tool_calls) {
    const payload = tool.result_payload;
    if (!payload) {
      continue;
    }
    if (payload.app?.name) {
      titles.push(payload.app.name);
    }
    if (Array.isArray(payload.apps)) {
      for (const app of payload.apps) {
        if (app?.name) {
          titles.push(app.name);
        }
      }
    }
    if (Array.isArray(payload.results)) {
      for (const row of payload.results) {
        if (row?.name) {
          titles.push(row.name);
        }
      }
    }
    if (Array.isArray(payload.items)) {
      for (const item of payload.items) {
        if (item?.appName) {
          titles.push(item.appName);
        }
      }
    }
  }

  return [...new Set(titles)].slice(0, 3);
}

function entry(id, prompt, expectedFamily, manualReview) {
  return {
    id,
    prompt,
    expectedFamily,
    manualReview,
  };
}

function joinTitles(titles) {
  if (titles.length <= 1) {
    return titles[0] || '';
  }
  if (titles.length === 2) {
    return `${titles[0]} and ${titles[1]}`;
  }
  return `${titles.slice(0, -1).join(', ')}, and ${titles[titles.length - 1]}`;
}

async function writeIncludeFile(filePath, entries) {
  const lines = entries.map((item) => `${item.id} | ${item.prompt}`);
  await writeAtomic(filePath, `${lines.join('\n')}\n`);
}

async function runEval({ env, origin, includePath, outDir, docPath, concurrency, delayMs }) {
  await fs.mkdir(outDir, { recursive: true });
  await spawnProcess('node', ['scripts/chat-evals/run.mjs'], {
    ...env,
    ...process.env,
    CHAT_EVAL_ORIGIN: origin,
    CHAT_EVAL_INCLUDE_PROMPTS_FILE: includePath,
    CHAT_EVAL_OUT_DIR: outDir,
    CHAT_EVAL_DOC_PATH: docPath,
    CHAT_EVAL_CONCURRENCY: String(concurrency),
    CHAT_EVAL_DELAY_MS: String(delayMs),
  });
}

function judgeResults({ entries, results, baseline }) {
  const entryMap = new Map(entries.map((item) => [item.prompt, item]));
  const baselineFamilyMedians = baseline?.familyMedians || new Map();

  return results.map((result) => {
    const entry = entryMap.get(result.prompt_text) || null;
    const actualTools = Array.isArray(result.tool_calls) ? result.tool_calls.map((tool) => tool.name) : [];
    const expectedTool = inferExpectedToolFromEntry(entry);
    const evidencePayload = extractPrimaryPayload(result);
    const blockingFlags = [];
    const warnings = [];

    if (result.status !== 'success') {
      blockingFlags.push('transport_error');
    }
    if (result.message_end_received === false) {
      blockingFlags.push('missing_message_end');
    }

    if (expectedTool && !actualTools.includes(expectedTool)) {
      blockingFlags.push(`wrong_primary_tool:${expectedTool}`);
    }

    if (entry?.expectedFamily === 'change_regression_control' && actualTools.some(isNewsTool)) {
      blockingFlags.push('news_tool_regression');
    }

    if (entry?.expectedFamily !== 'change_regression_control' && expectedTool && result.primary_tool_succeeded === false) {
      blockingFlags.push('primary_tool_failure');
    }

    if (Array.isArray(result.quality?.qualityFlags) && result.quality.qualityFlags.includes('missing_absolute_dates')) {
      blockingFlags.push('missing_absolute_dates');
    }
    if (hasRelativeDatePrompt(result.prompt_text) && !hasAbsoluteDate(result.assistant_output_raw)) {
      blockingFlags.push('missing_absolute_dates');
    }

    applyContentChecks({
      entry,
      result,
      evidencePayload,
      blockingFlags,
      warnings,
    });

    const latency = judgeLatency(result, entry, baselineFamilyMedians);
    if (latency.blocking) {
      blockingFlags.push(latency.blocking);
    }
    warnings.push(...latency.warnings);

    let score = 10;
    score -= blockingFlags.length * 2;
    score -= warnings.length;
    score = Math.max(0, Math.min(10, score));

    return {
      ...result,
      news_suite: {
        scenarioId: entry?.id || null,
        expectedFamily: entry?.expectedFamily || null,
        expectedTool,
        actualTools,
        manualReviewRequired: entry?.manualReview === true,
        blockingFlags,
        warnings,
        latency,
        qualityScore: score,
        verdict:
          blockingFlags.length > 0 ? 'fail' : warnings.length > 0 || score < 8 ? 'warn' : 'pass',
      },
    };
  });
}

function inferExpectedToolFromEntry(entry) {
  switch (entry?.expectedFamily) {
    case 'news_detail':
    case 'news_chip_followup':
      if (entry.id.includes('detail')) {
        return 'get_recent_news_detail';
      }
      if (entry.id.includes('topic')) {
        return 'search_recent_news_topics';
      }
      return 'get_recent_news_digest';
    case 'news_digest':
      return 'get_recent_news_digest';
    case 'news_topic_search':
      return 'search_recent_news_topics';
    default:
      return null;
  }
}

function extractPrimaryPayload(result) {
  if (!Array.isArray(result.tool_calls)) {
    return null;
  }

  const preferredTool = result.tool_calls.find((tool) => isNewsTool(tool.name) && tool.result_payload);
  return preferredTool?.result_payload || null;
}

function applyContentChecks({ entry, result, evidencePayload, blockingFlags, warnings }) {
  const answer = String(result.assistant_output_raw || '').trim();
  const normalizedAnswer = normalizeText(answer);
  const payloadItems = Array.isArray(evidencePayload?.items) ? evidencePayload.items : [];
  const answerHasNoMatchLanguage = /\bno recent\b|\bno qualifying\b|\bdidn'?t find\b|\bno matches\b/i.test(answer);

  if (entry?.expectedFamily !== 'change_regression_control' && answer.length < 140 && payloadItems.length > 0) {
    warnings.push('thin_output');
  }

  if (payloadItems.length === 0 && isNewsFamily(entry?.expectedFamily)) {
    if (!answerHasNoMatchLanguage) {
      blockingFlags.push('bad_empty_state');
    }
    if (!/\b14\b|\b30\b|\bday\b|\bdays\b/i.test(answer)) {
      warnings.push('missing_time_window');
    }
    return;
  }

  if (!payloadItems.length && evidencePayload?.latestItem) {
    payloadItems.push(evidencePayload.latestItem);
  }

  const referencedGameCount = countMentionedGames(answer, payloadItems);
  const evidenceOverlap = measureEvidenceOverlap(answer, payloadItems);

  if (entry?.expectedFamily === 'news_detail' || entry?.id?.includes('chip_single_detail')) {
    if (evidencePayload?.detail_mode === 'latest_item' && payloadItems.length > 0 && referencedGameCount < 1) {
      blockingFlags.push('detail_missing_subject');
    }
  }

  if ((entry?.expectedFamily === 'news_digest' || entry?.id?.includes('chip_multi') || entry?.id?.includes('chip_single_digest')) && payloadItems.length >= 2 && referencedGameCount < 1) {
    warnings.push('digest_underreferences_evidence');
  }

  if ((entry?.expectedFamily === 'news_topic_search' || entry?.id?.includes('chip_topic')) && payloadItems.length >= 2 && referencedGameCount < 2) {
    warnings.push('topic_underreferences_matches');
  }

  if (evidenceOverlap < 2) {
    warnings.push('weak_evidence_overlap');
  }

  if (
    /\bpublished (?:a )?steam announcement\b|\bposted (?:a )?steam announcement\b|\bpublished an announcement\b/i.test(
      normalizedAnswer
    ) &&
    payloadItems.some((item) => getBestEvidenceText(item).length >= 80)
  ) {
    blockingFlags.push('generic_announcement_filler');
  }
}

function judgeLatency(result, entry, baselineFamilyMedians) {
  const totalMs = Number(result.timing?.totalMs || 0);
  const family = entry?.expectedFamily || result.family || 'unknown';
  const warnings = [];
  let blocking = null;

  const limits = familyLatencyLimits(family);
  if (totalMs > limits.maxMs) {
    blocking = 'too_slow';
  } else if (totalMs > limits.warnMs) {
    warnings.push('slow');
  }

  const baselineMedian = baselineFamilyMedians.get(family);
  if (baselineMedian && totalMs > 0) {
    const regressionRatio = totalMs / baselineMedian;
    if (regressionRatio > 1.35) {
      blocking = blocking || 'latency_regression';
    } else if (regressionRatio > 1.2) {
      warnings.push('latency_regression_warn');
    }
  }

  return {
    totalMs,
    warnMs: limits.warnMs,
    maxMs: limits.maxMs,
    blocking,
    warnings,
  };
}

function hasRelativeDatePrompt(prompt) {
  return /\b(today|yesterday|tomorrow|this week|this month|last 30 days|recent|recently|right now|lately)\b/i.test(
    String(prompt || '')
  );
}

function hasAbsoluteDate(answer) {
  return (
    /\b\d{4}-\d{2}-\d{2}\b/.test(String(answer || '')) ||
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/.test(
      String(answer || '')
    )
  );
}

function familyLatencyLimits(family) {
  if (family === 'news_topic_search') {
    return { warnMs: 10000, maxMs: 15000 };
  }
  if (family === 'news_detail' || family === 'news_digest' || family === 'news_chip_followup') {
    return { warnMs: 9000, maxMs: 12000 };
  }
  return { warnMs: 10000, maxMs: 20000 };
}

function buildSummary(judgedResults) {
  const verdictCounts = new Map();
  const familyBuckets = new Map();

  for (const row of judgedResults) {
    const verdict = row.news_suite?.verdict || 'unknown';
    verdictCounts.set(verdict, (verdictCounts.get(verdict) || 0) + 1);

    const family = row.news_suite?.expectedFamily || row.family || 'unknown';
    const bucket = familyBuckets.get(family) || [];
    bucket.push(Number(row.timing?.totalMs || 0));
    familyBuckets.set(family, bucket);
  }

  const familyStats = [...familyBuckets.entries()].map(([family, values]) => ({
    family,
    count: values.length,
    medianMs: percentile(values, 50),
    p95Ms: percentile(values, 95),
    maxMs: Math.max(...values, 0),
  }));

  return {
    total: judgedResults.length,
    verdictCounts: Object.fromEntries(verdictCounts),
    familyStats,
    failures: judgedResults.filter((row) => row.news_suite?.verdict === 'fail'),
    warnings: judgedResults.filter((row) => row.news_suite?.verdict === 'warn'),
    manualReview: judgedResults.filter((row) => row.news_suite?.manualReviewRequired),
  };
}

async function loadBaseline(baselineDir) {
  if (!baselineDir) {
    return null;
  }

  const judgedPath = path.join(path.resolve(baselineDir), 'judged-results.json');
  try {
    const judged = await loadJson(judgedPath);
    const familyMap = new Map();
    for (const row of judged) {
      const family = row.news_suite?.expectedFamily || row.family || 'unknown';
      const values = familyMap.get(family) || [];
      values.push(Number(row.timing?.totalMs || 0));
      familyMap.set(family, values);
    }
    return {
      path: judgedPath,
      familyMedians: new Map(
        [...familyMap.entries()].map(([family, values]) => [family, percentile(values, 50)])
      ),
    };
  } catch {
    return null;
  }
}

function renderPrepareOnlyScorecard({ origin, fixtures, baseEntries, skippedEntries }) {
  const lines = [
    '# News Change Suite Preparation',
    '',
    `- Environment: ${origin}`,
    `- Generated: ${new Date().toISOString()}`,
    `- Base prompt count: ${baseEntries.length}`,
    '',
    '## Fixtures',
    '',
    '```json',
    JSON.stringify(fixtures, null, 2),
    '```',
  ];

  if (skippedEntries.length > 0) {
    lines.push('', '## Skipped Templates', '', ...skippedEntries.map((item) => `- ${item}`));
  }

  lines.push('', '## Included Prompts', '', ...baseEntries.map((item) => `- ${item.prompt}`));
  return `${lines.join('\n')}\n`;
}

function renderScorecard({ origin, outDir, fixtures, skippedEntries, judgedResults, summary, baseline }) {
  const lines = [
    '# News Change Suite Scorecard',
    '',
    `- Environment: ${origin}`,
    `- Generated: ${new Date().toISOString()}`,
    `- Raw artifacts: ${outDir}`,
    `- Total prompts: ${summary.total}`,
    `- Pass: ${summary.verdictCounts.pass || 0}`,
    `- Warn: ${summary.verdictCounts.warn || 0}`,
    `- Fail: ${summary.verdictCounts.fail || 0}`,
  ];

  if (baseline?.path) {
    lines.push(`- Baseline: ${baseline.path}`);
  }

  lines.push('', '## Fixtures', '', '```json', JSON.stringify(fixtures, null, 2), '```');

  if (skippedEntries.length > 0) {
    lines.push('', '## Skipped Templates', '', ...skippedEntries.map((item) => `- ${item}`));
  }

  lines.push('', '## Latency By Family', '', '| Family | Count | Median ms | P95 ms | Max ms |', '|---|---:|---:|---:|---:|');
  for (const family of summary.familyStats.sort((left, right) => left.family.localeCompare(right.family))) {
    lines.push(`| ${family.family} | ${family.count} | ${family.medianMs} | ${family.p95Ms} | ${family.maxMs} |`);
  }

  lines.push('', '## Manual Review Queue', '');
  for (const row of summary.manualReview) {
    lines.push(
      `- [${row.news_suite.verdict.toUpperCase()}] ${row.prompt_text} (${row.timing?.totalMs ?? '-'}ms)`
    );
  }

  if (summary.failures.length > 0) {
    lines.push('', '## Blocking Failures', '');
    for (const row of summary.failures) {
      lines.push(
        `- ${row.prompt_text}: ${(row.news_suite.blockingFlags || []).join(', ') || 'unknown'}`
      );
    }
  }

  if (summary.warnings.length > 0) {
    lines.push('', '## Warnings', '');
    for (const row of summary.warnings) {
      lines.push(
        `- ${row.prompt_text}: ${(row.news_suite.warnings || []).join(', ') || 'none'}`
      );
    }
  }

  lines.push('', '## Detailed Results', '');
  for (const row of judgedResults) {
    lines.push(`### ${row.prompt_text}`);
    lines.push(`- Verdict: ${row.news_suite.verdict}`);
    lines.push(`- Expected tool: ${row.news_suite.expectedTool || '-'}`);
    lines.push(`- Actual tools: ${(row.news_suite.actualTools || []).join(', ') || '-'}`);
    lines.push(`- Quality score: ${row.news_suite.qualityScore}/10`);
    lines.push(`- Timing: total ${row.timing?.totalMs ?? '-'}ms | llm ${row.timing?.llmMs ?? '-'}ms | tools ${row.timing?.toolsMs ?? '-'}ms`);
    lines.push(`- Blocking flags: ${(row.news_suite.blockingFlags || []).join(', ') || '-'}`);
    lines.push(`- Warnings: ${(row.news_suite.warnings || []).join(', ') || '-'}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function countMentionedGames(answer, items) {
  return items.reduce((count, item) => {
    if (!item?.appName) {
      return count;
    }
    return normalizeText(answer).includes(normalizeText(item.appName)) ? count + 1 : count;
  }, 0);
}

function measureEvidenceOverlap(answer, items) {
  const answerTokens = new Set(tokenize(answer));
  const evidenceTokens = new Set(
    items.flatMap((item) => tokenize([item?.title, getBestEvidenceText(item), item?.appName].filter(Boolean).join(' ')))
  );
  let overlap = 0;
  for (const token of evidenceTokens) {
    if (answerTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function getBestEvidenceText(item) {
  return String(item?.excerpt || item?.bodyPreview || '');
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function percentile(values, pct) {
  const cleaned = values.filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
  if (cleaned.length === 0) {
    return 0;
  }
  const index = Math.min(
    cleaned.length - 1,
    Math.max(0, Math.ceil((pct / 100) * cleaned.length) - 1)
  );
  return cleaned[index];
}

function isSubstantialNewsItem(title, contents) {
  const normalized = String(contents || '').replace(/\s+/g, ' ').trim();
  if (normalized.length >= 320) {
    return true;
  }
  const sentenceCount = normalized.split(/[.!?]\s+/).filter(Boolean).length;
  const bulletCount = String(contents || '')
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*•]/.test(line))
    .length;
  return sentenceCount >= 2 || bulletCount >= 2 || String(title || '').trim().length >= 50;
}

function richTitlePriority(name) {
  const normalized = normalizeText(name);
  const candidateIndex = RICH_TITLE_CANDIDATES.findIndex(
    (candidate) => normalizeText(candidate) === normalized
  );
  if (candidateIndex !== -1) {
    return candidateIndex;
  }

  let penalty = 100;
  if (/[^a-z0-9\s:'-]/i.test(String(name || ''))) {
    penalty += 10;
  }
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length > 4) {
    penalty += 5;
  }
  if (words.some((word) => word.length <= 2)) {
    penalty += 3;
  }
  return penalty;
}

function isNewsTool(toolName) {
  return (
    toolName === 'get_recent_news_detail' ||
    toolName === 'get_recent_news_digest' ||
    toolName === 'search_recent_news_topics'
  );
}

function isNewsFamily(family) {
  return family === 'news_detail' || family === 'news_digest' || family === 'news_topic_search' || family === 'news_chip_followup';
}

async function supabaseRest(env, table, query) {
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return supabaseRequest(url, {
    method: 'GET',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
}

async function supabaseRpc(env, fnName, payload) {
  const url = new URL(`/rest/v1/rpc/${fnName}`, env.SUPABASE_URL);
  return supabaseRequest(url, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

async function supabaseRequest(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${body}`);
  }
  return response.json();
}

async function spawnProcess(command, args, env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function loadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeAtomic(filePath, contents) {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, contents);
  await fs.rename(tempPath, filePath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
