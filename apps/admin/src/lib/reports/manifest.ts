export interface PublishedReport {
  slug: string;
  title: string;
  eyebrow: string;
  date: string;
  description: string;
  fileName: string;
}

export const PUBLISHED_REPORTS: PublishedReport[] = [
  {
    slug: "mouse-pi-for-hire-post-launch-strategy-revised-v3",
    title: "MOUSE: P.I. For Hire",
    eyebrow: "Post-launch strategy — revised draft v3",
    date: "May 17, 2026",
    description:
      "Revised external strategy brief — evidence-first, developer-facing, and grounded in player-language caveats, progression data, store state, and named calendar pressure.",
    fileName: "mouse-pi-current-status-post-launch-strategy-revised-v3-2026-05-17.html",
  },
  {
    slug: "mouse-pi-for-hire-post-launch-strategy-revised-v2",
    title: "MOUSE: P.I. For Hire",
    eyebrow: "Post-launch strategy — revised draft v2",
    date: "May 17, 2026",
    description:
      "Revised external strategy brief — sharper verdicts, surfaced evidence, named competitive set, and operational stakes attached to each move.",
    fileName: "mouse-pi-current-status-post-launch-strategy-revised-v2-2026-05-17.html",
  },
  {
    slug: "mouse-pi-for-hire-post-launch-strategy-revised",
    title: "MOUSE: P.I. For Hire",
    eyebrow: "Post-launch strategy — revised draft",
    date: "May 12, 2026",
    description:
      "Revised external strategy brief — same findings, edited for tone and rhythm.",
    fileName: "mouse-pi-current-status-post-launch-strategy-revised-2026-05-12.html",
  },
  {
    slug: "mouse-pi-for-hire-current-status-post-launch-strategy",
    title: "MOUSE: P.I. For Hire",
    eyebrow: "Current Status and Post-Launch Strategy",
    date: "May 11, 2026",
    description:
      "External strategy brief on player trust, store-page positioning, patch framing, and the path from support into DLC.",
    fileName: "mouse-pi-current-status-post-launch-strategy-2026-05-11.html",
  },
];

export function getPublishedReport(slug: string): PublishedReport | undefined {
  return PUBLISHED_REPORTS.find((report) => report.slug === slug);
}
