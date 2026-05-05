import {
  users,
  type User,
  type UpsertUser,
  type GoogleUserData,
  type EmailUserData,
  type FacebookUserData,
  type TradeScoutUserData,
} from "@shared/schema";
import { getDefaultAffiliatePercent } from "@shared/affiliatePolicy";
import { db, pool } from "../db";
import { eq, and, or, isNull, desc, sql, gte } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { syncUserToBrevo } from "../brevoCrm";
import { ensureAffiliateTag } from "../affiliateTagService";

// ── Cached table-info (module-level singleton, matches the instance cache in DatabaseStorage) ──

let userTableInfoPromise: Promise<{ schema: string; columns: Set<string> }> | null = null;

async function getUserTableInfo(): Promise<{ schema: string; columns: Set<string> }> {
  if (userTableInfoPromise) return userTableInfoPromise;
  userTableInfoPromise = (async () => {
    try {
      if (!pool) return { schema: "public", columns: new Set<string>() };

      const schemaRes = await pool.query(
        `select table_schema from information_schema.tables
         where table_name = 'users'
         order by case when table_schema = 'public' then 0 else 1 end limit 1`,
      );
      const schema =
        String(schemaRes.rows?.[0]?.table_schema || "").trim() || "public";

      const colsRes = await pool.query(
        `select column_name from information_schema.columns
         where table_schema = $1 and table_name = 'users'`,
        [schema],
      );
      const columns = new Set<string>(
        (colsRes.rows || [])
          .map((row: any) => String(row.column_name || "").trim())
          .filter(Boolean),
      );
      return { schema, columns };
    } catch (error) {
      console.warn("getUserTableInfo failed; using safe user projection:", error);
      return { schema: "public", columns: new Set<string>() };
    }
  })();
  return userTableInfoPromise;
}

async function selectUsersSafe(whereSql: string, params: any[]): Promise<any[]> {
  if (!pool) return [];
  const { schema, columns } = await getUserTableInfo();
  const has = (col: string) => columns.size === 0 || columns.has(col);
  const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

  if (columns.size > 0 && !columns.has("id")) return [];

  const select = [
    `${q("id")} as "id"`,
    `${has("user_type") ? `${q("user_type")} as "userType"` : `'customer' as "userType"`}`,
    `${has("email") ? `${q("email")} as "email"` : `null as "email"`}`,
    `${has("first_name") ? `${q("first_name")} as "firstName"` : `null as "firstName"`}`,
    `${has("last_name") ? `${q("last_name")} as "lastName"` : `null as "lastName"`}`,
    `${has("phone") ? `${q("phone")} as "phone"` : `null as "phone"`}`,
    `${has("password_hash") ? `${q("password_hash")} as "passwordHash"` : `null as "passwordHash"`}`,
    `${has("email_verified") ? `${q("email_verified")} as "emailVerified"` : `false as "emailVerified"`}`,
    `${has("must_reset_password") ? `${q("must_reset_password")} as "mustResetPassword"` : `false as "mustResetPassword"`}`,
    `${has("is_disabled") ? `${q("is_disabled")} as "isDisabled"` : `false as "isDisabled"`}`,
    `${has("is_active") ? `${q("is_active")} as "isActive"` : `null as "isActive"`}`,
    `${has("profile_image_url") ? `${q("profile_image_url")} as "profileImageUrl"` : `null as "profileImageUrl"`}`,
    `${has("affiliate_tag") ? `${q("affiliate_tag")} as "affiliateTag"` : `null as "affiliateTag"`}`,
    `${has("affiliate_percent") ? `${q("affiliate_percent")} as "affiliatePercent"` : `null as "affiliatePercent"`}`,
    `${has("affiliate_closer_user_id") ? `${q("affiliate_closer_user_id")} as "affiliateCloserUserId"` : `null as "affiliateCloserUserId"`}`,
    `${has("affiliate_booker_user_id") ? `${q("affiliate_booker_user_id")} as "affiliateBookerUserId"` : `null as "affiliateBookerUserId"`}`,
    `${has("affiliate_closer_percent") ? `${q("affiliate_closer_percent")} as "affiliateCloserPercent"` : `null as "affiliateCloserPercent"`}`,
    `${has("affiliate_booker_percent") ? `${q("affiliate_booker_percent")} as "affiliateBookerPercent"` : `null as "affiliateBookerPercent"`}`,
    `${has("stripe_customer_id") ? `${q("stripe_customer_id")} as "stripeCustomerId"` : `null as "stripeCustomerId"`}`,
    `${has("stripe_subscription_id") ? `${q("stripe_subscription_id")} as "stripeSubscriptionId"` : `null as "stripeSubscriptionId"`}`,
    `${has("subscription_billing_interval") ? `${q("subscription_billing_interval")} as "subscriptionBillingInterval"` : `null as "subscriptionBillingInterval"`}`,
    `${has("subscription_signup_date") ? `${q("subscription_signup_date")} as "subscriptionSignupDate"` : `null as "subscriptionSignupDate"`}`,
    `${has("trial_started_at") ? `${q("trial_started_at")} as "trialStartedAt"` : `null as "trialStartedAt"`}`,
    `${has("trial_ends_at") ? `${q("trial_ends_at")} as "trialEndsAt"` : `null as "trialEndsAt"`}`,
    `${has("trial_used") ? `${q("trial_used")} as "trialUsed"` : `false as "trialUsed"`}`,
    `${has("app_context") ? `${q("app_context")} as "appContext"` : `null as "appContext"`}`,
    `${has("public_profile_settings") ? `${q("public_profile_settings")} as "publicProfileSettings"` : `null as "publicProfileSettings"`}`,
    `${has("account_settings") ? `${q("account_settings")} as "accountSettings"` : `null as "accountSettings"`}`,
    `${has("created_at") ? `${q("created_at")} as "createdAt"` : `null as "createdAt"`}`,
    `${has("updated_at") ? `${q("updated_at")} as "updatedAt"` : `null as "updatedAt"`}`,
  ];

  const sqlText = `select ${select.join(", ")} from ${q(schema)}.${q("users")} ${whereSql}`;
  const result = await pool.query(sqlText, params);
  return result.rows || [];
}

