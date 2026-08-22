const INTERNAL_PATH_BASE_URL = "https://www.mealscout.us";

export function normalizeSafeInternalPath(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw || !raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw)) return null;

  try {
    const parsed = new URL(raw, INTERNAL_PATH_BASE_URL);
    if (parsed.origin !== INTERNAL_PATH_BASE_URL) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function buildSafeAccountSetupPath(input: {
  setupToken: string;
  setupPath?: unknown;
  continuationPath?: unknown;
}) {
  const safeSetupPath = normalizeSafeInternalPath(input.setupPath) || "/account-setup";
  const setupUrl = new URL(safeSetupPath, INTERNAL_PATH_BASE_URL);
  setupUrl.searchParams.set("token", input.setupToken);
  const safeContinuation = normalizeSafeInternalPath(input.continuationPath);
  if (safeContinuation) setupUrl.searchParams.set("redirect", safeContinuation);
  return `${setupUrl.pathname}${setupUrl.search}${setupUrl.hash}`;
}
