import type { Express, NextFunction, Request, Response } from "express";
import { z, ZodError } from "zod";

import { isAuthenticated } from "../unifiedAuth";
import { distributedRateLimit } from "../middleware/distributedRateLimit";
import {
  OWNER_AI_CONNECTOR_SCOPES,
  OWNER_AI_PACKET_JSON_SCHEMA,
} from "@shared/ownerAiActions";
import {
  OwnerAiActionError,
  approveOwnerAiDraft,
  assertActualRestaurantOwner,
  authenticateOwnerAiConnector,
  cancelOwnerAiDraft,
  createOwnerAiConnectorCredential,
  createOwnerAiDraft,
  getOwnerAiContext,
  getOwnerAiDraftForOwner,
  getOwnerAiDraftForConnector,
  getOwnerAiSocialPreview,
  getOwnerAiMediaPreview,
  listOwnerAiConnectorCredentials,
  listOwnerAiDrafts,
  revokeOwnerAiConnectorCredential,
  updateOwnerAiDraft,
  type OwnerAiConnectorPrincipal,
} from "../services/ownerAiActions";

type ConnectorRequest = Request & { ownerAiConnector?: OwnerAiConnectorPrincipal };

const bearerToken = (req: Request) => {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
};

const connectorIdempotencyKey = (req: Request) => {
  const value = String(req.headers["idempotency-key"] || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
    throw new OwnerAiActionError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Connector draft creation requires an Idempotency-Key header (8-200 safe characters)",
    );
  }
  return value;
};

const contextOffsets = (req: Request) => ({
  menuOffset: Math.max(
    0,
    Math.min(100_000, Number.parseInt(String(req.query.menuOffset || "0"), 10) || 0),
  ),
  menuCategoryOffset: Math.max(
    0,
    Math.min(
      100_000,
      Number.parseInt(String(req.query.menuCategoryOffset || "0"), 10) || 0,
    ),
  ),
  menuItemOffset: Math.max(
    0,
    Math.min(
      1_000_000,
      Number.parseInt(String(req.query.menuItemOffset || "0"), 10) || 0,
    ),
  ),
  scheduleOffset: Math.max(
    0,
    Math.min(100_000, Number.parseInt(String(req.query.scheduleOffset || "0"), 10) || 0),
  ),
  dealOffset: Math.max(
    0,
    Math.min(100_000, Number.parseInt(String(req.query.dealOffset || "0"), 10) || 0),
  ),
});

const connectorAuth =
  (scope: (typeof OWNER_AI_CONNECTOR_SCOPES)[number]) =>
  async (req: ConnectorRequest, _res: Response, next: NextFunction) => {
    try {
      req.ownerAiConnector = await authenticateOwnerAiConnector(
        bearerToken(req),
        scope,
      );
      next();
    } catch (error) {
      next(error);
    }
  };

const asyncRoute =
  (handler: (req: any, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };

const credentialCreateSchema = z
  .object({
    restaurantId: z.string().uuid(),
    name: z.string().trim().min(1).max(160).optional(),
    expiresAt: z.string().datetime().optional().nullable(),
  })
  .strict();

const revisionSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();

const updateDraftSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    request: z.unknown(),
  })
  .strict();

const instructions = {
  name: "MealScout Owner AI Actions",
  version: "1.0",
  modelNeutral: true,
  purpose:
    "Let any HTTP-capable AI or tool prepare owner-scoped MealScout changes without granting it approval or publishing authority.",
  sequence: [
    "The owner creates a revocable connector key while signed in to MealScout.",
    "The AI reads /api/owner-ai/connector/context with that key.",
    "The AI submits the same portable JSON draft request used by the owner UI.",
    "MealScout generates deterministic platform copy and branded SVG image previews, while preserving any AI-supplied alternatives.",
    "The signed-in actual owner reviews the packet, media-rights affirmation, generated copy, and generated image previews.",
    "Only explicit owner approval commits MealScout changes and then attempts Facebook, Instagram, and X sequentially.",
    "The same connector can read only its own draft status and safe per-platform results so the AI chat can report the outcome.",
  ],
  safety: {
    connectorCan: [
      "read its attached business context",
      "create drafts",
      "read status/results for drafts created by that exact connector key and business",
    ],
    connectorCannot: [
      "choose a user or business in request payload",
      "update or cancel a draft",
      "approve",
      "apply MealScout changes",
      "publish social posts",
    ],
    remoteMedia:
      "Any supplied logo, cover, gallery, menu, deal, or social image URL requires a packet-level owner rights/usage affirmation visible during approval. MealScout-generated fallback cards require no claim.",
    mutationBoundary:
      "No canonical content write, image hosting, social intent, or social publication occurs before session-authenticated owner approval.",
  },
  portablePacket: {
    schema: "/api/owner-ai/schema",
    openapi: "/api/owner-ai/openapi.json",
    note: "An AI without tool access can return this exact JSON object for the owner to paste into MealScout.",
  },
};

