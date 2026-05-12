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
