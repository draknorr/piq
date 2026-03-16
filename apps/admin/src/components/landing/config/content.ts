export const LANDING_AUDIENCES = [
  "Publishers",
  "Developers",
  "Investors",
  "Analysts",
] as const;

export const LANDING_JOBS = [
  {
    title: "Launch watch",
    description:
      "Track release timing, pricing, and store-page movement without reading raw Steam diffs all day.",
  },
  {
    title: "Catalog research",
    description:
      "Ask about games, genres, publishers, and developers in plain English, then open the supporting evidence.",
  },
  {
    title: "Company benchmarking",
    description:
      "Compare portfolios, commercial moves, and recent momentum before you make a decision.",
  },
] as const;

export const HERO_LOOP = [
  {
    step: "01",
    title: "Ask or search",
    description:
      "Start from a question, a saved view, or the exact game or company you care about.",
  },
  {
    step: "02",
    title: "Slice the signal",
    description:
      "Narrow by launch activity, commercial moves, company type, platform, or recent timing.",
  },
  {
    step: "03",
    title: "Open the evidence",
    description:
      "Jump from summaries into before / after diffs, related announcements, and entity detail.",
  },
] as const;

export const HERO_SIGNAL_TILES = [
  { value: "200K+", label: "Steam listings indexed" },
  { value: "15M+", label: "Daily metric facts" },
  { value: "4", label: "Signal sources unified" },
  { value: "15 min", label: "Freshness target" },
] as const;

export const PREVIEW_PANELS = [
  {
    eyebrow: "Change Feed",
    title: "14 titles tightened release timing in the last 24 hours",
    description:
      "Grouped activity turns noisy Steam updates into one readable launch-prep story with related evidence attached.",
    tags: ["Launch Watch", "Release timing", "Store refresh"],
  },
  {
    eyebrow: "Companies",
    title: "3 publishers repeated pricing and package moves this week",
    description:
      "Open the affected portfolios immediately and compare the commercial pattern before it turns into spreadsheet work.",
    tags: ["Commercial Moves", "Pricing", "Benchmark"],
  },
] as const;

export const WATCHLIST_ITEMS = [
  {
    name: "Upcoming co-op roguelikes",
    detail: "7 new launch-watch signals this morning",
    variant: "warning",
  },
  {
    name: "Mid-size publishers with discounts",
    detail: "3 companies repeated pricing changes this week",
    variant: "orange",
  },
  {
    name: "Studios with review momentum",
    detail: "9 apps crossed the positive sentiment threshold",
    variant: "success",
  },
] as const;

export const WORKBENCH_METRICS = [
  { label: "Query to evidence", value: "< 1 min" },
  { label: "Grouped activities", value: "50 / page" },
  { label: "Entity coverage", value: "Games, publishers, developers" },
] as const;

export const TRUST_ITEMS = [
  { value: "200K+", label: "Listings indexed" },
  { value: "15M+", label: "Metric facts per day" },
  { value: "4", label: "Signal sources unified" },
  { value: "15 min", label: "Update cadence target" },
] as const;

export const FEATURES = [
  {
    eyebrow: "Ask",
    title: "Use natural language without losing analytical rigor",
    description:
      "Search and chat share the same underlying entities, so questions can turn into structured follow-up workflows immediately.",
    points: [
      "Move from a prompt to the relevant app or company surface quickly.",
      "Keep the answer tied to the underlying dataset instead of a generic summary.",
    ],
  },
  {
    eyebrow: "Monitor",
    title: "Keep launch and commercial signals in one stream",
    description:
      "Change intelligence is organized around the workflows market teams actually repeat: launch watch, pricing, store refreshes, and announcement context.",
    points: [
      "Grouped activity cards reduce Steam noise without hiding the evidence.",
      "Filters stay compact enough for daily use instead of feeling like admin overhead.",
    ],
  },
  {
    eyebrow: "Compare",
    title: "Benchmark games and companies from the same workspace",
    description:
      "Catalog research, publisher analysis, and developer comparison live in the same system, which keeps context from breaking every time the question changes.",
    points: [
      "Open portfolios, momentum, and commercial shifts from one place.",
      "Stay close to the data while moving across games, publishers, and developers.",
    ],
  },
] as const;

export const WORKFLOW_STEPS = [
  {
    step: "01",
    title: "Start with the signal that matters now",
    description:
      "Landing prompts, saved views, and change-feed slices point you at the useful part of the dataset quickly.",
  },
  {
    step: "02",
    title: "Refine without opening five tools",
    description:
      "Filter by timing, pricing, platform, company type, or recent activity without leaving the workflow.",
  },
  {
    step: "03",
    title: "Carry the context into the next question",
    description:
      "Jump from a game to a publisher, from a publisher to the catalog, or from a signal to the underlying evidence.",
  },
] as const;

export const COVERAGE_STATS = [
  {
    value: "200K+",
    label: "Steam listings indexed",
    description:
      "Games, demos, DLC, tools, and other entity types organized for search and comparison.",
  },
  {
    value: "15M+",
    label: "Daily metric facts",
    description:
      "Enough coverage to matter, shaped into surfaces that remain fast to scan.",
  },
  {
    value: "4",
    label: "Signal sources",
    description:
      "Steam, Twitch, YouTube, and Epic data brought into one research flow.",
  },
  {
    value: "15 min",
    label: "Freshness target",
    description:
      "Change intelligence stays timely enough for monitoring workflows, not just retrospective analysis.",
  },
] as const;

export const CTA_BULLETS = [
  "Invite-only beta with access granted in waves.",
  "Designed for repeated daily analysis, not one-off report generation.",
  "If you already have access, sign in immediately and keep working.",
] as const;

export const FOOTER_LINKS = {
  author: { name: "Ryan", url: "https://www.ryanbohmann.com" },
} as const;