const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "MealScout Owner AI Actions",
    version: "1.0.0",
    description:
      "Vendor-neutral, draft-only connector API. Connector credentials never approve, apply, or publish.",
  },
  servers: [{ url: "https://www.mealscout.us" }],
  components: {
    securitySchemes: {
      connectorBearer: { type: "http", scheme: "bearer" },
      ownerSession: { type: "apiKey", in: "cookie", name: "connect.sid" },
    },
    schemas: { OwnerAiDraftRequest: OWNER_AI_PACKET_JSON_SCHEMA },
  },
  paths: {
    "/api/owner-ai/connector/context": {
      get: {
        operationId: "getMealScoutOwnerContext",
        summary: "Read context for the business encoded in the connector key",
        security: [{ connectorBearer: [] }],
        responses: { "200": { description: "Owner-scoped business context and versions" } },
      },
    },
    "/api/owner-ai/connector/drafts": {
      post: {
        operationId: "createMealScoutOwnerDraft",
        summary: "Create a non-mutating owner approval draft",
        security: [{ connectorBearer: [] }],
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: {
              type: "string",
              minLength: 8,
              maxLength: 200,
              pattern: "^[A-Za-z0-9._:-]+$",
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OwnerAiDraftRequest" },
            },
          },
        },
        responses: {
          "201": { description: "Draft created with approvalUrl" },
          "409": { description: "Context versions are stale" },
        },
      },
    },
    "/api/owner-ai/connector/drafts/{draftId}": {
      get: {
        operationId: "getMealScoutOwnerDraftStatus",
        summary:
          "Read status/results only for a draft created by this exact connector and business",
        security: [{ connectorBearer: [] }],
        parameters: [
          {
            name: "draftId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": { description: "Safe draft and per-platform result status" },
          "404": { description: "Draft not owned by this connector" },
        },
      },
    },
  },
};

