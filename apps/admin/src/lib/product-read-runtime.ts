export type ProductReadSurface = "admin" | "dashboard" | "insights";
export type ProductReadTarget = "legacy" | "tiger";

const SURFACE_ENV: Record<ProductReadSurface, string> = {
  admin: "ADMIN_PRODUCT_READ_TARGET",
  dashboard: "DASHBOARD_PRODUCT_READ_TARGET",
  insights: "INSIGHTS_READ_TARGET",
};

export function resolveProductReadTarget(
  surface: ProductReadSurface,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProductReadTarget {
  const surfaceValue = env[SURFACE_ENV[surface]]?.trim().toLowerCase();
  const sharedValue =
    surface === "insights"
      ? undefined
      : env.PRODUCT_HEALTH_READ_TARGET?.trim().toLowerCase();
  const configured = surfaceValue || sharedValue || "legacy";

  if (configured !== "legacy" && configured !== "tiger") {
    throw new Error(
      `Invalid ${SURFACE_ENV[surface]} target "${configured}". Expected "legacy" or "tiger".`,
    );
  }

  return configured;
}
