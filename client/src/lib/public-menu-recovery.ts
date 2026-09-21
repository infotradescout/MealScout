import { normalizeSafeInternalPath } from "@shared/safeInternalPath";
export class PublicMenuReadError extends Error {
  constructor(public readonly status: number | null) {
    super("The public menu could not be loaded");
    this.name = "PublicMenuReadError";
  }
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const identity = (value: unknown): value is Record<string, unknown> => record(value) && typeof value.id === "string" && Boolean(value.id.trim());
const named = (value: unknown): value is Record<string, unknown> => identity(value) && typeof value.name === "string" && Boolean(value.name.trim());
const cents = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const choices = (value: unknown) => Array.isArray(value) && value.every(choice => identity(choice) && typeof choice.label === "string" && typeof choice.additionalCents === "number" && Number.isSafeInteger(choice.additionalCents));
export function isPublicMenuPayload(value: unknown): boolean {
  return record(value) && typeof value.orderingEnabled === "boolean" && Array.isArray(value.menus) && value.menus.every(menu =>
    named(menu) && typeof menu.isActive === "boolean" && typeof menu.orderingEnabled === "boolean" &&
    Array.isArray(menu.categories) && menu.categories.every(category => named(category) && Array.isArray(category.items) &&
      category.items.every(item => named(item) && (item.priceCents == null || cents(item.priceCents)) &&
        typeof item.isAvailable === "boolean" && choices(item.variants) && choices(item.modifiers))));
}

export async function readPublicMenuJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 15_000);
  try {
    const response = await fetch(url, { credentials: "include", signal: controller.signal });
    if (!response.ok) throw new PublicMenuReadError(response.status);
    const payload: unknown = await response.json();
    if (!isPublicMenuPayload(payload)) throw new PublicMenuReadError(null);
    return payload as T;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof PublicMenuReadError) throw error;
    throw new PublicMenuReadError(null);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export function menuRecoveryMessage(error: unknown) {
  const status = error instanceof PublicMenuReadError ? error.status : null;
  if (status === 404 || status === 410) return { title: "Menu not found", description: "This menu may have moved or is no longer public. Check the business profile for current details." };
  if (status === 401 || status === 403) return { title: "Menu access unavailable", description: "This menu is not available with your current access. Check the business profile or sign in, then retry." };
  return { title: "Menu could not be loaded", description: "The menu request failed. Retry here without losing your cart, or check the business profile for contact details." };
}

/** Preserve only this merchant's typed public profile and non-secret navigation context. */
export function menuProfileReturnPath(value: unknown, restaurantId: string): string | null {
  if (typeof value !== "string" || value.length > 4096 || !restaurantId) return null;
  const safe = normalizeSafeInternalPath(value);
  if (!safe) return null;
  try {
    const url = new URL(safe, "https://menu.invalid");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const typed = ["restaurant", "truck", "bar", "caterer", "private-chef"].includes(parts[0]) && parts.length === 2 && (parts[1] === restaurantId || parts[1].endsWith("--" + restaurantId));
    const legacy = parts[0] === "p" && ["food-truck", "food_truck", "truck", "restaurant", "bar", "caterer", "private_chef"].includes(parts[1]) && parts[2] === restaurantId && parts.length <= 4;
    if (!typed && !legacy) return null;
    for (const key of [...url.searchParams.keys()]) if (!["ref", "source", "utm_source", "utm_medium", "utm_campaign", "message"].includes(key)) url.searchParams.delete(key);
    if (!/^#[a-zA-Z0-9_-]+$/.test(url.hash)) url.hash = "";
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}
