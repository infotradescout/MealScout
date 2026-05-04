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

function getStoredAffiliateRef(): string | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(AFFILIATE_REF_STORAGE_KEY);
  if (stored) return stored;

  const cookies = document.cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const [rawKey, ...rest] = part.split("=");
      const key = decodeURIComponent(rawKey || "").trim();
      if (!key) return acc;
      acc[key] = decodeURIComponent(rest.join("=") || "");
      return acc;
    }, {});

  const referralTag = String(cookies.referralTag || "").trim();
  if (referralTag) return referralTag;

  const referralId = String(cookies.referralId || "").trim();
  // `referralId` can sometimes be an internal referral UUID. Do not append
  // that to public share links; only use compact tags/codes from cookies.
  if (
    referralId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      referralId,
    ) &&
    /^[a-z0-9-]{3,32}$/i.test(referralId)
  ) {
    return referralId;
  }

  return null;
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
    storedRef
      ? `${window.location.origin}/ref/${encodeURIComponent(storedRef)}${path}`
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
