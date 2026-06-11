import { useEffect } from "react";
import { useLocation } from "wouter";
import { setAffiliateRef } from "@/lib/share";
import { isLikelyCleanAffiliateTagSegment } from "@shared/cleanAffiliateLinks";

function isDefaultLookingAffiliateTag(tag: string): boolean {
  return /^user\d{4}$/i.test(String(tag || "").trim());
}

function normalizeReferralTarget(value: string | null): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  if (raw.startsWith("//")) return null;
  if (!raw.startsWith("/")) return null;
  try {
    const parsed = new URL(raw, window.location.origin);
    const pathname = parsed.pathname.toLowerCase();
    if (
      pathname === "/" ||
      pathname === "/ref" ||
      pathname.startsWith("/ref/") ||
      pathname.startsWith("/admin") ||
      pathname.startsWith("/staff") ||
      pathname.startsWith("/api")
    ) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export default function ReferralRedirect() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const tag = decodeURIComponent(
      window.location.pathname.replace(/^\/ref\/?/, ""),
    ).trim();
    const hasValidTag = Boolean(
      tag &&
        isLikelyCleanAffiliateTagSegment(tag) &&
        !isDefaultLookingAffiliateTag(tag),
    );
    if (hasValidTag) setAffiliateRef(tag);
    const target = normalizeReferralTarget(
      new URLSearchParams(window.location.search).get("to"),
    );
    const fallback = `/scout${
      hasValidTag ? `?ref=${encodeURIComponent(tag)}` : ""
    }`;
    if (!hasValidTag || !target) {
      setLocation(fallback);
      return;
    }
    const url = new URL(target, window.location.origin);
    if (tag) url.searchParams.set("ref", tag);
    setLocation(`${url.pathname}${url.search}${url.hash}`);
  }, [setLocation]);

  return null;
}
