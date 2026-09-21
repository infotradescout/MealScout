export class ScoutFeedReadError extends Error {
  constructor(public readonly status: number | null) {
    super("Scout data could not be loaded");
    this.name = "ScoutFeedReadError";
  }
}

/** Keep transport failures distinct from a successfully read empty collection. */
export async function readScoutFeed<T>(url: string, collection: string | null, signal?: AbortSignal, onStatus?: (status: number) => void): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 15_000);
  try {
    const response = await fetch(url, { credentials: "include", signal: controller.signal });
    onStatus?.(response.status);
    if (!response.ok) throw new ScoutFeedReadError(response.status);
    const data: unknown = await response.json();
    const rows = Array.isArray(data) ? data : collection && data && typeof data === "object" ? (data as Record<string, unknown>)[collection] : null;
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row) || typeof row.id !== "string" || !row.id.trim())) throw new ScoutFeedReadError(null);
    return data as T;
  } catch (error) {
    if (signal?.aborted || error instanceof ScoutFeedReadError) throw error;
    throw new ScoutFeedReadError(null);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
