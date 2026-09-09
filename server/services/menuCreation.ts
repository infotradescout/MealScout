import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { z } from "zod";
import * as schema from "@shared/schema";
import {
  insertMenuSchema,
  lisaClaims,
  LISA_CLAIM_SOURCES,
  LISA_CLAIM_TYPES,
  menus,
  restaurants,
} from "@shared/schema";

type Actor = { id: string; userType: string };

export class MenuCreationError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// Shared by the existing menu route gates and the transaction's authority check.
export const isMenuManagerUserType = (userType?: string | null) =>
  userType === "restaurant_owner" ||
  userType === "staff" ||
  userType === "admin" ||
  userType === "duper_admin" ||
  userType === "super_admin";

export async function createMenuWithLisaRecord(
  database: PgDatabase<any, typeof schema>,
  actor: Actor,
  input: unknown,
  requestKey: unknown,
) {
  if (!actor?.id || !isMenuManagerUserType(actor.userType)) {
    throw new MenuCreationError(403, "menu_access_denied", "Menu management access required");
  }
  const key = z.string().uuid().safeParse(requestKey);
  const parsed = insertMenuSchema.safeParse(input);
  if (!key.success || !parsed.success) {
    throw new MenuCreationError(400, "invalid_menu_creation", "This menu request is invalid. Refresh the page and try again.");
  }
  const requestId = key.data.toLowerCase();
  const body = parsed.data;
  const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");

  try {
    return await database.transaction(async (tx) => {
      // Recheck authority inside the transaction, including when replaying a receipt.
      const [restaurant] = await tx
        .select({ id: restaurants.id, ownerId: restaurants.ownerId })
        .from(restaurants)
        .where(eq(restaurants.id, body.restaurantId))
        .for("update");
      if (!restaurant || (actor.userType === "restaurant_owner" && restaurant.ownerId !== actor.id)) {
        throw new MenuCreationError(403, "menu_access_denied", "Not authorized");
      }

      // The existing primary keys are the durable retry identity. Unlike a cache,
      // the creation observation survives response loss and deletion of the menu.
      const [receipt] = await tx.select().from(lisaClaims).where(eq(lisaClaims.id, requestId));
      if (receipt) {
        const value = receipt.claimValue as Record<string, unknown>;
        if (
          receipt.app !== "mealscout" || receipt.claimType !== LISA_CLAIM_TYPES.MENU_CREATED ||
          receipt.subjectType !== "menu" || receipt.subjectId !== requestId ||
          receipt.actorId !== actor.id || value.restaurantId !== body.restaurantId ||
          value.requestFingerprint !== fingerprint
        ) {
          throw new MenuCreationError(409, "menu_request_reused", "This request was already used for different work. Check your menus before starting another request.");
        }
        const [menu] = await tx.select().from(menus).where(eq(menus.id, requestId));
        if (!menu || menu.restaurantId !== body.restaurantId) {
          throw new MenuCreationError(409, "menu_creation_no_longer_available", "The menu from this request is no longer available. It has not been recreated.");
        }
        return { menu, lisaRecord: { id: receipt.id, status: "recorded" as const }, replayed: true };
      }

      const [menu] = await tx.insert(menus).values({ ...body, id: requestId })
        .onConflictDoNothing().returning();
      if (!menu) {
        throw new MenuCreationError(409, "menu_request_reused", "This request was already used. Check your menus before starting another request.");
      }
      const [record] = await tx.insert(lisaClaims).values({
        id: requestId,
        app: "mealscout",
        claimType: LISA_CLAIM_TYPES.MENU_CREATED,
        source: LISA_CLAIM_SOURCES.MENU,
        subjectType: "menu",
        subjectId: menu.id,
        actorType: "user",
        actorId: actor.id,
        claimValue: {
          schemaVersion: 1,
          restaurantId: menu.restaurantId,
          menuName: menu.name,
          serviceType: menu.serviceType,
          isActive: menu.isActive,
          menuCreatedAt: menu.createdAt?.toISOString() ?? null,
          requestFingerprint: fingerprint,
        },
        createdAt: menu.createdAt,
      }).returning({ id: lisaClaims.id });
      if (!record) throw new Error("Menu creation observation was not recorded");
      return { menu, lisaRecord: { id: record.id, status: "recorded" as const }, replayed: false };
    });
  } catch (error) {
    if (error instanceof MenuCreationError) throw error;
    // A lost commit acknowledgment can be uncertain, not necessarily rolled back.
    // The caller must keep its request ID and resolve that same operation on retry.
    throw new MenuCreationError(503, "menu_creation_unconfirmed", "Menu creation could not be confirmed. Retry this same request; it will not create a second menu.");
  }
}
