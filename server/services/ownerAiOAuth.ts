import bcrypt from "bcryptjs";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import * as https from "node:https";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import {
  apiKeys,
  restaurants,
  socialPublishingConnections,
} from "@shared/schema";
import {
  OWNER_AI_CONNECTOR_SCOPES,
  OWNER_AI_PLATFORMS,
} from "@shared/ownerAiActions";
import { resolvePublicHostname } from "../utils/websiteProfileImport";
import { OwnerAiActionError } from "./ownerAiActions";

const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CLIENT_METADATA_TTL_MS = 5 * 60 * 1000;
const CLIENT_METADATA_MAX_BYTES = 64 * 1024;
const DYNAMIC_CLIENT_PREFIX = "msai_client_";
const AUTHORIZATION_CODE_PREFIX = "msac_";
const ACCESS_TOKEN_PREFIX = "msai_";
const REFRESH_TOKEN_PREFIX = "msrt_";

type OwnerAiOAuthClient = {
  clientId: string;
  clientName: string;
  clientUri: string | null;
  logoUri: string | null;
  redirectUris: string[];
  applicationType: "native" | "web";
  registrationKind: "client_metadata_document" | "dynamic";
};

type StoredCodeMetadata = {
  kind: "owner_ai_oauth_code";
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
};

type StoredRefreshMetadata = {
  kind: "owner_ai_oauth_refresh";
  clientId: string;
  clientName: string;
  resource: string;
  accessKeyId: string;
};

const metadataCache = new Map<
  string,
  { expiresAt: number; value: OwnerAiOAuthClient }
>();

export class OwnerAiOAuthError extends Error {
  constructor(
    public status: number,
    public oauthError: string,
    message: string,
  ) {
    super(message);
  }
}

const oauthBaseUrl = () => {
  const configured = String(
    process.env.OWNER_AI_PUBLIC_BASE_URL ||
      process.env.PUBLIC_BASE_URL ||
      process.env.APP_BASE_URL ||
      "https://www.mealscout.us",
  ).replace(/\/+$/, "");
  try {
    const parsed = new URL(configured);
    if (parsed.hostname.toLowerCase() === "mealscout.us") {
      parsed.hostname = "www.mealscout.us";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return configured;
  }
};

export const ownerAiMcpResourceUrl = () => `${oauthBaseUrl()}/api/owner-ai/mcp`;

const RESTAURANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ownerAiProfileMcpResourceUrl = (restaurantId: string) => {
  const normalizedId = String(restaurantId || "")
    .trim()
    .toLowerCase();
  if (!RESTAURANT_ID_PATTERN.test(normalizedId)) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_target",
      "MealScout profile target is invalid",
    );
  }
  return `${oauthBaseUrl()}/api/owner-ai/profiles/${encodeURIComponent(normalizedId)}/mcp`;
};

export function resolveOwnerAiMcpResource(value: unknown): {
  resource: string;
  restaurantId: string | null;
} | null {
  try {
    const expectedBase = new URL(oauthBaseUrl());
    const parsed = new URL(String(value || ""));
    if (parsed.origin !== expectedBase.origin || parsed.search || parsed.hash)
      return null;
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    if (pathname === "/api/owner-ai/mcp") {
      return { resource: ownerAiMcpResourceUrl(), restaurantId: null };
    }
    const match = pathname.match(
      /^\/api\/owner-ai\/profiles\/([0-9a-f-]+)\/mcp$/i,
    );
    if (!match || !RESTAURANT_ID_PATTERN.test(match[1])) return null;
    const restaurantId = match[1].toLowerCase();
    return {
      resource: ownerAiProfileMcpResourceUrl(restaurantId),
      restaurantId,
    };
  } catch {
    return null;
  }
}

export const ownerAiProtectedResourceMetadata = (
  resource = ownerAiMcpResourceUrl(),
) => {
  const resolved = resolveOwnerAiMcpResource(resource);
  if (!resolved) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_target",
      "MealScout protected resource target is invalid",
    );
  }
  return {
    resource: resolved.resource,
    authorization_servers: [oauthBaseUrl()],
    bearer_methods_supported: ["header"],
    scopes_supported: [...OWNER_AI_CONNECTOR_SCOPES],
    resource_name: "MealScout Owner AI",
  };
};