function shouldAssignAffiliateTag(userType?: string | null): boolean {
  return userType !== "admin" && userType !== "super_admin";
}

function normalizeEmail(value?: string | null): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
}

function normalizePhone(value?: string | null): string | null {
  const normalized = String(value || "").replace(/\D/g, "");
  return normalized || null;
}

function normalizeIdentityName(value?: string | null): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function emailMatchesNormalized(value: string) {
  return sql`lower(btrim(${users.email})) = ${value}`;
}

function phoneMatchesNormalized(value: string) {
  return sql`regexp_replace(coalesce(${users.phone}, ''), '\\D', '', 'g') = ${value}`;
}

function duplicateAccountError(kind: "email" | "phone") {
  const error: any = new Error(
    kind === "email"
      ? "An account already exists for this email. Please sign in instead."
      : "An account already exists for this phone number. Please sign in instead.",
  );
  error.code = kind === "email" ? "ACCOUNT_EXISTS_EMAIL" : "ACCOUNT_EXISTS_PHONE";
  error.status = 409;
  error.duplicateField = kind;
  return error;
}

function possibleDuplicateAccountError(match: Pick<User, "id" | "email" | "userType" | "createdAt">) {
  const error: any = new Error(
    "It looks like this person may already have a MealScout account. Please sign in to the existing account, or ask MealScout support to connect the right profile.",
  );
  error.code = "POSSIBLE_DUPLICATE_ACCOUNT";
  error.status = 409;
  error.duplicateField = "identity";
  error.duplicateUserId = match.id;
  error.duplicateEmail = match.email;
  error.duplicateUserType = match.userType;
  return error;
}

function disabledAccountError() {
  const error: any = new Error("This account is disabled. Please contact MealScout support.");
  error.status = 403;
  error.code = "ACCOUNT_DISABLED";
  return error;
}

function assertAccountCanAuthenticate(user: Pick<User, "isDisabled">) {
  if (user.isDisabled === true) throw disabledAccountError();
}

function mergeAppContext(
  current: User["appContext"] | null | undefined,
  incoming: "mealscout" | "tradescout",
): "mealscout" | "tradescout" | "both" {
  if (!current) return incoming;
  if (current === incoming || current === "both") return current;
  return "both";
}

