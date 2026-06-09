import { useEffect } from "react";
import { useLocation } from "wouter";
import { setAffiliateRef } from "@/lib/share";

export default function ReferralRedirect() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const tag = decodeURIComponent(
      window.location.pathname.replace(/^\/ref\/?/, ""),
    ).trim();
    if (tag) setAffiliateRef(tag);
    setLocation(`/scout${tag ? `?ref=${encodeURIComponent(tag)}` : ""}`);
  }, [setLocation]);

  return null;
}