export const ownerAiAuthorizationServerMetadata = () => ({
  issuer: oauthBaseUrl(),
  authorization_endpoint: `${oauthBaseUrl()}/owner-ai/authorize`,
  token_endpoint: `${oauthBaseUrl()}/api/owner-ai/oauth/token`,
  registration_endpoint: `${oauthBaseUrl()}/api/owner-ai/oauth/register`,
  revocation_endpoint: `${oauthBaseUrl()}/api/owner-ai/oauth/revoke`,
  response_types_supported: ["code"],
  response_modes_supported: ["query"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  token_endpoint_auth_methods_supported: ["none"],
  code_challenge_methods_supported: ["S256"],
  scopes_supported: [...OWNER_AI_CONNECTOR_SCOPES],
  client_id_metadata_document_supported: true,
});

const sha256Hex = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const sha256Base64Url = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("base64url");

const oauthSigningSecret = () => {
  const secret = String(
    process.env.OWNER_AI_OAUTH_SECRET || process.env.SESSION_SECRET || "",
  );
  if (secret.length < 32) {
    throw new OwnerAiOAuthError(
      503,
      "temporarily_unavailable",
      "MealScout AI sign-in is not configured on this environment",
    );
  }
  return secret;
};

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.byteLength === rightBuffer.byteLength &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const isLoopbackHostname = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

function normalizeRedirectUri(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2048) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_client_metadata",
      "Invalid redirect URI",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new OwnerAiOAuthError(
      400,
      "invalid_client_metadata",
      "Invalid redirect URI",
    );
  }
  if (parsed.hash || parsed.username || parsed.password) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_client_metadata",
      "Invalid redirect URI",
    );
  }
  const allowed =
    parsed.protocol === "https:" ||
    (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname));
  if (!allowed) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_client_metadata",
      "Redirect URIs must use HTTPS or an HTTP loopback address",
    );
  }
  return parsed.toString();
}

const clientMetadataSchema = z
  .object({
    client_id: z.string().trim().min(1).max(4096),
    client_name: z.string().trim().min(1).max(200),
    client_uri: z.string().url().max(2048).optional(),
    logo_uri: z.string().url().max(2048).optional(),
    redirect_uris: z.array(z.string()).min(1).max(20),
    application_type: z.enum(["native", "web"]).optional(),
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional(),
    token_endpoint_auth_method: z.string().optional(),
  })
  .passthrough();

function requestPinnedClientMetadata(
  parsed: URL,
  address: string,
  family: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: "https:",
        hostname: address,
        family,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        servername: parsed.hostname,
        rejectUnauthorized: true,
        headers: {
          Host: parsed.host,
          Accept: "application/json",
          "User-Agent": "MealScoutOAuth/1.0 (+https://www.mealscout.us)",
          Connection: "close",
        },
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status < 200 || status >= 300) {
          response.resume();
          reject(new Error(`Client metadata request failed (${status})`));
          return;
        }
        const declaredBytes = Number(response.headers["content-length"] || 0);
        if (declaredBytes > CLIENT_METADATA_MAX_BYTES) {
          response.resume();
          reject(new Error("Client metadata is too large"));
          return;
        }
        const chunks: Buffer[] = [];
        let byteLength = 0;
        response.on("data", (chunk: Buffer | Uint8Array) => {
          const buffer = Buffer.from(chunk);
          byteLength += buffer.byteLength;
          if (byteLength > CLIENT_METADATA_MAX_BYTES) {
            response.destroy(new Error("Client metadata is too large"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("Client metadata is not valid JSON"));
          }
        });
        response.on("error", reject);
      },
    );
    request.setTimeout(5_000, () =>
      request.destroy(new Error("Client metadata request timed out")),
    );
    request.on("error", reject);
    request.end();
  });
}