function chooseLinkedEmail(
  currentEmail?: string | null,
  providerEmail?: string | null,
): string | null | undefined {
  const normalizedProviderEmail = normalizeEmail(providerEmail);
  if (!normalizedProviderEmail) return currentEmail;
  const normalizedCurrentEmail = normalizeEmail(currentEmail);
  if (!normalizedCurrentEmail || normalizedCurrentEmail === normalizedProviderEmail) {
    return normalizedProviderEmail;
  }
  return currentEmail;
}

function linkedAuthUserTypePatch(
  current: Pick<User, "userType" | "affiliatePercent">,
  requested: User["userType"],
): Partial<Pick<User, "userType" | "affiliatePercent">> {
  const lockedTypes = new Set(["staff", "admin", "super_admin"]);
  if (!requested || requested === "customer") return {};
  if (lockedTypes.has(String(current.userType || ""))) return {};
  if (current.userType !== "customer") return {};
  return {
    userType: requested,
    affiliatePercent: current.affiliatePercent ?? getDefaultAffiliatePercent(requested),
  };
}

async function findUserByNormalizedEmail(value?: string | null): Promise<User | undefined> {
  const normalized = normalizeEmail(value);
  if (!normalized) return undefined;

  const [user] = await db
    .select()
    .from(users)
    .where(emailMatchesNormalized(normalized))
    .limit(1);
  return user;
}

