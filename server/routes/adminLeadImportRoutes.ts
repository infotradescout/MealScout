import crypto from "crypto";
import type { Express } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import { storage } from "../storage";
import { emailService, isEmailConfigured } from "../emailService";
import { db } from "../db";
import { queueGoogleRestaurantAutoLink } from "../services/googleBusinessAutoLink";
import {
  CLAIM_TYPES,
  claims,
  hosts,
  menuCategories,
  menuImportLogs,
  menuItems,
  menus,
  restaurants,
  users,
} from "@shared/schema";
import { logAudit } from "../auditLogger";

class LeadImportError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, message: string, code = "lead_import_error", details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const importableLeadUserTypes = [
  "customer",
  "restaurant_owner",
  "food_truck",
  "host",
  "event_coordinator",
] as const;

const privilegedUserTypes = new Set(["staff", "admin", "super_admin"]);

export function isPrivilegedLeadImportUserType(userType: string | null | undefined) {
  return privilegedUserTypes.has(String(userType || ""));
}

const importedUserSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().optional().default(""),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().optional().default(""),
  userType: z.literal("host").default("host"),
});

const importedHostSchema = z.object({
  name: z.string().trim().min(1),
  category: z.string().trim().optional().default("host_location"),
  website: z.string().trim().url().optional().or(z.literal("")),
  address: z.string().trim().min(1),
  city: z.string().trim().min(1),
  state: z.string().trim().min(2),
  zip: z.string().trim().optional().default(""),
  contactName: z.string().trim().optional().default(""),
  contactTitle: z.string().trim().optional().default(""),
  contactEmail: z.string().trim().email().optional(),
  contactPhone: z.string().trim().optional().default(""),
});

const importedEventRequestSchema = z.object({
  eventName: z.string().trim().min(1),
  eventDate: z.string().trim().min(1),
  startTime: z.string().trim().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().trim().regex(/^\d{2}:\d{2}$/),
  timeDisplay: z.string().trim().optional().default(""),
  requestedVendorType: z.string().trim().min(1),
  status: z.string().trim().optional().default("needs_truck_match"),
  visibility: z.string().trim().optional().default("public"),
  requestSummary: z.string().trim().optional().default(""),
  requestedDetailsFromTruck: z.array(z.string().trim()).optional().default([]),
  detailsAvailableBy: z.string().trim().optional().default("Contact event organizer"),
  missingFields: z.array(z.string().trim()).optional().default([]),
});

const hostEventLeadImportSchema = z.object({
  type: z.literal("host_event").optional(),
  source: z.string().trim().optional().default("admin_lead_import"),
  sendVerificationEmail: z.boolean().optional().default(true),
  user: importedUserSchema,
  host: importedHostSchema,
  eventRequest: importedEventRequestSchema,
  rawSource: z.record(z.any()).optional().default({}),
});

const importedAccountSchema = z.object({
  type: z.literal("account").optional(),
  source: z.string().trim().optional().default("admin_lead_import"),
  sendVerificationEmail: z.boolean().optional().default(true),
  user: importedUserSchema.extend({
    userType: z.enum(importableLeadUserTypes).default("customer"),
  }),
  rawSource: z.record(z.any()).optional().default({}),
});

const importedBusinessSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().min(1),
  city: z.string().trim().optional().default(""),
  state: z.string().trim().optional().default(""),
  phone: z.string().trim().optional().default(""),
  cuisineType: z.string().trim().optional().default("Various"),
  description: z.string().trim().optional().default(""),
  websiteUrl: z.string().trim().url().optional().or(z.literal("")),
  menuUrl: z.string().trim().url().optional().or(z.literal("")),
  instagramUrl: z.string().trim().url().optional().or(z.literal("")),
  facebookPageUrl: z.string().trim().url().optional().or(z.literal("")),
  latitude: z.union([z.number(), z.string()]).optional(),
  longitude: z.union([z.number(), z.string()]).optional(),
});

const importedMenuItemSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional().default(""),
  priceCents: z.number().int().min(0).optional(),
  price: z.union([z.number(), z.string()]).optional(),
  category: z.string().trim().optional().default("Menu"),
  dietaryTags: z.array(z.string().trim()).optional().default([]),
  allergens: z.array(z.string().trim()).optional().default([]),
});