async function readClientMetadataDocument(clientId: string) {
  let parsed: URL;
  try {
    parsed = new URL(clientId);
  } catch {
    throw new OwnerAiOAuthError(400, "invalid_client", "Unknown OAuth client");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.pathname === "/"
  ) {
    throw new OwnerAiOAuthError(400, "invalid_client", "Unknown OAuth client");
  }

  const cached = metadataCache.get(clientId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const records = await resolvePublicHostname(parsed.hostname).catch(() => []);
  if (!records.length) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_client",
      "OAuth client metadata is unreachable",
    );
  }
  let document: unknown = null;
  let lastError: unknown = null;
  for (const record of records.slice(0, 4)) {
    try {
      document = await requestPinnedClientMetadata(
        parsed,
        record.address,
        record.family,
      );
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!document) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_client",
      lastError instanceof Error
        ? lastError.message
        : "OAuth client metadata is unreachable",
    );
  }
  const metadata = clientMetadataSchema.safeParse(document);
  if (!metadata.success || metadata.data.client_id !== clientId) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_client",
      "OAuth client metadata did not match its client ID",
    );
  }
  if (
    metadata.data.grant_types &&
    !metadata.data.grant_types.includes("authorization_code")
  ) {
    throw new OwnerAiOAuthError(
      400,
      "unauthorized_client",
      "Client does not support authorization code login",
    );
  }
  if (
    metadata.data.response_types &&
    !metadata.data.response_types.includes("code")
  ) {
    throw new OwnerAiOAuthError(
      400,
      "unauthorized_client",
      "Client does not support code responses",
    );
  }
  if (
    metadata.data.token_endpoint_auth_method &&
    metadata.data.token_endpoint_auth_method !== "none"
  ) {
    throw new OwnerAiOAuthError(
      400,
      "unauthorized_client",
      "Only public PKCE clients are supported",
    );
  }
  const value: OwnerAiOAuthClient = {
    clientId,
    clientName: metadata.data.client_name,
    clientUri: metadata.data.client_uri || null,
    logoUri: metadata.data.logo_uri || null,
    redirectUris: [
      ...new Set(metadata.data.redirect_uris.map(normalizeRedirectUri)),
    ],
    applicationType: metadata.data.application_type || "web",
    registrationKind: "client_metadata_document",
  };
  metadataCache.set(clientId, {
    expiresAt: Date.now() + CLIENT_METADATA_TTL_MS,
    value,
  });
  if (metadataCache.size > 100) {
    const oldest = metadataCache.keys().next().value;
    if (oldest) metadataCache.delete(oldest);
  }
  return value;
}

function signDynamicClient(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createHmac("sha256", oauthSigningSecret())
    .update(encoded)
    .digest("base64url");
  return `${DYNAMIC_CLIENT_PREFIX}${encoded}.${signature}`;
}

function readDynamicClient(clientId: string): OwnerAiOAuthClient {
  const compact = clientId.slice(DYNAMIC_CLIENT_PREFIX.length);
  const [encoded, signature, extra] = compact.split(".");
  if (!encoded || !signature || extra) {
    throw new OwnerAiOAuthError(400, "invalid_client", "Unknown OAuth client");
  }
  const expected = createHmac("sha256", oauthSigningSecret())
    .update(encoded)
    .digest("base64url");
  if (!safeEqual(signature, expected)) {
    throw new OwnerAiOAuthError(400, "invalid_client", "Unknown OAuth client");
  }
  let payload: any;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new OwnerAiOAuthError(400, "invalid_client", "Unknown OAuth client");
  }
  if (
    payload?.kind !== "owner_ai_dynamic_client" ||
    !Array.isArray(payload.redirectUris) ||
    Number(payload.expiresAt || 0) <= Date.now()
  ) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_client",
      "OAuth client registration expired",
    );
  }
  return {
    clientId,
    clientName: String(payload.clientName || "AI client").slice(0, 200),
    clientUri: payload.clientUri
      ? String(payload.clientUri).slice(0, 2048)
      : null,
    logoUri: payload.logoUri ? String(payload.logoUri).slice(0, 2048) : null,
    redirectUris: payload.redirectUris.map(normalizeRedirectUri),
    applicationType: payload.applicationType === "native" ? "native" : "web",
    registrationKind: "dynamic",
  };
}

export async function resolveOwnerAiOAuthClient(clientIdValue: unknown) {
  const clientId = String(clientIdValue || "").trim();
  if (!clientId || clientId.length > 16_000) {
    throw new OwnerAiOAuthError(400, "invalid_client", "Unknown OAuth client");
  }
  if (clientId.startsWith(DYNAMIC_CLIENT_PREFIX))
    return readDynamicClient(clientId);
  return readClientMetadataDocument(clientId);
}

