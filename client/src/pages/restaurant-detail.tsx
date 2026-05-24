import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";

type ResolvePayload = {
  exists: boolean;
  entityType: "restaurant" | "truck" | "bar" | "location" | "supplier";
  id: string;
  slug: string;
  canonicalUrl: string;
};

const toPathFromCanonical = (canonicalUrl?: string | null) => {
  const value = String(canonicalUrl || "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search || ""}${url.hash || ""}`;
  } catch {
    return value.startsWith("/") ? value : null;
  }
};

export default function RestaurantDetailPage() {
  const params = useParams() as Record<string, string | undefined>;
  const slugOrId = String(params.slug || params.id || "").trim();
  const pathname =
    typeof window !== "undefined" ? window.location.pathname : "/restaurant";
  const entity = useMemo(() => {
    if (pathname.startsWith("/truck/")) return "truck";
    if (pathname.startsWith("/bar/")) return "bar";
    return "restaurant";
  }, [pathname]);

  const { data, isLoading } = useQuery<ResolvePayload>({
    queryKey: ["/api/public/resolve", entity, slugOrId],
    enabled: Boolean(slugOrId),
    queryFn: async () => {
      const res = await fetch(
        `/api/public/resolve/${encodeURIComponent(entity)}/${encodeURIComponent(slugOrId)}`,
      );
      if (!res.ok) throw new Error("Profile not found");
      return res.json();
    },
  });

  useEffect(() => {
    const target = toPathFromCanonical(data?.canonicalUrl);
    if (!target || typeof window === "undefined") return;
    const current = `${window.location.pathname}${window.location.search || ""}`;
    if (target !== current) {
      window.location.replace(target);
    }
  }, [data?.canonicalUrl]);

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-xl rounded-xl border border-white/10 bg-black/20 p-6 text-center">
        <h1 className="text-xl font-semibold text-white">Opening profile...</h1>
        <p className="mt-2 text-sm text-white/70">
          {isLoading
            ? "Resolving canonical public profile route."
            : "If redirect does not happen, open the public profile below."}
        </p>
        {data?.canonicalUrl ? (
          <a
            className="mt-4 inline-flex text-sm text-primary underline"
            href={toPathFromCanonical(data.canonicalUrl) || data.canonicalUrl}
          >
            Continue to profile
          </a>
        ) : null}
        <div className="mt-6">
          <Link href="/">
            <Button variant="outline">Back to home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