const importedRestaurantMenuSchema = z.object({
  type: z.literal("restaurant_menu").optional(),
  source: z.string().trim().optional().default("admin_lead_import"),
  sendVerificationEmail: z.boolean().optional().default(false),
  user: importedUserSchema
    .extend({ userType: z.literal("restaurant_owner").default("restaurant_owner") })
    .optional(),
  restaurantId: z.string().trim().optional(),
  restaurant: importedBusinessSchema,
  menu: z.object({
    name: z.string().trim().optional().default("Imported Menu"),
    serviceType: z.string().trim().optional().default("all"),
    importUrl: z.string().trim().url().optional().or(z.literal("")),
    items: z.array(importedMenuItemSchema).min(1),
  }),
  rawSource: z.record(z.any()).optional().default({}),
});

const importedFoodTruckSchema = z.object({
  type: z.literal("food_truck").optional(),
  source: z.string().trim().optional().default("admin_lead_import"),
  sendVerificationEmail: z.boolean().optional().default(true),
  user: importedUserSchema
    .extend({ userType: z.literal("food_truck").default("food_truck") })
    .optional(),
  truck: importedBusinessSchema,
  menu: z
    .object({
      name: z.string().trim().optional().default("Truck Menu"),
      serviceType: z.string().trim().optional().default("all"),
      importUrl: z.string().trim().url().optional().or(z.literal("")),
      items: z.array(importedMenuItemSchema).optional().default([]),
    })
    .optional(),
  rawSource: z.record(z.any()).optional().default({}),
});

const leadImportEnvelopeSchema = z.discriminatedUnion("type", [
  importedAccountSchema.extend({ type: z.literal("account") }),
  hostEventLeadImportSchema.extend({ type: z.literal("host_event") }),
  importedRestaurantMenuSchema.extend({ type: z.literal("restaurant_menu") }),
  importedFoodTruckSchema.extend({ type: z.literal("food_truck") }),
]);

export const normalizeLocationValue = (value?: string | null) =>
  String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

export const buildLocationKey = (
  address?: string | null,
  city?: string | null,
  state?: string | null,
) =>
  [
    normalizeLocationValue(address),
    normalizeLocationValue(city),
    normalizeLocationValue(state),
  ].join("|");

function buildVerifyBaseUrl(req: any) {
  return String(
    process.env.PUBLIC_BASE_URL ||
      process.env.CLIENT_ORIGIN ||
      `${req.protocol}://${req.get("host")}` ||
      "http://localhost:5000",
  ).replace(/\/+$/, "");
}

function actorIdFromRequest(req: any) {
  return String(
    req.leadImportActorId ||
      req.user?.id ||
      req.user?.claims?.sub ||
      "",
  );
}