const registrationSchema = z
  .object({
    client_name: z.string().trim().min(1).max(200),
    client_uri: z.string().url().max(2048).optional(),
    logo_uri: z.string().url().max(2048).optional(),
    redirect_uris: z.array(z.string()).min(1).max(20),
    application_type: z.enum(["native", "web"]).default("web"),
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional(),
    token_endpoint_auth_method: z.string().optional(),
  })
  .passthrough();

export function registerOwnerAiOAuthClient(input: unknown) {
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_client_metadata",
      "Invalid OAuth client registration",
    );
  }
  if (
    parsed.data.grant_types &&
    !parsed.data.grant_types.includes("authorization_code")
  ) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_client_metadata",
      "authorization_code is required",
    );
  }
  if (
    parsed.data.response_types &&
    !parsed.data.response_types.includes("code")
  ) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_client_metadata",
      "code response type is required",
    );
  }
  if (
    parsed.data.token_endpoint_auth_method &&
    parsed.data.token_endpoint_auth_method !== "none"
  ) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_client_metadata",
      "Only public PKCE clients are supported",
    );
  }
  const redirectUris = [
    ...new Set(parsed.data.redirect_uris.map(normalizeRedirectUri)),
  ];
  const now = Date.now();
  const expiresAt = now + 365 * 24 * 60 * 60 * 1000;
  const clientId = signDynamicClient({
    kind: "owner_ai_dynamic_client",
    clientName: parsed.data.client_name,
    clientUri: parsed.data.client_uri || null,
    logoUri: parsed.data.logo_uri || null,
    redirectUris,
    applicationType: parsed.data.application_type,
    issuedAt: now,
    expiresAt,
  });
  if (clientId.length > 16_000) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_client_metadata",
      "OAuth client registration is too large",
    );
  }
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(now / 1000),
    client_id_expires_at: Math.floor(expiresAt / 1000),
    client_name: parsed.data.client_name,
    client_uri: parsed.data.client_uri,
    logo_uri: parsed.data.logo_uri,
    redirect_uris: redirectUris,
    application_type: parsed.data.application_type,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

const authorizationQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().trim().min(1).max(16_000),
  redirect_uri: z.string().trim().min(1).max(2048),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  code_challenge_method: z.literal("S256"),
  scope: z.string().trim().max(1000).optional(),
  state: z.string().max(2048).optional(),
  resource: z.string().trim().min(1).max(2048),
});

export async function prepareOwnerAiAuthorization(
  input: unknown,
  userId: string,
) {
  const parsed = authorizationQuerySchema.safeParse(input);
  if (!parsed.success) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_request",
      "Invalid OAuth authorization request",
    );
  }
  const resolvedResource = resolveOwnerAiMcpResource(parsed.data.resource);
  if (!resolvedResource) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_target",
      "Token must target the MealScout Owner AI resource",
    );
  }
  const client = await resolveOwnerAiOAuthClient(parsed.data.client_id);
  const redirectUri = normalizeRedirectUri(parsed.data.redirect_uri);
  if (!client.redirectUris.includes(redirectUri)) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_request",
      "Redirect URI is not registered for this AI client",
    );
  }
  const requestedScopes = String(
    parsed.data.scope || OWNER_AI_CONNECTOR_SCOPES.join(" "),
  )
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (
    !requestedScopes.length ||
    requestedScopes.some(
      (scope) =>
        !OWNER_AI_CONNECTOR_SCOPES.includes(
          scope as (typeof OWNER_AI_CONNECTOR_SCOPES)[number],
        ),
    )
  ) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_scope",
      "Unsupported MealScout AI scope",
    );
  }
  const scopes = [...new Set(requestedScopes)];
  const ownedBusinesses = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      businessType: restaurants.businessType,
      isFoodTruck: restaurants.isFoodTruck,
    })
    .from(restaurants)
    .where(eq(restaurants.ownerId, userId));
  const targetBusinesses = resolvedResource.restaurantId
    ? ownedBusinesses.filter(
        (business: any) => business.id === resolvedResource.restaurantId,
      )
    : ownedBusinesses;
  const restaurantIds = targetBusinesses.map((business: any) => business.id);
  const connectionRows = restaurantIds.length
    ? await db
        .select({
          restaurantId: socialPublishingConnections.restaurantId,
          platform: socialPublishingConnections.platform,
          displayName: socialPublishingConnections.displayName,
          status: socialPublishingConnections.status,
          accessToken: socialPublishingConnections.accessToken,
        })
        .from(socialPublishingConnections)
        .where(inArray(socialPublishingConnections.restaurantId, restaurantIds))
    : [];
  return {
    request: parsed.data,
    client,
    scopes,
    targetRestaurantId: resolvedResource.restaurantId,
    businesses: targetBusinesses.map((business: any) => ({
      ...business,
      socialConnections: OWNER_AI_PLATFORMS.map((platform) => {
        const row = connectionRows.find(
          (candidate: any) =>
            candidate.restaurantId === business.id &&
            candidate.platform === platform,
        );
        return {
          platform,
          connected: Boolean(row?.status === "active" && row?.accessToken),
          displayName: row?.displayName || null,
        };
      }),
    })),
  };
}

