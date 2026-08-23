import { normalizePublicUrl } from "../publicProfiles/publicProfileUtils";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { videoStories } from "@shared/schema";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";
import { deriveProfileEvidenceQuarantineVisibility } from "./profileEvidenceQuarantine";

export function publicStoryPublicationWhere(
  now: Date | ReturnType<typeof sql> = sql`NOW()`,
) {
  return and(
    eq(videoStories.status, "ready"),
    eq(videoStories.isApproved, true),
    isNull(videoStories.deletedAt),
    gte(videoStories.expiresAt, now as any),
  );
}

export function isPublicStoryAssociationEligible(input: {
  creatorDisabled: unknown;
  restaurantId: unknown;
  restaurantActive?: unknown;
  restaurantName?: unknown;
  restaurantAddress?: unknown;
  restaurantCity?: unknown;
  restaurantState?: unknown;
  restaurantCuisineType?: unknown;
  restaurantDescription?: unknown;
  restaurantPhone?: unknown;
  restaurantEmail?: unknown;
  restaurantWebsiteUrl?: unknown;
  restaurantOwnerDisabled?: unknown;
  restaurantRawData?: unknown;
}): boolean {
  if (input.creatorDisabled !== false) return false;
  if (!String(input.restaurantId || "").trim()) return true;
  return Boolean(
    input.restaurantActive === true &&
      input.restaurantOwnerDisabled === false &&
      isPublicBusinessVisible({
        name: input.restaurantName as any,
        address: input.restaurantAddress as any,
        city: input.restaurantCity as any,
        state: input.restaurantState as any,
        cuisineType: input.restaurantCuisineType as any,
        description: input.restaurantDescription as any,
      }) &&
      !deriveProfileEvidenceQuarantineVisibility({
        name: input.restaurantName,
        address: input.restaurantAddress,
        city: input.restaurantCity,
        state: input.restaurantState,
        cuisineType: input.restaurantCuisineType,
        description: input.restaurantDescription,
        phone: input.restaurantPhone,
        email: input.restaurantEmail,
        websiteUrl: input.restaurantWebsiteUrl,
        rawData: input.restaurantRawData,
      }).isQuarantined,
  );
}

export function projectPublicStoryRow(
  row: any,
  extras: {
    creatorName?: string | null;
    userLiked?: boolean;
  } = {},
): Record<string, unknown> | null {
  if (!row || typeof row !== "object") return null;

  const id = String(row.id || "").trim();
  const title = String(row.title || "").trim();
  const videoUrl = normalizePublicUrl(row.videoUrl, {
    allowInternalPath: true,
  });
  if (!id || !title || !videoUrl) return null;

  return {
    id,
    restaurantId: row.restaurantId || null,
    title,
    description: row.description || null,
    duration: Number(row.duration || 0),
    videoUrl,
    thumbnailUrl: normalizePublicUrl(row.thumbnailUrl, {
      allowInternalPath: true,
    }),
    status: "ready",
    viewCount: Number(row.viewCount || 0),
    likeCount: Number(row.likeCount || 0),
    commentCount: Number(row.commentCount || 0),
    shareCount: Number(row.shareCount || 0),
    hashtags: Array.isArray(row.hashtags) ? row.hashtags : [],
    cuisine: row.cuisine || null,
    transcript: row.transcript || null,
    transcriptLanguage: row.transcriptLanguage || "en",
    transcriptSource: row.transcriptSource || null,
    createdAt: row.createdAt || null,
    expiresAt: row.expiresAt || null,
    isFeatured: row.isFeatured === true,
    isApproved: true,
    ...(extras.creatorName
      ? { creatorName: String(extras.creatorName).trim() }
      : {}),
    ...(typeof extras.userLiked === "boolean"
      ? { userLiked: extras.userLiked }
      : {}),
  };
}
