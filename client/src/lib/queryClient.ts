import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";

async function getErrorMessage(res: Response) {
  const text = (await res.text()) || "";
  if (!text) {
    return res.statusText || "Request failed";
  }
  try {
    const json = JSON.parse(text);
    return (
      json?.message ||
      json?.error?.message ||
      (typeof json?.error === "string" ? json.error : undefined) ||
      json?.errors?.[0]?.message ||
      res.statusText ||
      "Request failed"
    );
  } catch {
    return text;
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const message = await getErrorMessage(res);
    throw new Error(message);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: { headers?: Record<string, string> },
): Promise<Response> {
  const finalUrl = url.startsWith("http") ? url : apiUrl(url);
  const res = await fetch(finalUrl, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(options?.headers || {}),
    },
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
  timeoutMs?: number;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior, timeoutMs }) =>
  async ({ queryKey }) => {
    const path = queryKey.join("/") as string;
    const url = apiUrl(path);
    const controller =
      typeof AbortController !== "undefined" && timeoutMs
        ? new AbortController()
        : null;
    const timeoutId =
      controller && timeoutMs
        ? globalThis.setTimeout(() => controller.abort(), timeoutMs)
        : null;

    let res: Response;
    try {
      res = await fetch(url, {
        credentials: "include",
        signal: controller?.signal,
      });
    } catch (error: any) {
      if (error?.name === "AbortError") {
        throw new Error("Request timeout");
      }
      throw error;
    } finally {
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes for most queries
      gcTime: 30 * 60 * 1000, // 30 minutes garbage collection
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors (except 408, 429)
        if (
          error.message?.includes("4") &&
          !error.message?.includes("408") &&
          !error.message?.includes("429")
        ) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: (failureCount, error: any) => {
        // Only retry on network errors or 5xx
        if (
          error.message?.includes("5") ||
          error.message?.includes("Network")
        ) {
          return failureCount < 1;
        }
        return false;
      },
    },
  },
});
