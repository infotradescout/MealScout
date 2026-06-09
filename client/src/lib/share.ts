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
    throw new Error("Affiliate tag unavailable — sharing disabled.");
  }

  const path = normalizeSharePath(input);
  const storedRef = getStoredAffiliateRef();

  const res = await apiRequest("POST", "/api/share/generate", {
    path,
    ref: storedRef || undefined,
  });
  const data = await res.json().catch(() => ({}));
  const shareLink = String(data?.shareLink || "").trim();
  if (!shareLink || !/[?&]ref=/.test(shareLink)) {
    throw new Error(data?.message || "Affiliate tag unavailable — sharing disabled.");
  }
  return shareLink;
}
