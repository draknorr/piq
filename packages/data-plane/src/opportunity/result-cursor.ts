import type {
  OpportunityResultLabel,
  OpportunityResultSummary,
} from "./types.js";

interface OpportunityResultCursor {
  appid: number;
  filterKey: string;
  id: string;
  score: number | null;
}

export function opportunityCursorFilterKey(params: {
  eventLabel: OpportunityResultLabel | null;
  profileId: string | null;
  runId: string;
}): string {
  return [
    params.runId,
    params.profileId ?? "all",
    params.eventLabel ?? "all",
  ].join(":");
}

export function encodeOpportunityResultCursor(
  result: OpportunityResultSummary,
  filterKey: string,
): string {
  return Buffer.from(
    JSON.stringify({
      appid: result.appid,
      filterKey,
      id: result.id,
      score: result.score,
    } satisfies OpportunityResultCursor),
  ).toString("base64url");
}

export function decodeOpportunityResultCursor(
  value: string | null,
  filterKey: string,
): OpportunityResultCursor | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<OpportunityResultCursor>;
    if (
      parsed.filterKey !== filterKey ||
      !Number.isInteger(parsed.appid) ||
      typeof parsed.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        parsed.id,
      ) ||
      (parsed.score !== null && typeof parsed.score !== "number")
    ) {
      throw new Error("Invalid cursor payload.");
    }
    return parsed as OpportunityResultCursor;
  } catch {
    throw new Error(
      "The opportunity result cursor is invalid for these filters.",
    );
  }
}
