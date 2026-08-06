import type {
  OpportunityResultLabel,
  OpportunityResultSummary,
} from "./types.js";

interface OpportunityResultCursor {
  appid: number;
  filterKey: string;
  id: string;
  order?: "review_priority_v2";
  rank?: number;
  score: number | null;
}

export type OpportunityResultCursorOrder = "review_priority_v2" | "score";

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
  order: OpportunityResultCursorOrder = "score",
): string {
  if (
    order === "review_priority_v2" &&
    (!Number.isInteger(result.rank) || Number(result.rank) < 1)
  ) {
    throw new Error("A v2 opportunity cursor requires a persisted rank.");
  }
  return Buffer.from(
    JSON.stringify({
      appid: result.appid,
      filterKey,
      id: result.id,
      ...(order === "review_priority_v2"
        ? { order, rank: Number(result.rank) }
        : {}),
      score: result.score,
    } satisfies OpportunityResultCursor),
  ).toString("base64url");
}

export function decodeOpportunityResultCursor(
  value: string | null,
  filterKey: string,
  order: OpportunityResultCursorOrder = "score",
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
      (parsed.score !== null && typeof parsed.score !== "number") ||
      (order === "review_priority_v2"
        ? parsed.order !== "review_priority_v2" ||
          !Number.isInteger(parsed.rank) ||
          Number(parsed.rank) < 1
        : parsed.order !== undefined || parsed.rank !== undefined)
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
