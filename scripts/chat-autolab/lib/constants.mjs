import path from 'node:path';

export const ROOT = process.cwd();
export const AUTOLAB_DIR = path.join(ROOT, '.chat-autolab');
export const CURRENT_RUN_PATH = path.join(AUTOLAB_DIR, 'current-run.txt');
export const DEFAULT_REMOTE = 'autolab';
export const DEFAULT_BASE_BRANCH = 'origin/main';
export const DEFAULT_PORT = 3011;
export const DEFAULT_MAX_ITERATIONS = 40;
export const DEFAULT_MAX_DISCARDS_PER_PROMPT = 5;
export const DEFAULT_MAX_PIVOTS_PER_PROMPT = 2;
export const DEFAULT_GOLDEN_GOAL = 8.0;
export const DEFAULT_MAX_DISCOVERED_PROMPTS = 10;
export const GOLDEN_PACK_KEYS = ['golden.company', 'golden.similarity', 'golden.trend'];

export const PERSONAS = {
  publishing_strategy_lead: {
    label: 'Publishing Strategy Lead',
    description:
      'Uses chat to size categories, find comps, compare publishers and developers, and pressure-test portfolio decisions.',
  },
  competitive_market_intelligence_analyst: {
    label: 'Competitive / Market Intelligence Analyst',
    description:
      'Uses chat to monitor market shifts, breakout titles, release timing changes, and storefront activity with exact evidence and windows.',
  },
  developer_studio_lead: {
    label: 'Developer Studio Lead',
    description:
      'Uses chat to find believable comps, positioning context, platform status, review quality, and short reasons each result belongs.',
  },
  agency_business_development_prospector: {
    label: 'Agency / Business Development Prospector',
    description:
      'Uses chat to find studios or games that need marketing support, relaunch help, or strategic outreach with clear proof and timing.',
  },
  investor_portfolio_analyst: {
    label: 'Investor / Portfolio Analyst',
    description:
      'Uses chat to evaluate momentum, portfolio quality, category performance, and company-level opportunity with trustworthy metrics.',
  },
};

export const PERSONA_ALIASES = {
  publishing: 'publishing_strategy_lead',
  strategy: 'publishing_strategy_lead',
  market: 'competitive_market_intelligence_analyst',
  analyst: 'competitive_market_intelligence_analyst',
  competitive: 'competitive_market_intelligence_analyst',
  developer: 'developer_studio_lead',
  studio: 'developer_studio_lead',
  agency: 'agency_business_development_prospector',
  prospector: 'agency_business_development_prospector',
  business: 'agency_business_development_prospector',
  investor: 'investor_portfolio_analyst',
  portfolio: 'investor_portfolio_analyst',
};
