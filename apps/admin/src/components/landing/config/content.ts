export const LANDING_AUDIENCES = [
  "Publishers",
  "Studios",
  "Investors",
  "Analysts",
] as const;

export const LANDING_JOBS = [
  {
    title: "Monitor the move",
    description:
      "See release timing, pricing, store-page, and announcement moves as one readable story.",
  },
  {
    title: "Ask the market",
    description:
      "Ask about games, genres, publishers, developers, and market patterns in plain English, then open the evidence trail.",
  },
  {
    title: "Benchmark the actors",
    description:
      "Compare titles, portfolios, commercial patterns, and momentum before you make the call.",
  },
] as const;

export const HERO_LOOP = [
  {
    step: "01",
    title: "Ask the actual market question",
    description:
      "Start with the question you need answered, not the filters another tool makes you assemble first.",
  },
  {
    step: "02",
    title: "Pressure-test the move",
    description:
      "Cut by launch timing, pricing, platform, company behavior, momentum, or recent activity until you know whether it matters.",
  },
  {
    step: "03",
    title: "Open the proof",
    description:
      "Jump straight into before / after diffs, related announcements, linked entities, and the evidence behind the conclusion.",
  },
] as const;

export const HERO_SIGNAL_TILES = [
  { value: "200K+", label: "Steam listings indexed" },
  { value: "15M+", label: "Tracked data points" },
  { value: "4", label: "Signal sources unified" },
  { value: "15 min", label: "Freshness target" },
] as const;

export const PREVIEW_PANELS = [
  {
    eyebrow: "Change Feed",
    title: "14 upcoming titles tightened release timing in the last 24 hours",
    description:
      "Grouped change cards turn scattered release movement into an immediate launch-watch view, with the proof attached.",
    tags: ["Launch Watch", "Release timing", "Store refresh"],
  },
  {
    eyebrow: "Companies",
    title: "3 publishers are repeating the same pricing playbook this week",
    description:
      "Open the portfolios, compare the pattern, and decide whether it is discount pressure, launch setup, or a bigger commercial shift.",
    tags: ["Commercial Moves", "Pricing", "Benchmark"],
  },
] as const;

export const WATCHLIST_ITEMS = [
  {
    name: "Upcoming extraction shooters",
    detail: "6 release-window shifts and 2 new trailer pushes today",
    variant: "warning",
  },
  {
    name: "Mid-market publishers on discount cadence",
    detail: "3 companies repeated the same pricing pattern this week",
    variant: "orange",
  },
  {
    name: "Studios with strong products and weak GTM",
    detail: "9 titles look stronger than their current store presentation",
    variant: "success",
  },
] as const;

export const WORKBENCH_METRICS = [
  { label: "Question to evidence", value: "< 1 min" },
  { label: "Grouped activity cards", value: "50" },
  { label: "Coverage in one system", value: "Games, publishers, developers" },
] as const;

export const TRUST_ITEMS = [
  { value: "200K+", label: "Listings indexed" },
  { value: "15M+", label: "Tracked data points" },
  { value: "4", label: "Signal sources unified" },
  { value: "15 min", label: "Update cadence target" },
] as const;

export const FEATURES = [
  {
    eyebrow: "Ask",
    title: "Ask the market a real question",
    description:
      "Ask in plain English, resolve to the right entities, then inspect the proof instead of settling for a vague summary.",
    points: [
      "Go from a question to the exact game, company, or pattern worth opening.",
      "Keep the answer tied to the data and the evidence behind it.",
    ],
  },
  {
    eyebrow: "Monitor",
    title: "See the move before it turns into consensus",
    description:
      "Change intelligence tracks release timing, pricing, store refreshes, announcements, and the response that follows.",
    points: [
      "Grouped activity turns noisy updates into something operators can actually read.",
      "See commercial, launch, and presentation changes in one operating surface.",
    ],
  },
  {
    eyebrow: "Compare",
    title: "Benchmark companies and titles without breaking context",
    description:
      "Move from a title to a publisher to the wider pattern without breaking context or starting over.",
    points: [
      "Compare portfolios, momentum, and commercial behavior in the same system.",
      "Carry context from one signal into the next decision.",
    ],
  },
] as const;

export const WORKFLOW_STEPS = [
  {
    step: "01",
    title: "Start with the market question",
    description:
      "A prompt, saved view, or change-feed slice gets you to the important part of the market fast.",
  },
  {
    step: "02",
    title: "Narrow the move that matters",
    description:
      "Refine by timing, pricing, platform, company type, or momentum without reopening the research in five disconnected tools.",
  },
  {
    step: "03",
    title: "Follow the thread to proof",
    description:
      "Jump from a signal to the title, the company, the surrounding pattern, and the supporting evidence in one flow.",
  },
] as const;

export const COVERAGE_STATS = [
  {
    value: "200K+",
    label: "Steam listings indexed",
    description:
      "Games, demos, DLC, tools, and other entities structured for research, monitoring, and benchmarking.",
  },
  {
    value: "15M+",
    label: "Tracked data points",
    description:
      "Depth that supports change intelligence, benchmarking, and plain-English analysis.",
  },
  {
    value: "4",
    label: "Signal sources",
    description:
      "Steam plus adjacent sources already feeding a broader market workflow.",
  },
  {
    value: "15 min",
    label: "Freshness target",
    description:
      "Fast enough for live monitoring and decision support, not just retrospective reporting.",
  },
] as const;

export const CTA_BULLETS = [
  "We prioritize teams that need recurring market research and monitoring depth now.",
  "Tell us what you track: launches, pricing, competitor moves, diligence, or portfolio strategy.",
  "If your email is already approved, sign in and pick up where the last question ended.",
] as const;

export const FOOTER_LINKS = {
  author: { name: "Ryan", url: "https://www.ryanbohmann.com" },
} as const;
