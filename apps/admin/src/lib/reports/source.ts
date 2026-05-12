import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PublishedReport } from "./manifest";

const REPORT_CONTENT_DIR = path.join(process.cwd(), "src", "app", "reports", "content");

export function getReportContentPath(report: PublishedReport): string {
  return path.join(REPORT_CONTENT_DIR, report.fileName);
}

export async function readReportHtml(report: PublishedReport): Promise<string> {
  return readFile(getReportContentPath(report), "utf8");
}
