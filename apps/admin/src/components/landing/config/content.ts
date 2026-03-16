export const LANDING_AUDIENCES = [
  "Publishers",
  "Studios",
  "Investors",
  "Analysts",
] as const;

export const LANDING_JOBS = [
  {
    title: "Change intelligence",
    description:
      "See release timing, pricing, store-page, and announcement moves as one readable story instead of a pile of diffs.",
  },
  {
    title: "Market research",
    description:
      "Ask about games, genres, publishers, and developers in plain English, then open the evidence trail behind the answer.",
  },
  {
    title: "Company intelligence",
    description:
      "Compare portfolios, commercial patterns, and momentum before you make a launch, BD, or investment call.",
  },
] as const;

export const HERO_LOOP = [
  {
    step: "01",
    title: "Ask the real question",
    description:
      "Start with the market question you actually need answered, not the filters you have to assemble first.",
  },
  {
    step: "02",
    title: "Pressure-test the signal",
    description:
      "Slice by launch timing, pricing, platform, company type, momentum, or recent activity in a few moves.",
  },
  {
    step: "03",
    title: "Open the evidence trail",
    description:
      "Jump from the summary into before / after diffs, related announcements, and the entities driving the move.",
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
      "Grouped change cards turn scattered market movement into an immediate launch-watch view, with the related evidence already attached.",
    tags: ["Launch Watch", "Release timing", "Store refresh"],
  },
  {
    eyebrow: "Companies",
    title: "3 publishers are repeating the same pricing playbook this week",
    description:
      "Open the portfolios, compare the pattern, and decide whether it is opportunistic discounting, launch setup, or something bigger.",
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
    name: "Studios with momentum but weak GTM",
    detail: "9 titles look stronger than their current store presentation",
    variant: "success",
  },
] as const;

export const WORKBENCH_METRICS = [
  { label: "Question to evidence", value: "< 1 min" },
  { label: "Activity cards per page", value: "50" },
  { label: "Entity coverage", value: "Games, publishers, developers" },
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
      "Most platforms give you a database. PublisherIQ gives you a working answer path: ask in plain English, resolve to the right entities, then inspect the proof without losing the thread.",
    points: [
      "Go from a question to the exact game, company, or pattern worth opening.",
      "Keep the answer tied to the dataset instead of a generic summary.",
    ],
  },
  {
    eyebrow: "Monitor",
    title: "See the move before it turns into consensus",
    description:
      "Change intelligence is built for the work other tools leave scattered: release timing, pricing, store refreshes, announcements, and the response that follows.",
    points: [
      "Grouped activity makes noisy updates readable without hiding the proof.",
      "See commercial, launch, and presentation changes in one operating surface.",
    ],
  },
  {
    eyebrow: "Compare",
    title: "Benchmark companies and titles without breaking context",
    description:
      "Research, monitoring, and comparison live in one workflow, so you can move from a game to a publisher to the wider pattern without starting over.",
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
      "A prompt, saved view, or change-feed slice gets you to the interesting part of the market fast.",
  },
  {
    step: "02",
    title: "Narrow the move that matters",
    description:
      "Refine by timing, pricing, platform, company type, or momentum without opening five disconnected tools.",
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
      "The deepest current wedge: games, demos, DLC, tools, and other entities organized for serious research.",
  },
  {
    value: "15M+",
    label: "Tracked data points",
    description:
      "Enough depth to support monitoring, benchmarking, and plain-English analysis instead of vanity dashboards.",
  },
  {
    value: "4",
    label: "Signal sources",
    description:
      "Steam plus adjacent sources already shaping a broader research flow.",
  },
  {
    value: "15 min",
    label: "Freshness target",
    description:
      "Fast enough for live monitoring workflows, not just retrospective reporting.",
  },
] as const;

export const CTA_BULLETS = [
  "We review beta access based on who needs serious research and monitoring depth now.",
  "Tell us what you track: launches, pricing, competitor moves, diligence, or portfolio strategy.",
  "If your email is already approved, sign in and pick up where the last question ended.",
] as const;

export const FOOTER_LINKS = {
  author: { name: "Ryan", url: "https://www.ryanbohmann.com" },
} as const;
