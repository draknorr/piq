export const QUERIES_ID = "sample-queries";

export const LANDING_CONTENT = {
  hero: {
    eyebrow: "Game market intelligence",
    headline:
      "The most advanced intelligence system in the gaming industry.",
    body: "Ask questions about games, companies, pricing, launches, and market shifts in plain English — and get evidence-backed answers from tens of millions of tracked data points.",
    primaryCta: "Request access",
    secondaryCta: "See sample queries",
    proofPoints: [
      { value: "200K+", label: "titles covered" },
      { value: "15M+", label: "tracked data points" },
      { value: "100+", label: "monitored market inputs" },
      { value: "Real-time", label: "change detection" },
    ],
  },
  coreArgument: {
    headline:
      "Other platforms show you fragments. PublisherIQ gives you the full picture.",
    body: "Public tools are good for lookups. Owned-title analytics are good for your own games. Market reports are good for broad context. But serious teams still need to figure out what changed, who moved first, whether it matters, how it compares, and what to do next. PublisherIQ brings all of that into one system.",
  },
  capabilities: [
    {
      title: "Query the industry with precision",
      body: "Use natural-language intelligence to go from broad industry questions to highly specific asks about titles, companies, genres, pricing patterns, launch windows, commercial behavior, and market shifts. PublisherIQ is built for focused queries, not generic summaries.",
    },
    {
      title: "See the move before it becomes obvious",
      body: "Track release timing changes, pricing behavior, store refreshes, announcements, and related movement as one readable story instead of a pile of disconnected diffs.",
    },
    {
      title: "Benchmark without breaking context",
      body: "Move from a title to a publisher, from a publisher to the wider pattern, and from the pattern to the surrounding industry context without starting over.",
    },
    {
      title: "Open the proof",
      body: "Jump from the summary into before-and-after changes, linked announcements, affected entities, and the evidence behind the conclusion.",
    },
  ],
  queries: {
    headline: "Sample Chat Queries",
    items: [
      {
        question:
          "Which upcoming games changed their release-date messaging from vague to exact in the last 30 days?",
        description:
          "Detect titles showing likely launch-commitment signals before they become obvious.",
        signals: ["Release timing", "Store copy", "Evidence attached"],
      },
      {
        question:
          "Find games that look like they started a new marketing push in the last 30 days.",
        description:
          "Group likely push patterns across announcements, asset refreshes, pricing moves, and surrounding activity.",
        signals: [
          "Announcements",
          "Asset refresh",
          "Pricing",
          "Signal grouping",
        ],
      },
      {
        question:
          "Find signable indie games where product quality looks stronger than go-to-market execution.",
        description:
          "Surface titles with strong product signals and visible execution gaps that matter to publishing, BD, and strategy teams.",
        signals: ["Quality vs GTM", "Benchmarking", "Operator lens"],
      },
    ],
  },
  whyItMatters: {
    headline:
      "This level of industry intelligence used to require an internal research stack.",
    body: "The industry now moves too fast for teams still working across dashboards, spreadsheets, and manual research. Teams that can detect shifts, investigate what changed, and act before competitors do will outperform them. PublisherIQ gives your team a faster, clearer way to make the call.",
  },
  leadership: [
    {
      title: "The deepest Steam coverage available",
      body: "200K+ titles tracked with change detection, evidence capture, and structured data across every storefront update.",
    },
    {
      title: "A connected system, not a collection of features",
      body: "Other products stop at a chart, a search result, or a database view. PublisherIQ connects the whole loop from question to signal to proof to export.",
    },
    {
      title: "Built with partners, not around them",
      body: "PublisherIQ works directly with partners on custom requests, bespoke dashboards, new capabilities, and feature development. If your team needs something specific, we help build it.",
    },
  ],
  finalCta: {
    headline: "Interested?",
    body: "PublisherIQ is currently closed-access. Request an invite and we'll be in touch.",
    primaryCta: "Request access",
    secondaryCta: "Already approved? Sign in",
  },
} as const;
