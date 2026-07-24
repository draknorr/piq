export type AppProjectionVersion = "legacy" | "v2";

export interface AppProjectionRelations {
  filterCounts:
    | "metrics.apps_page_filter_counts"
    | "metrics.apps_page_filter_counts_v2";
  projection:
    | "metrics.apps_page_projection"
    | "metrics.apps_page_projection_v2";
  version: AppProjectionVersion;
}

const APP_PROJECTION_RELATIONS: Record<
  AppProjectionVersion,
  AppProjectionRelations
> = {
  legacy: {
    filterCounts: "metrics.apps_page_filter_counts",
    projection: "metrics.apps_page_projection",
    version: "legacy",
  },
  v2: {
    filterCounts: "metrics.apps_page_filter_counts_v2",
    projection: "metrics.apps_page_projection_v2",
    version: "v2",
  },
};

export function resolveAppProjectionRelations(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AppProjectionRelations {
  const configured =
    env.APP_PROJECTION_VERSION?.trim().toLowerCase() || "legacy";
  if (configured !== "legacy" && configured !== "v2") {
    throw new Error(
      `Invalid APP_PROJECTION_VERSION "${configured}". Expected "legacy" or "v2".`,
    );
  }

  return APP_PROJECTION_RELATIONS[configured];
}
