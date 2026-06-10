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

function isCanonicalCustomerSignupPath(path: string): boolean {
  return path.split(/[?#]/, 1)[0].toLowerCase() === "/customer-signup";
}

function isCanonicalCustomerSignupShareLink(shareLink: string): boolean {
  try {
    const url = new URL(shareLink, window.location.origin);
    return (
      url.pathname.toLowerCase() === "/customer-signup" &&
      Boolean(String(url.searchParams.get("ref") || "").trim()) &&
      !url.pathname.toLowerCase().startsWith("/ref/") &&
      !url.searchParams.has("to")
    );
  } catch {
    return false;
  }
}

export async function getAffiliateShareUrl(input: string): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("Tracked links are available in the browser session only.");
  }

  const path = normalizeSharePath(input);

  const res = await apiRequest("POST", "/api/share/generate", {
    path,
  });
  const data = await res.json().catch(() => ({}));
  const shareLink = String(data?.shareLink || "").trim();
  const hasValidTrackedFormat = isCanonicalCustomerSignupPath(path)
    ? isCanonicalCustomerSignupShareLink(shareLink)
    : /\/ref\/[^/?#]+[?&]to=/.test(shareLink);
  if (!shareLink || !hasValidTrackedFormat) {
    throw new Error(
      data?.message || "Unable to generate tracked link attribution.",
    );
  }
  return shareLink;
}
