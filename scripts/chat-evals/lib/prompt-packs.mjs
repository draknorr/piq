import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const CHAT_EVAL_DIR = path.join(LIB_DIR, '..');

const PACK_MANIFESTS = {
  'full.sections-1-2': path.join(CHAT_EVAL_DIR, 'packs', 'full', 'sections-1-2.json'),
  'full.sections-3-4': path.join(CHAT_EVAL_DIR, 'packs', 'full', 'sections-3-4.json'),
  'full.section-5': path.join(CHAT_EVAL_DIR, 'packs', 'full', 'section-5.json'),
  'full.section-6': path.join(CHAT_EVAL_DIR, 'packs', 'full', 'section-6.json'),
  'golden.company': path.join(CHAT_EVAL_DIR, 'packs', 'golden', 'company.json'),
  'golden.similarity': path.join(CHAT_EVAL_DIR, 'packs', 'golden', 'similarity.json'),
  'golden.trend': path.join(CHAT_EVAL_DIR, 'packs', 'golden', 'trend.json'),
  'mini.company': path.join(CHAT_EVAL_DIR, 'packs', 'mini', 'company.json'),
  'mini.similarity': path.join(CHAT_EVAL_DIR, 'packs', 'mini', 'similarity.json'),
  'mini.trend': path.join(CHAT_EVAL_DIR, 'packs', 'mini', 'trend.json'),
};

export const ACTIVE_FULL_PACK_KEYS = ['full.sections-1-2', 'full.sections-3-4', 'full.section-5'];

const SECTION_TO_PACK_KEY = {
  '1-2': 'full.sections-1-2',
  '3-4': 'full.sections-3-4',
  '5': 'full.section-5',
  '6': 'full.section-6',
};

const AREA_TO_PACKS = {
  company: {
    mini: 'mini.company',
    golden: 'golden.company',
    section: 'full.sections-1-2',
  },
  similarity: {
    mini: 'mini.similarity',
    golden: 'golden.similarity',
    section: 'full.sections-3-4',
  },
  trend: {
    mini: 'mini.trend',
    golden: 'golden.trend',
    section: 'full.section-5',
  },
};

const PACK_CACHE = new Map();

export async function loadPackDefinition(packKey) {
  if (PACK_CACHE.has(packKey)) {
    return PACK_CACHE.get(packKey);
  }

  const filePath = PACK_MANIFESTS[packKey];
  if (!filePath) {
    throw new Error(`Unknown chat eval pack: ${packKey}`);
  }

  const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (parsed.packKey !== packKey) {
    throw new Error(`Pack manifest mismatch for ${packKey}: found ${parsed.packKey}`);
  }
  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
    throw new Error(`Pack ${packKey} must include at least one entry`);
  }

  const normalized = {
    ...parsed,
    manifestPath: filePath,
    entries: parsed.entries.map((entry) => normalizePackEntry(entry, packKey)),
  };

  PACK_CACHE.set(packKey, normalized);
  return normalized;
}

export function getPackManifestPath(packKey) {
  const filePath = PACK_MANIFESTS[packKey];
  if (!filePath) {
    throw new Error(`Unknown chat eval pack: ${packKey}`);
  }
  return filePath;
}

export function listPackKeys() {
  return Object.keys(PACK_MANIFESTS);
}

export function resolveSectionPackKey(sectionRef) {
  const packKey = SECTION_TO_PACK_KEY[sectionRef];
  if (!packKey) {
    throw new Error(`Unsupported section selector: ${sectionRef}`);
  }
  return packKey;
}

export function resolvePackKeys({ mode, area, sections }) {
  if (mode === 'full') {
    if (!sections || sections === '1-5' || sections === 'active') {
      return [...ACTIVE_FULL_PACK_KEYS];
    }
    return [resolveSectionPackKey(sections)];
  }

  if (mode === 'section') {
    if (sections) {
      return [resolveSectionPackKey(sections)];
    }
    if (!area) {
      throw new Error('Section mode requires --area or --sections');
    }
    const areaConfig = AREA_TO_PACKS[area];
    if (!areaConfig) {
      throw new Error(`Unsupported chat eval area: ${area}`);
    }
    return [areaConfig.section];
  }

  if (mode === 'mini' || mode === 'golden') {
    if (!area) {
      throw new Error(`${mode} mode requires --area`);
    }
    const areaConfig = AREA_TO_PACKS[area];
    if (!areaConfig?.[mode]) {
      throw new Error(`No ${mode} pack is configured for area "${area}"`);
    }
    return [areaConfig[mode]];
  }

  throw new Error(`Unsupported chat eval mode: ${mode}`);
}

export function getAreaConfig(area) {
  return AREA_TO_PACKS[area] || null;
}

function normalizePackEntry(entry, packKey) {
  const critiqueId = entry.critiqueId ?? null;
  const suiteKey = entry.suiteKey ?? null;
  const critiqueRef = critiqueId != null ? `#${critiqueId}` : suiteKey;

  if (!critiqueRef) {
    throw new Error(`Pack ${packKey} has an entry without critiqueId or suiteKey`);
  }
  if (!entry.prompt) {
    throw new Error(`Pack ${packKey} has an entry without prompt text`);
  }

  return {
    critiqueId,
    suiteKey,
    critiqueRef,
    section: entry.section,
    family: entry.family,
    primaryPersona: entry.primaryPersona,
    prompt: entry.prompt,
    packTags: Array.isArray(entry.packTags) ? entry.packTags : [],
    targetScore: entry.targetScore ?? null,
    targetVerdict: entry.targetVerdict ?? null,
    referenceScore: entry.referenceScore ?? null,
    referenceVerdict: entry.referenceVerdict ?? null,
    judgeNotes: entry.judgeNotes ?? null,
  };
}