export function registerOwnerAiActionRoutes(app: Express) {
  const connectorRateKey = (req: ConnectorRequest) =>
    req.ownerAiConnector?.apiKeyId || "owner-ai-connector-unresolved";
  const connectorContextLimiter = distributedRateLimit({
    scope: "owner-ai:connector-context",
    limit: 120,
    windowMs: 60 * 1000,
    key: connectorRateKey,
  });
  const connectorDraftCreateLimiter = distributedRateLimit({
    scope: "owner-ai:connector-draft-create",
    limit: 30,
    windowMs: 60 * 60 * 1000,
    key: connectorRateKey,
  });
  const connectorDraftStatusLimiter = distributedRateLimit({
    scope: "owner-ai:connector-draft-status",
    limit: 120,
    windowMs: 60 * 1000,
    key: connectorRateKey,
  });

  app.get("/api/owner-ai/instructions", (_req, res) => res.json(instructions));
  app.get("/api/owner-ai/schema", (_req, res) =>
    res.json(OWNER_AI_PACKET_JSON_SCHEMA),
  );
  app.get("/api/owner-ai/openapi.json", (_req, res) =>
    res.json(openApiDocument),
  );

  app.get(
    "/api/owner-ai/connector/context",
    connectorAuth("owner_ai:context"),
    connectorContextLimiter,
    asyncRoute(async (req: ConnectorRequest, res) => {
      res.json(
        await getOwnerAiContext(
          req.ownerAiConnector!.restaurantId,
          contextOffsets(req),
        ),
      );
    }),
  );

  app.post(
    "/api/owner-ai/connector/drafts",
    connectorAuth("owner_ai:drafts:create"),
    connectorDraftCreateLimiter,
    asyncRoute(async (req: ConnectorRequest, res) => {
      const principal = req.ownerAiConnector!;
      const draft = await createOwnerAiDraft({
        restaurantId: principal.restaurantId,
        createdByUserId: principal.userId,
        connectorApiKeyId: principal.apiKeyId,
        idempotencyKey: connectorIdempotencyKey(req),
        request: req.body,
      });
      res.status(201).json(draft);
    }),
  );

  app.get(
    "/api/owner-ai/connector/drafts/:draftId",
    connectorAuth("owner_ai:drafts:read"),
    connectorDraftStatusLimiter,
    asyncRoute(async (req: ConnectorRequest, res) => {
      res.json(
        await getOwnerAiDraftForConnector(
          req.ownerAiConnector!,
          String(req.params.draftId),
        ),
      );
    }),
  );

  app.get(
    "/api/owner-ai/restaurants/:restaurantId/context",
    isAuthenticated,
    asyncRoute(async (req: any, res) => {
      await assertActualRestaurantOwner(
        String(req.user.id),
        String(req.params.restaurantId),
      );
      res.json(
        await getOwnerAiContext(
          String(req.params.restaurantId),
          contextOffsets(req),
        ),
      );
    }),
  );

  app.get(
    "/api/owner-ai/restaurants/:restaurantId/credentials",
    isAuthenticated,
    asyncRoute(async (req: any, res) => {
      res.json({
        credentials: await listOwnerAiConnectorCredentials(
          String(req.user.id),
          String(req.params.restaurantId),
        ),
      });
    }),
  );

  app.post(
    "/api/owner-ai/credentials",
    isAuthenticated,
    asyncRoute(async (req: any, res) => {
      const body = credentialCreateSchema.parse(req.body);
      const result = await createOwnerAiConnectorCredential({
        userId: String(req.user.id),
        restaurantId: body.restaurantId,
        name: body.name,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      });
      res.status(201).json(result);
    }),
  );

  app.post(
    "/api/owner-ai/credentials/:credentialId/revoke",
    isAuthenticated,
    asyncRoute(async (req: any, res) => {
      res.json({
        credential: await revokeOwnerAiConnectorCredential(
          String(req.user.id),
          String(req.params.credentialId),
        ),
      });
    }),
  );

  app.get(
    "/api/owner-ai/restaurants/:restaurantId/drafts",
    isAuthenticated,
    asyncRoute(async (req: any, res) => {
      res.json({
        drafts: await listOwnerAiDrafts(
          String(req.user.id),
          String(req.params.restaurantId),
        ),
      });
    }),
  );

  app.post(
    "/api/owner-ai/restaurants/:restaurantId/drafts",
    isAuthenticated,
    asyncRoute(async (req: any, res) => {
      const restaurantId = String(req.params.restaurantId);
      await assertActualRestaurantOwner(String(req.user.id), restaurantId);
      const draft = await createOwnerAiDraft({
        restaurantId,
        createdByUserId: String(req.user.id),
        request: req.body,
      });
      res.status(201).json(draft);
    }),
  );

  app.get(
    "/api/owner-ai/drafts/:draftId",
    isAuthenticated,
    asyncRoute(async (req: any, res) => {
      res.json(
        await getOwnerAiDraftForOwner(
          String(req.user.id),
          String(req.params.draftId),
        ),
      );
    }),
  );

  app.patch(
    "/api/owner-ai/drafts/:draftId",
    isAuthenticated,
    asyncRoute(async (req: any, res) => {
      const body = updateDraftSchema.parse(req.body);
      res.json(
        await updateOwnerAiDraft({
          userId: String(req.user.id),
          draftId: String(req.params.draftId),
          expectedRevision: body.expectedRevision,
          request: body.request,
        }),
      );
    }),
  );

  app.post(
    "/api/owner-ai/drafts/:draftId/cancel",
    isAuthenticated,
    asyncRoute(async (req: any, res) => {
      const body = revisionSchema.parse(req.body);
      res.json(
        await cancelOwnerAiDraft(
          String(req.user.id),
          String(req.params.draftId),
          body.expectedRevision,
        ),
      );
    }),
  );

  app.post(
    "/api/owner-ai/drafts/:draftId/approve",
    isAuthenticated,
    asyncRoute(async (req: any, res) => {
      const body = revisionSchema.parse(req.body);
      res.json(
        await approveOwnerAiDraft({
          userId: String(req.user.id),
          draftId: String(req.params.draftId),
          expectedRevision: body.expectedRevision,
        }),
      );
    }),
  );

  app.get(
    "/api/owner-ai/drafts/:draftId/media-preview/:assetKey",
    isAuthenticated,
    asyncRoute(async (req: any, res) => {
      const preview = await getOwnerAiMediaPreview(
        String(req.user.id),
        String(req.params.draftId),
        String(req.params.assetKey),
      );
      res.setHeader("Content-Type", preview.contentType);
      res.setHeader("Content-Length", String(preview.buffer.byteLength));
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.send(preview.buffer);
    }),
  );

  app.get(
    "/api/owner-ai/drafts/:draftId/social-preview/:platform.svg",
    isAuthenticated,
    asyncRoute(async (req: any, res) => {
      const platform = z.enum(["facebook", "instagram", "x"]).parse(
        req.params.platform,
      );
      const svg = await getOwnerAiSocialPreview(
        String(req.user.id),
        String(req.params.draftId),
        platform,
      );
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.send(svg);
    }),
  );

  app.use(
    "/api/owner-ai",
    (error: unknown, _req: Request, res: Response, next: NextFunction) => {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: "Invalid owner AI request",
          code: "OWNER_AI_VALIDATION_FAILED",
          issues: error.issues,
        });
      }
      if (error instanceof OwnerAiActionError) {
        return res.status(error.status).json({
          error: error.message,
          code: error.code,
          details: error.details,
        });
      }
      next(error);
    },
  );
}