function safeTokenEquals(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function zodPathToField(path: Array<string | number>) {
  return path.map((part) => String(part)).join(".");
}

function zodErrorPayload(message: string, error: z.ZodError) {
  const missingFields = error.errors
    .filter((issue) => issue.code === "invalid_type" && (issue as any).received === "undefined")
    .map((issue) => zodPathToField(issue.path))
    .filter(Boolean);

  return {
    message,
    errors: error.errors,
    missingFields,
  };
}

function sendLeadImportError(res: any, error: any, fallbackMessage: string) {
  if (error instanceof z.ZodError) {
    return res.status(400).json(zodErrorPayload(fallbackMessage, error));
  }
  if (error instanceof LeadImportError) {
    return res.status(error.status).json({
      message: error.message,
      code: error.code,
      details: error.details,
    });
  }
  if (error?.code === "23505") {
    return res.status(409).json({
      message: "An account, profile, event, or menu record with matching unique data already exists.",
      code: "duplicate_record",
    });
  }
  return res.status(500).json({ message: error?.message || fallbackMessage });
}

function isLeadImportAuthorized(req: any, res: any, next: any) {
  const configuredToken = String(process.env.ADMIN_LEAD_IMPORT_API_KEY || "");
  const authHeader = String(req.get("Authorization") || "");
  const bearerToken = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (
    configuredToken &&
    bearerToken &&
    safeTokenEquals(bearerToken, configuredToken)
  ) {
    req.leadImportActorId = "chatgpt_action";
    return next();
  }

  return isAuthenticated(req, res, (authError: any) => {
    if (authError) return next(authError);
    return isStaffOrAdmin(req, res, next);
  });
}

function toNullableString(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function parsePriceCents(item: z.infer<typeof importedMenuItemSchema>) {
  if (typeof item.priceCents === "number") return item.priceCents;
  if (item.price === undefined || item.price === null || item.price === "") return 0;
  const numeric = Number.parseFloat(String(item.price).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

async function findAnyUserByEmail(email: string) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return undefined;
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`)
    .limit(1);
  return user;
}

async function ensureImportedUser(
  userInput: z.infer<typeof importedAccountSchema>["user"],
) {
  const requestedUserType = String(userInput.userType || "");
  if (isPrivilegedLeadImportUserType(requestedUserType)) {
    throw new LeadImportError(
      400,
      "Lead import cannot create staff, admin, or super admin accounts.",
      "privileged_user_type_not_allowed",
      { requestedUserType },
    );
  }

  let user = await findAnyUserByEmail(userInput.email);
  let userCreated = false;
  if (user?.isDisabled) {
    throw new LeadImportError(
      409,
      `A disabled account already uses ${userInput.email}. Resolve that account before importing this lead.`,
      "duplicate_disabled_email",
      { email: userInput.email, existingUserId: user.id },
    );
  }

  if (user && isPrivilegedLeadImportUserType(user.userType)) {
    throw new LeadImportError(
      409,
      `The email ${userInput.email} belongs to a privileged account and cannot be reused by lead import.`,
      "duplicate_privileged_email",
      { email: userInput.email, existingUserId: user.id, existingUserType: user.userType },
    );
  }

  if (!user) {
    user = await storage.createUserInvite({
      email: userInput.email,
      firstName: userInput.firstName || null,
      lastName: userInput.lastName || null,
      phone: userInput.phone || null,
      userType: userInput.userType as any,
    });
    userCreated = true;
  } else {
    const nonOverridableTypes = new Set(["admin", "super_admin", "staff"]);
    if (!nonOverridableTypes.has(String(user.userType || ""))) {
      if (String(user.userType || "") !== userInput.userType) {
        user = await storage.updateUserType(user.id, userInput.userType as any);
      }
    }
    const updatePayload: any = {};
    if (userInput.firstName && !user.firstName) updatePayload.firstName = userInput.firstName;
    if (userInput.lastName && !user.lastName) updatePayload.lastName = userInput.lastName;
    if (userInput.phone && !user.phone) updatePayload.phone = userInput.phone;
    if (Object.keys(updatePayload).length > 0) {
      user = await storage.updateUser(user.id, updatePayload);
    }
  }
  return { user, userCreated };
}

async function findMatchingHostByLocation(hostInput: z.infer<typeof importedHostSchema>) {
  const incomingAddress = normalizeLocationValue(hostInput.address);
  const incomingCity = normalizeLocationValue(hostInput.city);
  const incomingState = normalizeLocationValue(hostInput.state);
  if (!incomingAddress || !incomingCity || !incomingState) return undefined;

  const rows = await db
    .select()
    .from(hosts)
    .where(
      and(
        sql`regexp_replace(lower(trim(${hosts.address})), '[[:space:]]+', ' ', 'g') = ${incomingAddress}`,
        sql`regexp_replace(lower(trim(coalesce(${hosts.city}, ''))), '[[:space:]]+', ' ', 'g') = ${incomingCity}`,
        sql`regexp_replace(lower(trim(coalesce(${hosts.state}, ''))), '[[:space:]]+', ' ', 'g') = ${incomingState}`,
      ),
    )
    .limit(1);

  return rows[0];
}

async function findMatchingRestaurant(ownerId: string, business: z.infer<typeof importedBusinessSchema>) {
  const ownerRestaurants = await storage.getRestaurantsByOwner(ownerId);
  const incomingKey = buildLocationKey(business.address, business.city, business.state);
  return ownerRestaurants.find((restaurant: any) => {
    const nameMatches =
      normalizeLocationValue(restaurant.name) === normalizeLocationValue(business.name);
    const locationMatches =
      buildLocationKey(restaurant.address, restaurant.city, restaurant.state) === incomingKey;
    return nameMatches || locationMatches;
  });
}

async function ensureImportedRestaurant({
  ownerId,
  business,
  businessType,
}: {
  ownerId: string;
  business: z.infer<typeof importedBusinessSchema>;
  businessType: "restaurant" | "food_truck";
}) {
  let restaurant = await findMatchingRestaurant(ownerId, business);
  let restaurantCreated = false;
  const restaurantData: any = {
    ownerId,
    name: business.name,
    address: business.address,
    phone: toNullableString(business.phone),
    businessType,
    cuisineType: business.cuisineType || "Various",
    city: toNullableString(business.city),
    state: toNullableString(business.state),
    description: toNullableString(business.description),
    websiteUrl: toNullableString(business.websiteUrl),
    menuUrl: toNullableString(business.menuUrl),
    instagramUrl: toNullableString(business.instagramUrl),
    facebookPageUrl: toNullableString(business.facebookPageUrl),
    isFoodTruck: businessType === "food_truck",
    isActive: true,
    isVerified: false,
    profileSource: "manual",
  };
  if (business.latitude !== undefined) restaurantData.latitude = String(business.latitude);
  if (business.longitude !== undefined) restaurantData.longitude = String(business.longitude);

  if (!restaurant) {
    const [created] = await db.insert(restaurants).values(restaurantData).returning();
    restaurant = created;
    restaurantCreated = true;
    queueGoogleRestaurantAutoLink(
      restaurant as any,
      "adminLeadImport.upsertRestaurantFromBusiness",
    );
  } else {
    const updatePayload: any = {};
    for (const [key, value] of Object.entries(restaurantData)) {
      if (value !== null && value !== "" && value !== undefined && !(restaurant as any)[key]) {
        updatePayload[key] = value;
      }
    }
    if (Object.keys(updatePayload).length > 0) {
      restaurant = await storage.updateRestaurant(restaurant.id, updatePayload);
    }
  }
  return { restaurant, restaurantCreated };
}

async function importMenuForRestaurant({
  actorId,
  restaurantId,
  source,
  menu,
}: {
  actorId: string;
  restaurantId: string;
  source: string;
  menu: z.infer<typeof importedRestaurantMenuSchema>["menu"];
}) {
  const menuName = menu.name || "Imported Menu";
  const serviceType = menu.serviceType || "all";
  const importedAt = new Date();
  const existingMenus = await db
    .select()
    .from(menus)
    .where(eq(menus.restaurantId, restaurantId));

  let activeMenu = existingMenus.find(
    (row: any) =>
      normalizeLocationValue(row.name) === normalizeLocationValue(menuName) &&
      normalizeLocationValue(row.serviceType) === normalizeLocationValue(serviceType),
  );
  let menuCreated = false;

  if (!activeMenu) {
    const [createdMenu] = await db
      .insert(menus)
      .values({
        restaurantId,
        name: menuName,
        serviceType,
        importSource: source,
        importUrl: toNullableString(menu.importUrl),
        importedAt,
        isActive: true,
      } as any)
      .returning();
    activeMenu = createdMenu;
    menuCreated = true;
  } else {
    const [updatedMenu] = await db
      .update(menus)
      .set({
        importSource: source,
        importUrl: toNullableString(menu.importUrl),
        importedAt,
        isActive: true,
        updatedAt: importedAt,
      } as any)
      .where(eq(menus.id, activeMenu.id))
      .returning();
    activeMenu = updatedMenu || activeMenu;
  }

  const existingCategories = await db
    .select()
    .from(menuCategories)
    .where(eq(menuCategories.menuId, activeMenu.id));
  const categoryByName = new Map<string, any>(
    existingCategories.map((category: any) => [
      normalizeLocationValue(category.name),
      category,
    ]),
  );
  const existingItems = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.menuId, activeMenu.id));
  const itemByCategoryAndName = new Map<string, any>();
  for (const item of existingItems as any[]) {
    itemByCategoryAndName.set(
      `${item.categoryId || ""}|${normalizeLocationValue(item.name)}`,
      item,
    );
  }

  let categoriesCreated = 0;
  let itemsCreated = 0;
  let itemsReused = 0;
  let itemsUpdated = 0;
  for (const [index, item] of menu.items.entries()) {
    const categoryName = item.category || "Menu";
    let category = categoryByName.get(normalizeLocationValue(categoryName));
    if (!category) {
      const [createdCategory] = await db
        .insert(menuCategories)
        .values({
          menuId: activeMenu.id,
          restaurantId,
          name: categoryName,
          sortOrder: categoryByName.size,
          isActive: true,
        } as any)
        .returning();
      category = createdCategory;
      categoryByName.set(normalizeLocationValue(categoryName), category);
      categoriesCreated += 1;
    }

    const itemKey = `${category.id}|${normalizeLocationValue(item.name)}`;
    const existingItem = itemByCategoryAndName.get(itemKey);
    const itemValues = {
      description: toNullableString(item.description),
      priceCents: parsePriceCents(item),
      dietaryTags: item.dietaryTags || [],
      allergens: item.allergens || [],
      sortOrder: index,
      isAvailable: true,
      updatedAt: new Date(),
    } as any;

    if (existingItem) {
      await db
        .update(menuItems)
        .set(itemValues)
        .where(eq(menuItems.id, existingItem.id));
      itemsReused += 1;
      itemsUpdated += 1;
      continue;
    }

    const [createdItem] = await db
      .insert(menuItems)
      .values({
        menuId: activeMenu.id,
        restaurantId,
        categoryId: category.id,
        name: item.name,
        ...itemValues,
      } as any)
      .returning();
    itemByCategoryAndName.set(itemKey, createdItem);
    itemsCreated += 1;
  }

  await db.insert(menuImportLogs).values({
    restaurantId,
    importedByUserId: actorId,
    source,
    itemsImported: itemsCreated + itemsUpdated,
    itemsSkipped: 0,
    errors: [],
    status: "complete",
  } as any);

  return {
    menu: activeMenu,
    menuCreated,
    categoriesCreated,
    categoriesReused: categoryByName.size - categoriesCreated,
    itemsCreated,
    itemsReused,
    itemsUpdated,
  };
}

async function previewImport(payload: z.infer<typeof leadImportEnvelopeSchema>) {
  const actions: string[] = [];
  const warnings: string[] = [];
  const missingFields: string[] = [];

  if (payload.type === "account") {
    const existingUser = await findAnyUserByEmail(payload.user.email);
    actions.push(existingUser ? `reuse user ${payload.user.email}` : `create ${payload.user.userType} user ${payload.user.email}`);
    if (existingUser?.isDisabled) {
      warnings.push(`Email ${payload.user.email} belongs to a disabled account and import will be blocked.`);
    } else if (existingUser && isPrivilegedLeadImportUserType(existingUser.userType)) {
      warnings.push(`Email ${payload.user.email} belongs to a privileged account and import will be blocked.`);
    }
    return { ok: true, type: payload.type, actions, warnings, missingFields };
  }

  if (payload.type === "host_event") {
    const existingUser = await findAnyUserByEmail(payload.user.email);
    const existingHost = await findMatchingHostByLocation(payload.host);
    actions.push(existingUser ? `reuse host user ${payload.user.email}` : `create host user ${payload.user.email}`);
    actions.push(existingHost ? `reuse host profile at ${payload.host.address}` : `create host profile ${payload.host.name}`);
    actions.push(`create provisional event intake claim ${payload.eventRequest.eventName}`);
    if (existingUser?.isDisabled) {
      warnings.push(`Email ${payload.user.email} belongs to a disabled account and import will be blocked.`);
    } else if (existingUser && isPrivilegedLeadImportUserType(existingUser.userType)) {
      warnings.push(`Email ${payload.user.email} belongs to a privileged account and import will be blocked.`);
    }
    if (existingHost && String(existingHost.userId || "") !== String(existingUser?.id || "")) {
      warnings.push(`Host address already exists under another owner; import will reuse host ${existingHost.id} instead of creating a duplicate.`);
    }
    if (payload.eventRequest.missingFields?.length) missingFields.push(...payload.eventRequest.missingFields);
    return { ok: true, type: payload.type, actions, warnings, missingFields };
  }

  if (payload.type === "restaurant_menu") {
    if (!payload.user && !payload.restaurantId) {
      warnings.push("restaurant_menu imports need either user or restaurantId");
    }
    const menuName = payload.menu.name || "Imported Menu";
    if (payload.restaurantId) {
      const existingMenus = await db
        .select()
        .from(menus)
        .where(eq(menus.restaurantId, payload.restaurantId));
      const matchingMenu = existingMenus.find(
        (row: any) =>
          normalizeLocationValue(row.name) === normalizeLocationValue(menuName) &&
          normalizeLocationValue(row.serviceType) === normalizeLocationValue(payload.menu.serviceType || "all"),
      );
      if (matchingMenu) {
        warnings.push(`Menu ${menuName} already exists; import will reuse it and update matching items.`);
      }
    }
    actions.push(payload.restaurantId ? `attach menu to restaurant ${payload.restaurantId}` : `create/reuse restaurant owner and restaurant ${payload.restaurant.name}`);
    actions.push(`upsert menu ${menuName} with ${payload.menu.items.length} items`);
    return { ok: true, type: payload.type, actions, warnings, missingFields };
  }

  const existingTruckUser = payload.user
    ? await findAnyUserByEmail(payload.user.email)
    : null;
  actions.push(payload.user ? `create/reuse food truck owner ${payload.user.email}` : "create food truck under import system owner");
  actions.push(`create/reuse food truck ${payload.truck.name}`);
  if (existingTruckUser?.isDisabled) {
    warnings.push(`Email ${payload.user?.email} belongs to a disabled account and import will be blocked.`);
  } else if (existingTruckUser && isPrivilegedLeadImportUserType(existingTruckUser.userType)) {
    warnings.push(`Email ${payload.user?.email} belongs to a privileged account and import will be blocked.`);
  }
  if (payload.menu?.items?.length) actions.push(`upsert truck menu with ${payload.menu.items.length} items`);
  return { ok: true, type: payload.type, actions, warnings, missingFields };
}

async function sendVerificationIfNeeded(req: any, user: any) {
  if (!user?.email) {
    return { sent: false, skipped: "missing_email" };
  }
  if (user.emailVerified) {
    return { sent: false, skipped: "already_verified" };
  }
  if (!isEmailConfigured()) {
    return { sent: false, skipped: "email_not_configured" };
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await storage.createEmailVerificationToken({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    requestIp: req.ip || req.connection?.remoteAddress || undefined,
    userAgent: req.get("User-Agent") || undefined,
  });

  const verifyUrl = `${buildVerifyBaseUrl(req)}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const sent = await emailService.sendEmailVerificationEmail(user, verifyUrl);
  return { sent: Boolean(sent), skipped: null };
}

export function registerAdminLeadImportRoutes(app: Express) {
  app.post(
    "/api/admin/lead-import/preview",
    isLeadImportAuthorized,
    async (req: any, res) => {
      try {
        const parsed = leadImportEnvelopeSchema.parse(req.body || {});
        res.json(await previewImport(parsed));
      } catch (error: any) {
        return sendLeadImportError(res, error, "Invalid lead import data");
      }
    },
  );

  app.post(
    "/api/admin/lead-import/account",
    isLeadImportAuthorized,
    async (req: any, res) => {
      try {
        const parsed = importedAccountSchema.parse(req.body || {});
        const actorId = actorIdFromRequest(req);
        const { user, userCreated } = await ensureImportedUser(parsed.user);
        const verification = parsed.sendVerificationEmail
          ? await sendVerificationIfNeeded(req, user)
          : { sent: false, skipped: "disabled_by_request" };

        await logAudit(
          actorId,
          "admin_account_lead_imported",
          "user",
          user.id,
          String(req.ip || ""),
          String(req.get("User-Agent") || ""),
          {
            source: parsed.source,
            userCreated,
            verification,
            rawSource: parsed.rawSource || {},
          },
        );

        res.status(userCreated ? 201 : 200).json({
          ok: true,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone,
            userType: user.userType,
            emailVerified: user.emailVerified,
            created: userCreated,
          },
          verification,
        });
      } catch (error: any) {
        console.error("Error importing account lead:", error);
        return sendLeadImportError(res, error, "Failed to import account");
      }
    },
  );

  app.post(
    "/api/admin/lead-import/restaurant-menu",
    isLeadImportAuthorized,
    async (req: any, res) => {
      try {
        const parsed = importedRestaurantMenuSchema.parse(req.body || {});
        const actorId = actorIdFromRequest(req);

        let user: any = null;
        let userCreated = false;
        let restaurant: any = null;
        let restaurantCreated = false;

        if (parsed.restaurantId) {
          restaurant = await storage.getRestaurant(parsed.restaurantId);
          if (!restaurant) {
            return res.status(404).json({ message: "Restaurant not found" });
          }
          user = await storage.getUser(restaurant.ownerId);
        } else {
          if (!parsed.user) {
            return res.status(400).json({
              message: "restaurant_menu imports require user when restaurantId is not supplied",
            });
          }
          const ensuredUser = await ensureImportedUser(parsed.user);
          user = ensuredUser.user;
          userCreated = ensuredUser.userCreated;
          const ensuredRestaurant = await ensureImportedRestaurant({
            ownerId: user.id,
            business: parsed.restaurant,
            businessType: "restaurant",
          });
          restaurant = ensuredRestaurant.restaurant;
          restaurantCreated = ensuredRestaurant.restaurantCreated;
        }

        const menuResult = await importMenuForRestaurant({
          actorId,
          restaurantId: restaurant.id,
          source: parsed.source,
          menu: parsed.menu,
        });

        const verification =
          parsed.user && parsed.sendVerificationEmail
            ? await sendVerificationIfNeeded(req, user)
            : { sent: false, skipped: "disabled_by_request" };

        await logAudit(
          actorId,
          "admin_restaurant_menu_lead_imported",
          "restaurant",
          restaurant.id,
          String(req.ip || ""),
          String(req.get("User-Agent") || ""),
          {
            source: parsed.source,
            userId: user?.id || null,
            userCreated,
            restaurantCreated,
            menuId: menuResult.menu.id,
            itemsCreated: menuResult.itemsCreated,
            rawSource: parsed.rawSource || {},
          },
        );

        res.status(201).json({
          ok: true,
          user: user
            ? {
                id: user.id,
                email: user.email,
                userType: user.userType,
                created: userCreated,
              }
            : null,
          restaurant: {
            id: restaurant.id,
            name: restaurant.name,
            businessType: restaurant.businessType,
            created: restaurantCreated,
          },
          menu: menuResult,
          verification,
        });
      } catch (error: any) {
        console.error("Error importing restaurant menu lead:", error);
        return sendLeadImportError(res, error, "Failed to import restaurant menu");
      }
    },
  );

  app.post(
    "/api/admin/lead-import/food-truck",
    isLeadImportAuthorized,
    async (req: any, res) => {
      try {
        const parsed = importedFoodTruckSchema.parse(req.body || {});
        const actorId = actorIdFromRequest(req);
        if (!parsed.user) {
          return res.status(400).json({
            message: "food_truck imports require a user owner",
          });
        }

        const { user, userCreated } = await ensureImportedUser(parsed.user);
        const { restaurant: truck, restaurantCreated: truckCreated } =
          await ensureImportedRestaurant({
            ownerId: user.id,
            business: parsed.truck,
            businessType: "food_truck",
          });
        if (!truck) {
          return res.status(500).json({ message: "Failed to create or reuse food truck" });
        }

        const menuResult =
          parsed.menu && parsed.menu.items.length > 0
            ? await importMenuForRestaurant({
                actorId,
                restaurantId: truck.id,
                source: parsed.source,
                menu: {
                  name: parsed.menu.name || "Truck Menu",
                  serviceType: parsed.menu.serviceType || "all",
                  importUrl: parsed.menu.importUrl || "",
                  items: parsed.menu.items,
                },
              })
            : null;

        const verification = parsed.sendVerificationEmail
          ? await sendVerificationIfNeeded(req, user)
          : { sent: false, skipped: "disabled_by_request" };

        await logAudit(
          actorId,
          "admin_food_truck_lead_imported",
          "restaurant",
          truck.id,
          String(req.ip || ""),
          String(req.get("User-Agent") || ""),
          {
            source: parsed.source,
            userId: user.id,
            userCreated,
            truckCreated,
            menuId: menuResult?.menu?.id || null,
            itemsCreated: menuResult?.itemsCreated || 0,
            rawSource: parsed.rawSource || {},
          },
        );

        res.status(201).json({
          ok: true,
          user: {
            id: user.id,
            email: user.email,
            userType: user.userType,
            created: userCreated,
          },
          truck: {
            id: truck.id,
            name: truck.name,
            businessType: truck.businessType,
            isFoodTruck: truck.isFoodTruck,
            created: truckCreated,
          },
          menu: menuResult,
          verification,
        });
      } catch (error: any) {
        console.error("Error importing food truck lead:", error);
        return sendLeadImportError(res, error, "Failed to import food truck");
      }
    },
  );

  app.post(
    "/api/admin/lead-import",
    isLeadImportAuthorized,
    async (req: any, res) => {
      try {
        const parsed = leadImportEnvelopeSchema.parse(req.body || {});
        const pathByType: Record<string, string> = {
          account: "/api/admin/lead-import/account",
          host_event: "/api/admin/lead-import/host-event",
          restaurant_menu: "/api/admin/lead-import/restaurant-menu",
          food_truck: "/api/admin/lead-import/food-truck",
        };
        req.url = pathByType[parsed.type] || req.url;
        app._router.handle(req, res);
      } catch (error: any) {
        return sendLeadImportError(res, error, "Invalid lead import data");
      }
    },
  );

  app.post(
    "/api/admin/lead-import/host-event",
    isLeadImportAuthorized,
    async (req: any, res) => {
      try {
        const parsed = hostEventLeadImportSchema.parse(req.body || {});
        const actorId = actorIdFromRequest(req);
        const { user, userCreated } = await ensureImportedUser(parsed.user);

        const userHosts = await storage.getHostsByUserId(user.id);
        const incomingHostKey = buildLocationKey(
          parsed.host.address,
          parsed.host.city,
          parsed.host.state,
        );
        let host = userHosts.find(
          (item: any) =>
            buildLocationKey(item.address, item.city, item.state) ===
            incomingHostKey,
        );
        if (!host) {
          host = await findMatchingHostByLocation(parsed.host);
        }
        let hostCreated = false;
        if (!host) {
          host = await storage.createHost({
            userId: user.id,
            businessName: parsed.host.name,
            address: parsed.host.address,
            city: parsed.host.city,
            state: parsed.host.state,
            locationType: parsed.host.category,
            contactPhone: parsed.host.contactPhone || parsed.user.phone || null,
            notes: [
              parsed.host.website ? `Website: ${parsed.host.website}` : "",
              parsed.host.contactName
                ? `Contact: ${parsed.host.contactName}${parsed.host.contactTitle ? `, ${parsed.host.contactTitle}` : ""}`
                : "",
              parsed.host.contactEmail
                ? `Contact email: ${parsed.host.contactEmail}`
                : "",
              parsed.host.zip ? `ZIP: ${parsed.host.zip}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            spotCount: 1,
          } as any);
          hostCreated = true;
          await storage.ensureDraftParkingPassForHost(host.id).catch(() => false);
        }

        const eventVisibility =
          String(parsed.eventRequest.visibility || "public").toLowerCase() ===
          "private"
            ? "private"
            : "public";

        const claimData = {
          eventName: parsed.eventRequest.eventName,
          occasion: parsed.eventRequest.eventName,
          date: parsed.eventRequest.eventDate,
          startTime: parsed.eventRequest.startTime,
          endTime: parsed.eventRequest.endTime,
          timeDisplay:
            parsed.eventRequest.timeDisplay ||
            `${parsed.eventRequest.startTime} - ${parsed.eventRequest.endTime}`,
          requestedVendorType: parsed.eventRequest.requestedVendorType,
          requestedTruckCount: 1,
          maxTrucks: 1,
          eventVisibility,
          status: parsed.eventRequest.status,
          hostId: host.id,
          hostBusinessName: parsed.host.name,
          hostCategory: parsed.host.category,
          address: parsed.host.address,
          city: parsed.host.city,
          state: parsed.host.state,
          zip: parsed.host.zip,
          requestSummary: parsed.eventRequest.requestSummary,
          requestedDetailsFromTruck:
            parsed.eventRequest.requestedDetailsFromTruck,
          detailsAvailableBy: parsed.eventRequest.detailsAvailableBy,
          missingFields: parsed.eventRequest.missingFields,
          organizer: {
            name:
              parsed.host.contactName ||
              [parsed.user.firstName, parsed.user.lastName].filter(Boolean).join(" "),
            title: parsed.host.contactTitle || null,
            phone: parsed.host.contactPhone || parsed.user.phone || null,
            email: parsed.host.contactEmail || parsed.user.email,
          },
        };

        const [claim] = await db
          .insert(claims)
          .values({
            personId: user.id,
            claimType: CLAIM_TYPES.EVENT,
            status: "provisional",
            claimData,
            metadata: {
              source: parsed.source,
              importedBy: actorId || null,
              importedAt: new Date().toISOString(),
              discoverableByAllUsers: eventVisibility === "public",
              rawSource: parsed.rawSource || {},
            },
          } as any)
          .returning();

        const verification = parsed.sendVerificationEmail
          ? await sendVerificationIfNeeded(req, user)
          : { sent: false, skipped: "disabled_by_request" };

        await logAudit(
          actorId,
          "admin_host_event_lead_imported",
          "host_event_lead",
          String(claim?.id || ""),
          String(req.ip || ""),
          String(req.get("User-Agent") || ""),
          {
            userId: user.id,
            hostId: host.id,
            claimId: claim?.id || null,
            userCreated,
            hostCreated,
            verification,
            source: parsed.source,
          },
        ).catch((error) =>
          console.error("Failed to write lead import audit log:", error),
        );

        res.status(201).json({
          ok: true,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone,
            userType: user.userType,
            emailVerified: user.emailVerified,
            created: userCreated,
          },
          host: {
            id: host.id,
            businessName: host.businessName,
            address: host.address,
            city: host.city,
            state: host.state,
            locationType: host.locationType,
            created: hostCreated,
          },
          eventIntakeClaim: {
            id: claim?.id || null,
            status: claim?.status || "provisional",
            claimType: claim?.claimType || CLAIM_TYPES.EVENT,
          },
          verification,
        });
      } catch (error: any) {
        console.error("Error importing host event lead:", error);
        return sendLeadImportError(res, error, "Failed to import host event lead");
      }
    },
  );
}