const codeMetadata = (row: any): StoredCodeMetadata => {
  try {
    const parsed = JSON.parse(String(row.name || ""));
    if (parsed?.kind === "owner_ai_oauth_code") return parsed;
  } catch {
    // Fall through to the standard OAuth error below.
  }
  throw new OwnerAiOAuthError(
    400,
    "invalid_grant",
    "Authorization code is invalid",
  );
};

const refreshMetadata = (row: any): StoredRefreshMetadata => {
  try {
    const parsed = JSON.parse(String(row.name || ""));
    if (parsed?.kind === "owner_ai_oauth_refresh") return parsed;
  } catch {
    // Fall through to the standard OAuth error below.
  }
  throw new OwnerAiOAuthError(400, "invalid_grant", "Refresh token is invalid");
};

export async function authorizeOwnerAiClient(input: unknown, userId: string) {
  const consentSchema = authorizationQuerySchema.extend({
    restaurant_id: z.string().uuid(),
  });
  const parsed = consentSchema.safeParse(input);
  if (!parsed.success) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_request",
      "Invalid OAuth consent request",
    );
  }
  const prepared = await prepareOwnerAiAuthorization(parsed.data, userId);
  const business = prepared.businesses.find(
    (candidate: any) => candidate.id === parsed.data.restaurant_id,
  );
  if (!business) {
    throw new OwnerAiOAuthError(
      403,
      "access_denied",
      "Only the actual business owner can connect this AI",
    );
  }
  if (
    !business.socialConnections.some((connection: any) => connection.connected)
  ) {
    throw new OwnerAiOAuthError(
      409,
      "access_denied",
      "Connect at least one social publishing account in MealScout before linking an AI",
    );
  }
  const rawCode = `${AUTHORIZATION_CODE_PREFIX}${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS);
  const metadata: StoredCodeMetadata = {
    kind: "owner_ai_oauth_code",
    clientId: prepared.client.clientId,
    clientName: prepared.client.clientName,
    redirectUri: normalizeRedirectUri(parsed.data.redirect_uri),
    codeChallenge: parsed.data.code_challenge,
    resource: parsed.data.resource,
  };
  await db.insert(apiKeys).values({
    userId,
    restaurantId: business.id,
    name: JSON.stringify(metadata),
    keyHash: sha256Hex(rawCode),
    keyPrefix: rawCode.slice(0, 8),
    scope: prepared.scopes.join(" "),
    purpose: "owner_ai_oauth_code",
    isActive: true,
    expiresAt,
    updatedAt: now,
  });
  const redirect = new URL(metadata.redirectUri);
  redirect.searchParams.set("code", rawCode);
  if (parsed.data.state) redirect.searchParams.set("state", parsed.data.state);
  redirect.searchParams.set("iss", oauthBaseUrl());
  return { redirectTo: redirect.toString() };
}

export async function denyOwnerAiClient(input: unknown, userId: string) {
  const prepared = await prepareOwnerAiAuthorization(input, userId);
  const redirect = new URL(prepared.request.redirect_uri);
  redirect.searchParams.set("error", "access_denied");
  redirect.searchParams.set(
    "error_description",
    "The MealScout owner declined this AI connection",
  );
  if (prepared.request.state) {
    redirect.searchParams.set("state", prepared.request.state);
  }
  redirect.searchParams.set("iss", oauthBaseUrl());
  return { redirectTo: redirect.toString() };
}

const tokenResponse = (
  accessToken: string,
  refreshToken: string,
  scope: string,
) => ({
  access_token: accessToken,
  token_type: "Bearer",
  expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
  refresh_token: refreshToken,
  scope,
});

async function findStoredToken(rawToken: string, purpose: string) {
  const candidates = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.keyPrefix, rawToken.slice(0, 8)),
        eq(apiKeys.purpose, purpose),
        eq(apiKeys.isActive, true),
      ),
    );
  return candidates.find((candidate: any) => {
    if (candidate.revokedAt) return false;
    if (candidate.expiresAt && candidate.expiresAt <= new Date()) return false;
    return safeEqual(candidate.keyHash, sha256Hex(rawToken));
  });
}

async function exchangeAuthorizationCode(input: Record<string, unknown>) {
  const schema = z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().trim().min(32).max(500),
    client_id: z.string().trim().min(1).max(16_000),
    redirect_uri: z.string().trim().min(1).max(2048),
    code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
    resource: z.string().trim().min(1).max(2048),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_request",
      "Invalid authorization code exchange",
    );
  }
  const row = await findStoredToken(parsed.data.code, "owner_ai_oauth_code");
  if (!row)
    throw new OwnerAiOAuthError(
      400,
      "invalid_grant",
      "Authorization code is invalid or expired",
    );
  const metadata = codeMetadata(row);
  if (
    metadata.clientId !== parsed.data.client_id ||
    metadata.redirectUri !== normalizeRedirectUri(parsed.data.redirect_uri) ||
    metadata.resource !== parsed.data.resource ||
    !resolveOwnerAiMcpResource(parsed.data.resource) ||
    !safeEqual(
      metadata.codeChallenge,
      sha256Base64Url(parsed.data.code_verifier),
    )
  ) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_grant",
      "Authorization code binding failed",
    );
  }
  await resolveOwnerAiOAuthClient(parsed.data.client_id);

  const rawAccess = `${ACCESS_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const rawRefresh = `${REFRESH_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const accessHash = await bcrypt.hash(rawAccess, 12);
  const refreshHash = sha256Hex(rawRefresh);
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
  const scope = String(row.scope || OWNER_AI_CONNECTOR_SCOPES.join(" "));

  await db.transaction(async (tx: any) => {
    const [consumed] = await tx
      .update(apiKeys)
      .set({ isActive: false, revokedAt: now, updatedAt: now })
      .where(and(eq(apiKeys.id, row.id), eq(apiKeys.isActive, true)))
      .returning({ id: apiKeys.id });
    if (!consumed) {
      throw new OwnerAiOAuthError(
        400,
        "invalid_grant",
        "Authorization code was already used",
      );
    }
    const [ownerBusiness] = await tx
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(
        and(
          eq(restaurants.id, row.restaurantId),
          eq(restaurants.ownerId, row.userId),
        ),
      )
      .limit(1);
    if (!ownerBusiness) {
      throw new OwnerAiOAuthError(
        403,
        "access_denied",
        "Business ownership changed before AI sign-in completed",
      );
    }
    const [access] = await tx
      .insert(apiKeys)
      .values({
        userId: row.userId,
        restaurantId: row.restaurantId,
        name: `${metadata.clientName} via MealScout login`,
        keyHash: accessHash,
        keyPrefix: rawAccess.slice(0, 8),
        scope,
        purpose: "owner_ai_connector",
        isActive: true,
        expiresAt: accessExpiresAt,
        updatedAt: now,
      })
      .returning({ id: apiKeys.id });
    const refresh: StoredRefreshMetadata = {
      kind: "owner_ai_oauth_refresh",
      clientId: metadata.clientId,
      clientName: metadata.clientName,
      resource: metadata.resource,
      accessKeyId: access.id,
    };
    await tx.insert(apiKeys).values({
      userId: row.userId,
      restaurantId: row.restaurantId,
      name: JSON.stringify(refresh),
      keyHash: refreshHash,
      keyPrefix: rawRefresh.slice(0, 8),
      scope,
      purpose: "owner_ai_oauth_refresh",
      isActive: true,
      expiresAt: refreshExpiresAt,
      updatedAt: now,
    });
  });
  return tokenResponse(rawAccess, rawRefresh, scope);
}

async function exchangeRefreshToken(input: Record<string, unknown>) {
  const schema = z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().trim().min(32).max(500),
    client_id: z.string().trim().min(1).max(16_000),
    resource: z.string().trim().min(1).max(2048),
    scope: z.string().trim().max(1000).optional(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_request",
      "Invalid refresh token exchange",
    );
  }
  const row = await findStoredToken(
    parsed.data.refresh_token,
    "owner_ai_oauth_refresh",
  );
  if (!row)
    throw new OwnerAiOAuthError(
      400,
      "invalid_grant",
      "Refresh token is invalid or expired",
    );
  const metadata = refreshMetadata(row);
  if (
    metadata.clientId !== parsed.data.client_id ||
    metadata.resource !== parsed.data.resource ||
    !resolveOwnerAiMcpResource(parsed.data.resource)
  ) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_grant",
      "Refresh token binding failed",
    );
  }
  await resolveOwnerAiOAuthClient(parsed.data.client_id);
  const originalScopes = String(row.scope || "")
    .split(/\s+/)
    .filter(Boolean);
  const requestedScopes = String(parsed.data.scope || row.scope || "")
    .split(/\s+/)
    .filter(Boolean);
  if (
    !requestedScopes.length ||
    requestedScopes.some((scope) => !originalScopes.includes(scope))
  ) {
    throw new OwnerAiOAuthError(
      400,
      "invalid_scope",
      "Refresh cannot expand MealScout permissions",
    );
  }
  const scope = [...new Set(requestedScopes)].join(" ");

  const rawAccess = `${ACCESS_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const rawRefresh = `${REFRESH_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const accessHash = await bcrypt.hash(rawAccess, 12);
  const refreshHash = sha256Hex(rawRefresh);
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

  await db.transaction(async (tx: any) => {
    const [rotated] = await tx
      .update(apiKeys)
      .set({ isActive: false, revokedAt: now, updatedAt: now })
      .where(and(eq(apiKeys.id, row.id), eq(apiKeys.isActive, true)))
      .returning({ id: apiKeys.id });
    if (!rotated) {
      throw new OwnerAiOAuthError(
        400,
        "invalid_grant",
        "Refresh token was already used",
      );
    }
    const [currentAccess] = await tx
      .select({
        id: apiKeys.id,
        isActive: apiKeys.isActive,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.id, metadata.accessKeyId))
      .limit(1);
    if (!currentAccess?.isActive || currentAccess.revokedAt) {
      throw new OwnerAiOAuthError(
        400,
        "invalid_grant",
        "MealScout AI connection was revoked",
      );
    }
    const [ownerBusiness] = await tx
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(
        and(
          eq(restaurants.id, row.restaurantId),
          eq(restaurants.ownerId, row.userId),
        ),
      )
      .limit(1);
    if (!ownerBusiness) {
      throw new OwnerAiOAuthError(
        403,
        "access_denied",
        "Business ownership changed",
      );
    }
    await tx
      .update(apiKeys)
      .set({ isActive: false, revokedAt: now, updatedAt: now })
      .where(eq(apiKeys.id, metadata.accessKeyId));
    const [access] = await tx
      .insert(apiKeys)
      .values({
        userId: row.userId,
        restaurantId: row.restaurantId,
        name: `${metadata.clientName} via MealScout login`,
        keyHash: accessHash,
        keyPrefix: rawAccess.slice(0, 8),
        scope,
        purpose: "owner_ai_connector",
        isActive: true,
        expiresAt: accessExpiresAt,
        updatedAt: now,
      })
      .returning({ id: apiKeys.id });
    const nextRefresh: StoredRefreshMetadata = {
      ...metadata,
      accessKeyId: access.id,
    };
    await tx.insert(apiKeys).values({
      userId: row.userId,
      restaurantId: row.restaurantId,
      name: JSON.stringify(nextRefresh),
      keyHash: refreshHash,
      keyPrefix: rawRefresh.slice(0, 8),
      scope,
      purpose: "owner_ai_oauth_refresh",
      isActive: true,
      expiresAt: refreshExpiresAt,
      updatedAt: now,
    });
  });
  return tokenResponse(rawAccess, rawRefresh, scope);
}

export async function exchangeOwnerAiOAuthToken(input: unknown) {
  const body =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  if (body.grant_type === "authorization_code")
    return exchangeAuthorizationCode(body);
  if (body.grant_type === "refresh_token") return exchangeRefreshToken(body);
  throw new OwnerAiOAuthError(
    400,
    "unsupported_grant_type",
    "Unsupported OAuth grant type",
  );
}

export async function revokeOwnerAiOAuthToken(input: unknown) {
  const body = z
    .object({ token: z.string().trim().min(24).max(500) })
    .passthrough()
    .safeParse(input);
  if (!body.success) return;
  const rawToken = body.data.token;
  if (rawToken.startsWith(REFRESH_TOKEN_PREFIX)) {
    const row = await findStoredToken(rawToken, "owner_ai_oauth_refresh");
    if (!row) return;
    const metadata = refreshMetadata(row);
    await db.transaction(async (tx: any) => {
      const now = new Date();
      await tx
        .update(apiKeys)
        .set({ isActive: false, revokedAt: now, updatedAt: now })
        .where(eq(apiKeys.id, row.id));
      await tx
        .update(apiKeys)
        .set({ isActive: false, revokedAt: now, updatedAt: now })
        .where(eq(apiKeys.id, metadata.accessKeyId));
    });
    return;
  }
  if (rawToken.startsWith(ACCESS_TOKEN_PREFIX)) {
    const candidates = await db
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.keyPrefix, rawToken.slice(0, 8)),
          eq(apiKeys.purpose, "owner_ai_connector"),
          eq(apiKeys.isActive, true),
        ),
      );
    let access: any = null;
    for (const candidate of candidates) {
      if (
        await bcrypt.compare(rawToken, candidate.keyHash).catch(() => false)
      ) {
        access = candidate;
        break;
      }
    }
    if (!access) return;
    const refreshRows = await db
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.userId, access.userId),
          eq(apiKeys.restaurantId, access.restaurantId),
          eq(apiKeys.purpose, "owner_ai_oauth_refresh"),
          eq(apiKeys.isActive, true),
        ),
      );
    const linkedRefreshIds = refreshRows
      .filter((row: any) => {
        try {
          return refreshMetadata(row).accessKeyId === access.id;
        } catch {
          return false;
        }
      })
      .map((row: any) => row.id);
    const now = new Date();
    await db.transaction(async (tx: any) => {
      await tx
        .update(apiKeys)
        .set({ isActive: false, revokedAt: now, updatedAt: now })
        .where(eq(apiKeys.id, access.id));
      if (linkedRefreshIds.length) {
        await tx
          .update(apiKeys)
          .set({ isActive: false, revokedAt: now, updatedAt: now })
          .where(inArray(apiKeys.id, linkedRefreshIds));
      }
    });
  }
}

export async function revokeRefreshTokensForAccessKey(
  userId: string,
  restaurantId: string,
  accessKeyId: string,
) {
  const rows = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.userId, userId),
        eq(apiKeys.restaurantId, restaurantId),
        eq(apiKeys.purpose, "owner_ai_oauth_refresh"),
        eq(apiKeys.isActive, true),
      ),
    );
  const ids = rows
    .filter((row: any) => {
      try {
        return refreshMetadata(row).accessKeyId === accessKeyId;
      } catch {
        return false;
      }
    })
    .map((row: any) => row.id);
  if (!ids.length) return;
  const now = new Date();
  await db
    .update(apiKeys)
    .set({ isActive: false, revokedAt: now, updatedAt: now })
    .where(inArray(apiKeys.id, ids));
}

export function ownerAiOAuthChallengeHeader(restaurantId?: string | null) {
  const metadataPath = restaurantId
    ? `/api/owner-ai/profiles/${encodeURIComponent(restaurantId)}/mcp`
    : "/api/owner-ai/mcp";
  return `Bearer resource_metadata="${oauthBaseUrl()}/.well-known/oauth-protected-resource${metadataPath}", scope="${OWNER_AI_CONNECTOR_SCOPES.join(" ")}"`;
}

export function toOwnerAiOAuthError(error: unknown) {
  if (error instanceof OwnerAiOAuthError) return error;
  if (error instanceof OwnerAiActionError) {
    return new OwnerAiOAuthError(error.status, "access_denied", error.message);
  }
  return new OwnerAiOAuthError(
    500,
    "server_error",
    "MealScout AI sign-in failed",
  );
}
