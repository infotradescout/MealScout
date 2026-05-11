import { and, eq } from "drizzle-orm";

import { db } from "../db";
import {
  socialPostQueue,
  socialPublishingConnections,
  type SocialPostQueueItem,
  type SocialPublishingConnection,
} from "@shared/schema";

export type PublishResult =
  | { ok: true; providerPostId?: string | null; providerUrl?: string | null }
  | { ok: false; error: string; manualRequired?: boolean };

const asRecord = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};

export async function getActiveSocialConnection(
  restaurantId: string | null | undefined,
  platform: string,
) {
  if (!restaurantId) return null;
  const [connection] = await db
    .select()
    .from(socialPublishingConnections)
    .where(
      and(
        eq(socialPublishingConnections.restaurantId, restaurantId),
        eq(socialPublishingConnections.platform, platform),
        eq(socialPublishingConnections.status, "active"),
      ),
    )
    .limit(1);
  return connection || null;
}

export async function listSocialConnectionStatus(restaurantId: string) {
  const rows = await db
    .select({
      id: socialPublishingConnections.id,
      platform: socialPublishingConnections.platform,
      displayName: socialPublishingConnections.displayName,
      externalAccountId: socialPublishingConnections.externalAccountId,
      externalAccountUrl: socialPublishingConnections.externalAccountUrl,
      scopes: socialPublishingConnections.scopes,
      status: socialPublishingConnections.status,
      tokenExpiresAt: socialPublishingConnections.tokenExpiresAt,
      lastPublishAt: socialPublishingConnections.lastPublishAt,
      lastError: socialPublishingConnections.lastError,
      updatedAt: socialPublishingConnections.updatedAt,
    })
    .from(socialPublishingConnections)
    .where(eq(socialPublishingConnections.restaurantId, restaurantId));

  const byPlatform = new Map<string, (typeof rows)[number]>(
    rows.map((row: (typeof rows)[number]) => [row.platform, row]),
  );
  return ["facebook", "instagram", "x"].map((platform) => {
    const row = byPlatform.get(platform);
    return {
      platform,
      connected: Boolean(row && row.status === "active"),
      ...(row || {}),
      accessTokenStored: undefined,
      refreshTokenStored: undefined,
    };
  });
}

async function updateConnectionPublishState(
  connection: SocialPublishingConnection,
  result: PublishResult,
) {
  await db
    .update(socialPublishingConnections)
    .set({
      lastPublishAt: result.ok ? new Date() : connection.lastPublishAt,
      lastError: result.ok ? null : result.error,
      updatedAt: new Date(),
    })
    .where(eq(socialPublishingConnections.id, connection.id));
}

async function publishFacebook(
  row: SocialPostQueueItem,
  connection: SocialPublishingConnection,
): Promise<PublishResult> {
  const token = connection.accessToken;
  const pageId = connection.externalAccountId;
  if (!token || !pageId) {
    return { ok: false, error: "Facebook Page token is not connected" };
  }

  const endpoint = row.imageUrl
    ? `https://graph.facebook.com/v24.0/${pageId}/photos`
    : `https://graph.facebook.com/v24.0/${pageId}/feed`;
  const body = new URLSearchParams();
  body.set("access_token", token);
  if (row.imageUrl) {
    body.set("url", row.imageUrl);
    body.set("caption", [row.message, row.link].filter(Boolean).join(" "));
  } else {
    body.set("message", row.message);
    if (row.link) body.set("link", row.link);
  }

  const res = await fetch(endpoint, { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data?.error?.message || "Facebook publish failed",
    };
  }
  return { ok: true, providerPostId: data?.post_id || data?.id || null };
}

async function publishInstagram(
  row: SocialPostQueueItem,
  connection: SocialPublishingConnection,
): Promise<PublishResult> {
  const token = connection.accessToken;
  const metadata = asRecord(connection.metadata);
  const igUserId =
    String(metadata.instagramBusinessAccountId || "").trim() ||
    String(connection.externalAccountId || "").trim();
  if (!token || !igUserId) {
    return {
      ok: false,
      error: "Instagram Business account is not connected",
    };
  }
  if (!row.imageUrl) {
    return {
      ok: false,
      manualRequired: true,
      error: "Instagram publishing requires a public image URL",
    };
  }

  const caption = [row.message, row.link].filter(Boolean).join("\n\n");
  const createBody = new URLSearchParams();
  createBody.set("access_token", token);
  createBody.set("image_url", row.imageUrl);
  createBody.set("caption", caption);

  const createRes = await fetch(
    `https://graph.facebook.com/v24.0/${igUserId}/media`,
    { method: "POST", body: createBody },
  );
  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok || !createData?.id) {
    return {
      ok: false,
      error: createData?.error?.message || "Instagram media creation failed",
    };
  }

  const publishBody = new URLSearchParams();
  publishBody.set("access_token", token);
  publishBody.set("creation_id", createData.id);
  const publishRes = await fetch(
    `https://graph.facebook.com/v24.0/${igUserId}/media_publish`,
    { method: "POST", body: publishBody },
  );
  const publishData = await publishRes.json().catch(() => ({}));
  if (!publishRes.ok) {
    return {
      ok: false,
      error: publishData?.error?.message || "Instagram publish failed",
    };
  }
  return { ok: true, providerPostId: publishData?.id || null };
}

async function publishX(
  row: SocialPostQueueItem,
  connection: SocialPublishingConnection,
): Promise<PublishResult> {
  const token = connection.accessToken;
  if (!token) return { ok: false, error: "X access token is not connected" };
  const text = [row.message, row.link].filter(Boolean).join("\n").slice(0, 280);
  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.detail || data?.title || "X publish failed" };
  }
  return { ok: true, providerPostId: data?.data?.id || null };
}

export async function publishSocialQueueItem(
  row: SocialPostQueueItem,
): Promise<PublishResult> {
  const connection = await getActiveSocialConnection(
    row.restaurantId,
    row.platform,
  );
  if (!connection) {
    return {
      ok: false,
      manualRequired: true,
      error: `${row.platform} publishing is not connected for this business`,
    };
  }

  const platform = String(row.platform || "").toLowerCase();
  const result =
    platform === "facebook"
      ? await publishFacebook(row, connection)
      : platform === "instagram"
        ? await publishInstagram(row, connection)
        : platform === "x"
          ? await publishX(row, connection)
          : {
              ok: false as const,
              manualRequired: true,
              error: `Unsupported publishing platform: ${row.platform}`,
            };
  await updateConnectionPublishState(connection, result);
  return result;
}

export async function markSocialPostResult(
  row: SocialPostQueueItem,
  result: PublishResult,
) {
  await db
    .update(socialPostQueue)
    .set({
      status: result.ok
        ? "posted"
        : result.manualRequired
          ? "manual_required"
          : "failed",
      errorMessage: result.ok ? null : result.error,
      metadata: {
        ...asRecord(row.metadata),
        providerPostId: result.ok ? result.providerPostId || null : null,
        providerUrl: result.ok ? result.providerUrl || null : null,
        processedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(socialPostQueue.id, row.id));
}
