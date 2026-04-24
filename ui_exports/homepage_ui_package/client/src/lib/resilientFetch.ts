import { apiUrl } from "@/lib/api";

type JsonValue = unknown;

export async function fetchJsonWithRetry<T = JsonValue>(
  path: string,
  init?: RequestInit,
  options?: {
    attempts?: number;
    retryStatuses?: number[];
    baseDelayMs?: number;
    timeoutMs?: number;
    fallbackValue?: T;
  },
): Promise<{ response: Response; data: T }> {
  const attempts = Math.max(1, Number(options?.attempts || 2));
  const retryStatuses = options?.retryStatuses || [503];
  const baseDelayMs = Math.max(100, Number(options?.baseDelayMs || 700));
  const timeoutMs = Math.max(1000, Number(options?.timeoutMs || 10000));
  const finalUrl = path.startsWith("http") ? path : apiUrl(path);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(finalUrl, {
        ...init,
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => ({}))) as T;
      if (retryStatuses.includes(response.status) && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
        continue;
      }
      return { response, data };
    } catch (error: any) {
      const message = String(error?.message || "").toLowerCase();
      const isTransient =
        error?.name === "AbortError" ||
        message.includes("network") ||
        message.includes("failed to fetch") ||
        message.includes("timeout");
      if (isTransient && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
        continue;
      }
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  const fallbackResponse = new Response(null, {
    status: retryStatuses[0] || 503,
    statusText: "Service Unavailable",
  });
  return {
    response: fallbackResponse,
    data: (options?.fallbackValue as T) ?? ({} as T),
  };
}
