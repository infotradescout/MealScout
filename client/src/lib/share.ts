import { apiRequest } from "@/lib/queryClient";

const AFFILIATE_REF_STORAGE_KEY = "affiliate_ref";

export function setAffiliateRef(ref: string | null) {
  if (typeof window === "undefined") return;
  if (ref) {
    window.localStorage.setItem(AFFILIATE_REF_STORAGE_KEY, ref);
  } else {
    window.localStorage.removeItem(AFFILIATE_REF_STORAGE_KEY);
  }
}

export function getStoredAffiliateRef(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(AFFILIATE_REF_STORAGE_KEY);
}

function appendRefParam(url: string, ref: string): string {
  try {
    const normalized = new URL(url, window.location.origin);
    if (!normalized.searchParams.has("ref")) {
      normalized.searchParams.set("ref", ref);
    }
    return normalized.toString();
  } catch {
    return url;
  }
}

function normalizeHost(host: string) {
  return host.replace(/^www\./, "");
}

function shouldAppendRef(input: string, ref: string | null): boolean {
  if (!ref) return false;
  if (!input.startsWith("http")) return true;
  try {
    const inputUrl = new URL(input);
    return (
      normalizeHost(inputUrl.host) === normalizeHost(window.location.host)
    );
  } catch {
    return false;
  }
}

function normalizeSharePath(input: string): string {
  if (!input) return "/";

  if (input.startsWith("http")) {
    try {
      const url = new URL(input);
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return "/";
    }
  }

  if (input.startsWith("/")) {
    return input;
  }

  return `/${input}`;
}

export async function getAffiliateShareUrl(input: string): Promise<string> {
  if (typeof window === "undefined") {
    return input;
  }

  const path = normalizeSharePath(input);
  const baseFallback = input.startsWith("http")
    ? input
    : `${window.location.origin}${path}`;
  const storedRef = getStoredAffiliateRef();
  const fallback =
    storedRef && shouldAppendRef(baseFallback, storedRef)
      ? appendRefParam(baseFallback, storedRef)
      : baseFallback;

  try {
    const res = await apiRequest("POST", "/api/share/generate", {
      path,
      ref: storedRef || undefined,
    });
    const data = await res.json();
    return data?.shareLink || fallback;
  } catch {
    return fallback;
  }
}
