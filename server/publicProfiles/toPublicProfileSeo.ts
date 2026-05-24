import type { PublicProfileSeo, PublicProfileType } from "@shared/publicProfiles";

export function toPublicProfileSeo(input: {
  baseUrl: string;
  entityType: PublicProfileType;
  entityId: string;
  slug: string;
  canonicalPath: string;
  title: string;
  description: string | null;
  ogImageUrl?: string | null;
}): PublicProfileSeo {
  const canonicalUrl = `${String(input.baseUrl || "").replace(/\/+$/, "")}${input.canonicalPath}`;
  return {
    canonicalUrl,
    seoTitle: `${input.title} | MealScout`,
    seoDescription:
      input.description ||
      `${input.title} on MealScout. Local food information, updates, and discovery.`,
    ogImageUrl: input.ogImageUrl || null,
    entityType: input.entityType,
    entityId: input.entityId,
    slug: input.slug,
  };
}
