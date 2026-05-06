import { useEffect } from "react";

interface SEOHeadProps {
  title: string;
  description: string;
  keywords?: string;
  canonicalUrl?: string;
  allowCanonicalHostOverride?: boolean;
  ogImage?: string;
  ogType?: string;
  schemaData?: object;
  noIndex?: boolean;
}

const TRACKING_QUERY_KEYS = new Set([
  "ref",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "msclkid",
  "twclid",
  "dclid",
  "yclid",
  "mc_cid",
  "mc_eid",
]);

const PRIVATE_NOINDEX_PREFIXES = [
  "/admin",
  "/staff",
  "/profile",
  "/settings",
  "/orders",
  "/favorites",
  "/user-dashboard",
  "/restaurant-owner-dashboard",
  "/host/dashboard",
  "/supplier/dashboard",
  "/account-setup",
];

const DEFAULT_SOCIAL_IMAGE = "/og-default.jpg?v=20260506";

export function SEOHead({
  title,
  description,
  keywords,
  canonicalUrl,
  allowCanonicalHostOverride = false,
  ogImage = DEFAULT_SOCIAL_IMAGE,
  ogType = "website",
  schemaData,
  noIndex = false,
}: SEOHeadProps) {
  useEffect(() => {
    // Set page title
    document.title = title;

    // Helper function to set meta tag
    const setMetaTag = (name: string, content: string, isProperty = false) => {
      const attribute = isProperty ? "property" : "name";
      let meta = document.querySelector(`meta[${attribute}="${name}"]`);
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute(attribute, name);
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", content);
    };
    const removeMetaTag = (name: string, isProperty = false) => {
      const attribute = isProperty ? "property" : "name";
      const meta = document.querySelector(`meta[${attribute}="${name}"]`);
      if (meta) {
        meta.remove();
      }
    };

    // Set canonical URL
    const setCanonical = (url: string) => {
      let link = document.querySelector('link[rel="canonical"]');
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "canonical");
        document.head.appendChild(link);
      }
      link.setAttribute("href", url);
    };
    const setLinkTag = (rel: string, href: string) => {
      let link = document.querySelector(`link[rel="${rel}"]`);
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", rel);
        document.head.appendChild(link);
      }
      link.setAttribute("href", href);
    };

    const resolveCanonicalUrl = (url?: string) => {
      if (!url) return "";
      if (typeof window === "undefined") return url;

      const absolute = url.startsWith("http")
        ? new URL(url)
        : new URL(url, window.location.origin);

      // Keep functional query params (e.g. search?q=...) but remove tracking params
      // so affiliate/share URLs don't fragment indexation.
      const cleanedParams = new URLSearchParams();
      absolute.searchParams.forEach((value, key) => {
        if (!TRACKING_QUERY_KEYS.has(key.toLowerCase())) {
          cleanedParams.append(key, value);
        }
      });
      absolute.search = cleanedParams.toString()
        ? `?${cleanedParams.toString()}`
        : "";
      absolute.hash = "";
      absolute.protocol = "https:";
      if (!allowCanonicalHostOverride) {
        absolute.hostname = "www.mealscout.us";
      }
      return absolute.toString();
    };

    const resolvedCanonical = resolveCanonicalUrl(
      canonicalUrl ||
        (typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}`
          : undefined),
    );
    const currentPath =
      typeof window !== "undefined"
        ? window.location.pathname.toLowerCase()
        : "";
    const currentSearchParams =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();
    const autoNoIndex =
      PRIVATE_NOINDEX_PREFIXES.some((prefix) =>
        currentPath.startsWith(prefix),
      ) ||
      Array.from(currentSearchParams.keys()).some((key) =>
        TRACKING_QUERY_KEYS.has(String(key).toLowerCase()),
      );
    const effectiveNoIndex = noIndex || autoNoIndex;

    const resolveOgImage = (imageUrl: string) => {
      if (!imageUrl) return "";
      if (imageUrl.startsWith("http")) return imageUrl;
      if (typeof window === "undefined") return imageUrl;
      const base = allowCanonicalHostOverride
        ? window.location.origin
        : "https://www.mealscout.us";
      return `${base}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
    };

    const resolvedOgImage = ogImage ? resolveOgImage(ogImage) : "";
    const imageType = (() => {
      const cleanImage = resolvedOgImage.split("?")[0].toLowerCase();
      if (cleanImage.endsWith(".png")) return "image/png";
      if (cleanImage.endsWith(".webp")) return "image/webp";
      if (cleanImage.endsWith(".jpg") || cleanImage.endsWith(".jpeg")) {
        return "image/jpeg";
      }
      return "";
    })();
    const isDefaultOgImage = /\/og-default\.jpg(?:$|\?)/i.test(
      resolvedOgImage,
    );

    // Basic meta tags
    setMetaTag("description", description);
    // The legacy keywords tag is ignored by modern search engines and can
    // produce misleading SEO audit warnings, so we explicitly remove it.
    removeMetaTag("keywords");

    // Robots meta
    const robotsContent = effectiveNoIndex
      ? "noindex, nofollow"
      : "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1";
    setMetaTag("robots", robotsContent);
    setMetaTag("googlebot", robotsContent);
    setMetaTag("bingbot", robotsContent);

    // Open Graph tags
    setMetaTag("og:title", title, true);
    setMetaTag("og:description", description, true);
    setMetaTag("og:type", ogType, true);
    setMetaTag("og:site_name", "MealScout", true);
    setMetaTag("og:locale", "en_US", true);
    if (resolvedOgImage) {
      setMetaTag("og:image", resolvedOgImage, true);
      setMetaTag("og:image:url", resolvedOgImage, true);
      setMetaTag("og:image:secure_url", resolvedOgImage, true);
      setMetaTag(
        "og:image:alt",
        "MealScout food truck discovery preview",
        true,
      );
      if (imageType) {
        setMetaTag("og:image:type", imageType, true);
      }
      if (isDefaultOgImage) {
        setMetaTag("og:image:width", "1200", true);
        setMetaTag("og:image:height", "630", true);
      }
    }
    if (resolvedCanonical) {
      setMetaTag("og:url", resolvedCanonical, true);
      setCanonical(resolvedCanonical);
    }

    // Twitter Card tags
    setMetaTag("twitter:card", "summary_large_image");
    setMetaTag("twitter:title", title);
    setMetaTag("twitter:description", description);
    setMetaTag("twitter:site", "@mealscout");
    if (resolvedOgImage) {
      setMetaTag("twitter:image", resolvedOgImage);
      setMetaTag(
        "twitter:image:alt",
        "MealScout food truck discovery preview",
      );
      setLinkTag("image_src", resolvedOgImage);
    }

    // Structured data (JSON-LD)
    let pageSchema: HTMLScriptElement | null = null;
    if (schemaData) {
      // Remove any existing page-specific schema
      const existingPageSchema = document.querySelector(
        'script[type="application/ld+json"][data-page-schema="true"]',
      );
      if (existingPageSchema) {
        existingPageSchema.remove();
      }

      // Create new page-specific schema
      pageSchema = document.createElement("script");
      pageSchema.setAttribute("type", "application/ld+json");
      pageSchema.setAttribute("data-page-schema", "true");
      pageSchema.textContent = JSON.stringify(schemaData);
      document.head.appendChild(pageSchema);
    }

    // Cleanup function
    return () => {
      // Optional: Clean up when component unmounts
      // Usually not needed for SPAs, but good practice
    };
  }, [
    title,
    description,
    keywords,
    canonicalUrl,
    allowCanonicalHostOverride,
    ogImage,
    ogType,
    schemaData,
    noIndex,
  ]);

  return null; // This component doesn't render anything
}