async function findRecentPossibleDuplicateByIdentity(params: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): Promise<Pick<User, "id" | "email" | "userType" | "createdAt"> | undefined> {
  const firstName = normalizeIdentityName(params.firstName);
  const lastName = normalizeIdentityName(params.lastName);
  const email = normalizeEmail(params.email);
  const combined = `${firstName} ${lastName}`.trim();
  if (firstName.length < 2 || lastName.length < 2 || combined.length < 7) {
    return undefined;
  }

  const placeholderNames = new Set([
    "google user",
    "facebook user",
    "meal scout",
    "mealscout user",
    "new user",
    "test user",
  ]);
  if (placeholderNames.has(combined)) return undefined;

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [match] = await db
    .select({
      id: users.id,
      email: users.email,
      userType: users.userType,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(
      and(
        sql`lower(btrim(coalesce(${users.firstName}, ''))) = ${firstName}`,
        sql`lower(btrim(coalesce(${users.lastName}, ''))) = ${lastName}`,
        email
          ? sql`lower(btrim(coalesce(${users.email}, ''))) <> ${email}`
          : sql`true`,
        gte(users.createdAt, since),
        or(eq(users.isDisabled, false), isNull(users.isDisabled)),
      ),
    )
    .limit(1);

  return match || undefined;
}

async function assertNoRecentIdentityDuplicate(params: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}) {
  const match = await findRecentPossibleDuplicateByIdentity(params);
  if (match) throw possibleDuplicateAccountError(match);
}

// ── Repository factory ────────────────────────────────────────────────────────

export function createUsersRepository() {
  return {
    async updateUser(
      id: string,
      updates: Partial<
        Pick<
          User,
          | "subscriptionBillingInterval"
          | "stripeCustomerId"
          | "stripeSubscriptionId"
          | "passwordHash"
          | "subscriptionSignupDate"
          | "trialStartedAt"
          | "trialEndsAt"
          | "trialUsed"
          | "emailVerified"
          | "firstName"
          | "lastName"
          | "phone"
          | "email"
          | "postalCode"
          | "birthYear"
          | "gender"
          | "isActive"
          | "publicProfileSettings"
          | "accountSettings"
        >
      >,
    ): Promise<User> {
      const normalizedUpdates = { ...updates } as any;
      if (Object.prototype.hasOwnProperty.call(normalizedUpdates, "email")) {
        normalizedUpdates.email = normalizeEmail(normalizedUpdates.email);
      }
      const [user] = await db
        .update(users)
        .set({ ...normalizedUpdates, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      return user;
    },

    async getUser(id: string): Promise<User | undefined> {
      const normalizedId = String(id || "").trim();
      if (!normalizedId) return undefined;
      try {
        const rows = await selectUsersSafe(`where "id" = $1 limit 1`, [normalizedId]);
        const row = (rows[0] as any) || undefined;
        if (!row) return undefined;
        if (row.isDisabled === true) return undefined;
        return row as any;
      } catch (error) {
        console.warn("getUser safe projection failed, falling back:", error);
        const [user] = await db
          .select()
          .from(users)
          .where(and(eq(users.id, normalizedId), or(eq(users.isDisabled, false), isNull(users.isDisabled))));
        return user;
      }
    },

    async upsertUser(userData: UpsertUser): Promise<User> {
      const [user] = await db
        .insert(users)
        .values({
          affiliatePercent: getDefaultAffiliatePercent(userData.userType),
          ...userData,
        })
        .onConflictDoUpdate({ target: users.facebookId, set: { ...userData, updatedAt: new Date() } })
        .returning();
      return user;
    },

    async getUserByEmail(email: string): Promise<User | undefined> {
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) return undefined;
      try {
        const rows = await selectUsersSafe(`where lower(btrim("email")) = $1 limit 1`, [normalizedEmail]);
        const row = (rows[0] as any) || undefined;
        if (!row) return undefined;
        if (row.isDisabled === true) return undefined;
        return row as any;
      } catch (error) {
        console.warn("getUserByEmail safe projection failed, falling back:", error);
        const [user] = await db
          .select()
          .from(users)
          .where(and(emailMatchesNormalized(normalizedEmail), or(eq(users.isDisabled, false), isNull(users.isDisabled))));
        return user;
      }
    },

    async getUserByPhone(phone: string): Promise<User | undefined> {
      const normalizedPhone = String(phone || "").trim();
      if (!normalizedPhone) return undefined;
      try {
        const rows = await selectUsersSafe(
          `where regexp_replace(coalesce("phone", ''), '\\D', '', 'g') = $1 limit 1`,
          [normalizePhone(normalizedPhone)],
        );
        const row = (rows[0] as any) || undefined;
        if (!row) return undefined;
        if (row.isDisabled === true) return undefined;
        return row as any;
      } catch (error) {
        console.warn("getUserByPhone safe projection failed, falling back:", error);
        const [user] = await db
          .select()
          .from(users)
          .where(and(phoneMatchesNormalized(normalizePhone(normalizedPhone) || normalizedPhone), or(eq(users.isDisabled, false), isNull(users.isDisabled))));
        return user;
      }
    },

    async getUserById(id: string): Promise<User | undefined> {
      return this.getUser(id);
    },

    async updateUserType(
      id: string,
      userType:
        | "customer"
        | "restaurant_owner"
        | "caterer"
        | "private_chef"
        | "food_truck"
        | "supplier"
        | "host"
        | "event_coordinator"
        | "staff"
        | "admin"
        | "super_admin",
    ): Promise<User> {
      const SUPER_ADMIN_EMAIL = process.env.ADMIN_EMAIL || "info.mealscout@gmail.com";
      const user = await this.getUser(id);
      if (user?.email === SUPER_ADMIN_EMAIL && userType !== "super_admin") {
        throw new Error("Cannot modify super admin account");
      }

      const affiliatePercent = getDefaultAffiliatePercent(userType);
      const shouldAutoVerify = userType === "admin" || userType === "super_admin";
      const [updatedUser] = await db
        .update(users)
        .set({
          userType,
          affiliatePercent,
          ...(shouldAutoVerify ? { emailVerified: true } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning({
          id: users.id,
          userType: users.userType,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          phone: users.phone,
          emailVerified: users.emailVerified,
          isDisabled: users.isDisabled,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          stripeCustomerId: users.stripeCustomerId,
          stripeSubscriptionId: users.stripeSubscriptionId,
          affiliatePercent: users.affiliatePercent,
        });
      void syncUserToBrevo(updatedUser).catch(() => {});
      return updatedUser;
    },

    async upsertUserByAuth(
      authType: "google" | "email" | "facebook" | "tradescout",
      userData: GoogleUserData | EmailUserData | FacebookUserData | TradeScoutUserData,
      userType: User["userType"] = "customer",
      appContext: "mealscout" | "tradescout" = "mealscout",
    ): Promise<User> {
      try {
        if (authType === "tradescout") {
          const tsData = userData as TradeScoutUserData;
          const tsEmail = normalizeEmail(tsData.email);
          let existingUser = await db.select().from(users).where(eq(users.tradescoutId, tsData.tradescoutId)).limit(1);

          if (existingUser.length > 0) {
            const current = existingUser[0];
            assertAccountCanAuthenticate(current);
            const newAppContext = mergeAppContext(current.appContext, appContext);
            const [user] = await db
              .update(users)
              .set({
                email: chooseLinkedEmail(current.email, tsEmail),
                ...(tsEmail ? { emailVerified: true } : {}),
                firstName: tsData.firstName || current.firstName,
                lastName: tsData.lastName || current.lastName,
                appContext: newAppContext,
                ...linkedAuthUserTypePatch(current, userType),
                updatedAt: new Date(),
              })
              .where(eq(users.id, current.id))
              .returning();
            void syncUserToBrevo(user).catch(() => {});
            return user;
          }

          if (tsEmail) {
            const emailUser = await findUserByNormalizedEmail(tsEmail);
            if (emailUser) {
              const current = emailUser;
              assertAccountCanAuthenticate(current);
              const newAppContext = mergeAppContext(current.appContext, appContext);
              const [user] = await db
                .update(users)
                .set({
                  tradescoutId: tsData.tradescoutId,
                  emailVerified: true,
                  firstName: tsData.firstName || current.firstName,
                  lastName: tsData.lastName || current.lastName,
                  appContext: newAppContext,
                  ...linkedAuthUserTypePatch(current, userType),
                  updatedAt: new Date(),
                })
                .where(eq(users.id, current.id))
                .returning();
              void syncUserToBrevo(user).catch(() => {});
              return user;
            }
          }

          await assertNoRecentIdentityDuplicate({
            firstName: tsData.firstName,
            lastName: tsData.lastName,
            email: tsEmail,
          });

          const [user] = await db
            .insert(users)
            .values({
              userType,
              tradescoutId: tsData.tradescoutId,
              email: tsEmail ?? undefined,
              emailVerified: Boolean(tsEmail),
              firstName: tsData.firstName ?? undefined,
              lastName: tsData.lastName ?? undefined,
              affiliatePercent: getDefaultAffiliatePercent(userType),
              appContext,
            })
            .returning();
          void syncUserToBrevo(user).catch(() => {});
          return user;
        } else if (authType === "google") {
          const googleData = userData as GoogleUserData;
          const googleEmail = normalizeEmail(googleData.email);
          let existingUser = await db.select().from(users).where(eq(users.googleId, googleData.googleId)).limit(1);

          if (existingUser.length > 0) {
            const current = existingUser[0];
            assertAccountCanAuthenticate(current);
            const newAppContext = mergeAppContext(current.appContext, appContext);
            const [user] = await db
              .update(users)
              .set({
                email: chooseLinkedEmail(current.email, googleEmail),
                emailVerified: true,
                firstName: googleData.firstName || current.firstName,
                lastName: googleData.lastName || current.lastName,
                profileImageUrl: googleData.profileImageUrl || current.profileImageUrl,
                googleAccessToken: googleData.googleAccessToken,
                appContext: newAppContext,
                ...linkedAuthUserTypePatch(current, userType),
                updatedAt: new Date(),
              })
              .where(eq(users.id, existingUser[0].id))
              .returning();
            void syncUserToBrevo(user).catch(() => {});
            return user;
          }

          if (googleEmail) {
            const emailUser = await findUserByNormalizedEmail(googleEmail);
            if (emailUser) {
              const current = emailUser;
              assertAccountCanAuthenticate(current);
              const newAppContext = mergeAppContext(current.appContext, appContext);
              const [user] = await db
                .update(users)
                .set({
                  googleId: googleData.googleId,
                  emailVerified: true,
                  firstName: googleData.firstName || current.firstName,
                  lastName: googleData.lastName || current.lastName,
                  profileImageUrl: googleData.profileImageUrl || current.profileImageUrl,
                  googleAccessToken: googleData.googleAccessToken,
                  appContext: newAppContext,
                  ...linkedAuthUserTypePatch(current, userType),
                  updatedAt: new Date(),
                })
                .where(eq(users.id, current.id))
                .returning();
              void syncUserToBrevo(user).catch(() => {});
              return user;
            }
          }

          await assertNoRecentIdentityDuplicate({
            firstName: googleData.firstName,
            lastName: googleData.lastName,
            email: googleEmail,
          });

          const [user] = await db
            .insert(users)
            .values({
              userType,
              googleId: googleData.googleId,
              email: googleEmail ?? undefined,
              emailVerified: true,
              firstName: googleData.firstName,
              lastName: googleData.lastName,
              profileImageUrl: googleData.profileImageUrl,
              googleAccessToken: googleData.googleAccessToken,
              affiliatePercent: getDefaultAffiliatePercent(userType),
              appContext,
            })
            .returning();
          void syncUserToBrevo(user).catch(() => {});
          return user;
        } else if (authType === "facebook") {
          const facebookData = userData as FacebookUserData;
          const facebookEmail = normalizeEmail(facebookData.email);
          let existingUser = await db.select().from(users).where(eq(users.facebookId, facebookData.facebookId)).limit(1);

          if (existingUser.length > 0) {
            const current = existingUser[0];
            assertAccountCanAuthenticate(current);
            const newAppContext = mergeAppContext(current.appContext, appContext);
            const [user] = await db
              .update(users)
              .set({
                email: chooseLinkedEmail(current.email, facebookEmail),
                emailVerified: true,
                firstName: facebookData.firstName || current.firstName,
                lastName: facebookData.lastName || current.lastName,
                profileImageUrl: facebookData.profileImageUrl || current.profileImageUrl,
                facebookAccessToken: facebookData.facebookAccessToken,
                appContext: newAppContext,
                ...linkedAuthUserTypePatch(current, userType),
                updatedAt: new Date(),
              })
              .where(eq(users.id, existingUser[0].id))
              .returning();
            void syncUserToBrevo(user).catch(() => {});
            return user;
          }

          if (facebookEmail) {
            const emailUser = await findUserByNormalizedEmail(facebookEmail);
            if (emailUser) {
              const current = emailUser;
              assertAccountCanAuthenticate(current);
              const newAppContext = mergeAppContext(current.appContext, appContext);
              const [user] = await db
                .update(users)
                .set({
                  facebookId: facebookData.facebookId,
                  emailVerified: true,
                  firstName: facebookData.firstName || current.firstName,
                  lastName: facebookData.lastName || current.lastName,
                  profileImageUrl: facebookData.profileImageUrl || current.profileImageUrl,
                  facebookAccessToken: facebookData.facebookAccessToken,
                  appContext: newAppContext,
                  ...linkedAuthUserTypePatch(current, userType),
                  updatedAt: new Date(),
                })
                .where(eq(users.id, current.id))
                .returning();
              void syncUserToBrevo(user).catch(() => {});
              return user;
            }
          }

          await assertNoRecentIdentityDuplicate({
            firstName: facebookData.firstName,
            lastName: facebookData.lastName,
            email: facebookEmail,
          });

          const [user] = await db
            .insert(users)
            .values({
              userType,
              facebookId: facebookData.facebookId,
              email: facebookEmail ?? undefined,
              emailVerified: true,
              firstName: facebookData.firstName,
              lastName: facebookData.lastName,
              profileImageUrl: facebookData.profileImageUrl,
              facebookAccessToken: facebookData.facebookAccessToken,
              affiliatePercent: getDefaultAffiliatePercent(userType),
              appContext,
            })
            .returning();
          void syncUserToBrevo(user).catch(() => {});
          return user;
        } else {
          const emailData = userData as EmailUserData;
          const email = normalizeEmail(emailData.email);
          const phone = normalizePhone(emailData.phone);
          if (!email) {
            const err: any = new Error("Valid email is required");
            err.status = 400;
            throw err;
          }

          const existingEmail = await findUserByNormalizedEmail(email);
          if (existingEmail) {
            throw duplicateAccountError("email");
          }

          if (phone) {
            const existingPhone = await db
              .select({ id: users.id })
              .from(users)
              .where(and(phoneMatchesNormalized(phone), or(eq(users.isDisabled, false), isNull(users.isDisabled))))
              .limit(1);
            if (existingPhone.length > 0) {
              throw duplicateAccountError("phone");
            }
          }

          await assertNoRecentIdentityDuplicate({
            firstName: emailData.firstName,
            lastName: emailData.lastName,
            email,
          });

          const [user] = await db
            .insert(users)
            .values({
              userType,
              email,
              firstName: emailData.firstName,
              lastName: emailData.lastName,
              phone: phone ?? emailData.phone,
              passwordHash: emailData.passwordHash,
              emailVerified: false,
              affiliatePercent: getDefaultAffiliatePercent(userType),
              appContext,
            })
            .returning();
          void syncUserToBrevo(user).catch(() => {});
          return user;
        }
      } catch (error: any) {
        if (error.code === "23505") {
          if (authType === "tradescout") {
            const tsData = userData as TradeScoutUserData;
            const tsEmail = normalizeEmail(tsData.email);
            const existingUser = await db
              .select()
              .from(users)
              .where(
                tsEmail
                  ? or(eq(users.tradescoutId, tsData.tradescoutId), emailMatchesNormalized(tsEmail))
                  : eq(users.tradescoutId, tsData.tradescoutId),
              )
              .limit(1);
            if (existingUser.length > 0) {
              const current = existingUser[0];
              assertAccountCanAuthenticate(current);
              const [user] = await db
                .update(users)
                .set({
                  tradescoutId: tsData.tradescoutId,
                  email: chooseLinkedEmail(current.email, tsEmail),
                  ...(tsEmail ? { emailVerified: true } : {}),
                  firstName: tsData.firstName || current.firstName,
                  lastName: tsData.lastName || current.lastName,
                  appContext: mergeAppContext(current.appContext, appContext),
                  ...linkedAuthUserTypePatch(current, userType),
                  updatedAt: new Date(),
                })
                .where(eq(users.id, current.id))
                .returning();
              void syncUserToBrevo(user).catch(() => {});
              return user;
            }
          } else if (authType === "google") {
            const googleData = userData as GoogleUserData;
            const googleEmail = normalizeEmail(googleData.email);
            const existingUser = await db
              .select()
              .from(users)
              .where(
                googleEmail
                  ? or(eq(users.googleId, googleData.googleId), emailMatchesNormalized(googleEmail))
                  : eq(users.googleId, googleData.googleId),
              )
              .limit(1);
            if (existingUser.length > 0) {
              const current = existingUser[0];
              assertAccountCanAuthenticate(current);
              const [user] = await db
                .update(users)
                .set({
                  googleId: googleData.googleId,
                  email: chooseLinkedEmail(current.email, googleEmail),
                  emailVerified: true,
                  firstName: googleData.firstName || current.firstName,
                  lastName: googleData.lastName || current.lastName,
                  profileImageUrl: googleData.profileImageUrl || current.profileImageUrl,
                  googleAccessToken: googleData.googleAccessToken,
                  appContext: mergeAppContext(current.appContext, appContext),
                  ...linkedAuthUserTypePatch(current, userType),
                  updatedAt: new Date(),
                })
                .where(eq(users.id, current.id))
                .returning();
              void syncUserToBrevo(user).catch(() => {});
              return user;
            }
          } else if (authType === "facebook") {
            const facebookData = userData as FacebookUserData;
            const facebookEmail = normalizeEmail(facebookData.email);
            const existingUser = await db
              .select()
              .from(users)
              .where(
                facebookEmail
                  ? or(eq(users.facebookId, facebookData.facebookId), emailMatchesNormalized(facebookEmail))
                  : eq(users.facebookId, facebookData.facebookId),
              )
              .limit(1);
            if (existingUser.length > 0) {
              const current = existingUser[0];
              assertAccountCanAuthenticate(current);
              const [user] = await db
                .update(users)
                .set({
                  facebookId: facebookData.facebookId,
                  email: chooseLinkedEmail(current.email, facebookEmail),
                  emailVerified: true,
                  firstName: facebookData.firstName || current.firstName,
                  lastName: facebookData.lastName || current.lastName,
                  profileImageUrl: facebookData.profileImageUrl || current.profileImageUrl,
                  facebookAccessToken: facebookData.facebookAccessToken,
                  appContext: mergeAppContext(current.appContext, appContext),
                  ...linkedAuthUserTypePatch(current, userType),
                  updatedAt: new Date(),
                })
                .where(eq(users.id, current.id))
                .returning();
              void syncUserToBrevo(user).catch(() => {});
              return user;
            }
          }
        }
        throw error;
      }
    },

    async getAllUsers(): Promise<User[]> {
      try {
        const { columns } = await getUserTableInfo();
        const hasDisabled = columns.size === 0 || columns.has("is_disabled");
        const whereSql = hasDisabled
          ? `where coalesce("is_disabled"::boolean, false) = false`
          : "";
        return (await selectUsersSafe(`${whereSql} order by "created_at" desc`, [])) as any;
      } catch (error) {
        console.warn("getAllUsers safe projection failed, falling back:", error);
        return await db
          .select()
          .from(users)
          .where(or(eq(users.isDisabled, false), isNull(users.isDisabled)))
          .orderBy(desc(users.createdAt));
      }
    },

    async updateUserStatus(userId: string, isActive: boolean): Promise<void> {
      await db.update(users).set({ isDisabled: !isActive }).where(eq(users.id, userId));
    },

    async createUserManually(userData: {
      email: string;
      firstName: string;
      lastName: string;
      phone: string;
      userType: string;
      tempPassword: string;
    }): Promise<User> {
      const normalizedEmail = normalizeEmail(userData.email);
      if (!normalizedEmail) throw new Error("Valid email is required");
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(emailMatchesNormalized(normalizedEmail))
        .limit(1);
      if (existing) {
        const err: any = new Error("Email already in use");
        err.code = "23505";
        throw err;
      }

      const normalizedPhone = normalizePhone(userData.phone);
      if (normalizedPhone) {
        const [existingPhone] = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              phoneMatchesNormalized(normalizedPhone),
              or(eq(users.isDisabled, false), isNull(users.isDisabled)),
            ),
          )
          .limit(1);
        if (existingPhone) {
          throw duplicateAccountError("phone");
        }
      }

      await assertNoRecentIdentityDuplicate({
        firstName: userData.firstName,
        lastName: userData.lastName,
        email: normalizedEmail,
      });

      const hashedPassword = await bcrypt.hash(userData.tempPassword, 10);
      const affiliatePercent = getDefaultAffiliatePercent(userData.userType);

      const [user] = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          firstName: userData.firstName,
          lastName: userData.lastName,
          phone: normalizedPhone ?? userData.phone,
          userType: userData.userType,
          passwordHash: hashedPassword,
          mustResetPassword: true,
          emailVerified: true,
          affiliatePercent,
        })
        .returning();

      if (shouldAssignAffiliateTag(user.userType)) {
        ensureAffiliateTag(user.id).catch((error) =>
          console.error("[affiliate] Failed to assign tag:", error),
        );
      }

      void syncUserToBrevo(user).catch(() => {});
      return user;
    },

    async createUserInvite(data: {
      email: string;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      userType:
        | "customer"
        | "restaurant_owner"
        | "caterer"
        | "private_chef"
        | "food_truck"
        | "supplier"
        | "host"
        | "event_coordinator"
        | "staff"
        | "admin"
        | "super_admin";
    }): Promise<User> {
      const normalizedEmail = normalizeEmail(data.email);
      if (!normalizedEmail) throw new Error("Valid email is required");
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(emailMatchesNormalized(normalizedEmail))
        .limit(1);
      if (existing) {
        const err: any = new Error("Email already in use");
        err.code = "23505";
        throw err;
      }

      const normalizedPhone = normalizePhone(data.phone);
      if (normalizedPhone) {
        const [existingPhone] = await db
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              phoneMatchesNormalized(normalizedPhone),
              or(eq(users.isDisabled, false), isNull(users.isDisabled)),
            ),
          )
          .limit(1);
        if (existingPhone) {
          throw duplicateAccountError("phone");
        }
      }

      await assertNoRecentIdentityDuplicate({
        firstName: data.firstName,
        lastName: data.lastName,
        email: normalizedEmail,
      });

      const affiliatePercent = getDefaultAffiliatePercent(data.userType);
      const shouldAutoVerify = data.userType === "admin" || data.userType === "super_admin";

      const [user] = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: normalizedPhone ?? data.phone,
          userType: data.userType,
          passwordHash: null,
          mustResetPassword: false,
          emailVerified: shouldAutoVerify,
          affiliatePercent,
        })
        .returning();

      if (shouldAssignAffiliateTag(user.userType)) {
        ensureAffiliateTag(user.id).catch((error) =>
          console.error("[affiliate] Failed to assign tag:", error),
        );
      }

      void syncUserToBrevo(user).catch(() => {});
      return user;
    },
  };
}
