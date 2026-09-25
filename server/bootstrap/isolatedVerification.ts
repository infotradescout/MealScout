const LIVE_MEALSCOUT_RENDER_SERVICE_ID = "srv-d5escdh5pdvs73foo41g";

export function isIsolatedVerificationMode(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  const enabled =
    String(environment.MEALSCOUT_ISOLATED_VERIFICATION || "")
      .trim()
      .toLowerCase() === "true";

  if (enabled && environment.RENDER_SERVICE_ID === LIVE_MEALSCOUT_RENDER_SERVICE_ID) {
    throw new Error("Isolated verification cannot disable jobs on the live MealScout service");
  }

  return enabled;
}

export function useLocalPostgresRuntime(
  databaseUrl: string,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  if (environment.MEALSCOUT_LOCAL_POSTGRES_RUNTIME !== "true") return false;
  if (!isIsolatedVerificationMode(environment) || environment.RENDER_SERVICE_ID) {
    throw new Error("Local PostgreSQL runtime requires an isolated non-Render service");
  }
  const parsed = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Local PostgreSQL runtime requires a PostgreSQL URL");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Local PostgreSQL runtime rejects URL parameters and fragments");
  }
  if (!["127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Local PostgreSQL runtime requires a numeric loopback address");
  }
  if (!/^\/mealscout_isolated_[a-z0-9_]+$/.test(parsed.pathname)) {
    throw new Error("Local PostgreSQL runtime requires an isolated database name");
  }
  return true;
}
