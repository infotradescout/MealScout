type TestActor = { id?: unknown; email?: unknown; userType?: unknown };

/** Production test pricing and payment bypasses always require a trusted actor. */
export function canUseParkingPassTestFeatures(
  actor: TestActor | null | undefined,
  environment: Record<string, string | undefined>,
): boolean {
  const requireTrustedActor =
    !["development", "test"].includes(String(environment.NODE_ENV || "").trim().toLowerCase()) ||
    String(environment.MEALSCOUT_TEST_PROMOS_REQUIRE_ADMIN || "").toLowerCase() === "true";
  if (!requireTrustedActor) return true;

  if (["admin", "duper_admin", "super_admin", "staff"].includes(String(actor?.userType || ""))) {
    return true;
  }
  const allowlist = new Set(
    String(environment.MEALSCOUT_TEST_PROMO_ALLOWLIST || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  return [actor?.id, actor?.email].some((value) => {
    const key = String(value || "").trim().toLowerCase();
    return Boolean(key && allowlist.has(key));
  });
}
