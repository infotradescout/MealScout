import type { Express } from "express";
import bcrypt from "bcryptjs";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { getDefaultAffiliatePercent } from "@shared/affiliatePolicy";
import { emailService } from "../emailService";
import { storage } from "../storage";
import { isPasswordStrong, PASSWORD_REQUIREMENTS } from "../utils/passwordPolicy";
import { createEmailVerificationUrl } from "../utils/emailVerification";
import { vacEvaluateRestaurantSignup } from "../vacLite";
import { menus, users, insertRestaurantSchema, type User } from "@shared/schema";

type RestaurantSignupRouteDependencies = {
  ensureTrialForUser: (user: User) => Promise<User | null | undefined>;
  queueSocialPost: (payload: {
    platform: string;
    target?: string | null;
    message: string;
    link?: string | null;
    metadata?: Record<string, any>;
    scheduledAt?: Date | null;
  }) => Promise<any>;
};

export function registerRestaurantSignupRoutes(
  app: Express,
  { ensureTrialForUser, queueSocialPost }: RestaurantSignupRouteDependencies,
) {
  const normalizePhone = (value: unknown) => String(value || "").replace(/\D/g, "");
  const normalizeIdentityName = (value: unknown) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  const duplicateSignupResponse = (error: any) => {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    const duplicateField = String(error?.duplicateField || "");
    if (code.toUpperCase() === "POSSIBLE_DUPLICATE_ACCOUNT") {
      return {
        status: 409,
        body: {
          message:
            "It looks like you may already have a MealScout account. Please sign in to that account, or contact MealScout support and we will connect the right profile.",
          code: "possible_duplicate_account",
        },
      };
    }
    const isDuplicate =
      error?.status === 409 ||
      code === "23505" ||
      code.startsWith("ACCOUNT_EXISTS") ||
      /already (exists|in use)|duplicate key/i.test(message);
    if (!isDuplicate) return null;
    return {
      status: 409,
      body: {
        message:
          duplicateField === "phone" || code === "ACCOUNT_EXISTS_PHONE"
            ? "An account already exists for this phone number. Please sign in instead."
            : "An account already exists for this email. Please sign in instead.",
        code:
          duplicateField === "phone" || code === "ACCOUNT_EXISTS_PHONE"
            ? "account_exists_phone"
            : "account_exists_email",
      },
    };
  };
  const findRecentPossibleDuplicateByName = async ({
    firstName,
    lastName,
    email,
  }: {
    firstName: unknown;
    lastName: unknown;
    email: unknown;
  }) => {
    const first = normalizeIdentityName(firstName);
    const last = normalizeIdentityName(lastName);
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (first.length < 2 || last.length < 2) return null;

    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
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
          sql`lower(btrim(coalesce(${users.firstName}, ''))) = ${first}`,
          sql`lower(btrim(coalesce(${users.lastName}, ''))) = ${last}`,
          normalizedEmail
            ? sql`lower(btrim(coalesce(${users.email}, ''))) <> ${normalizedEmail}`
            : sql`true`,
          gte(users.createdAt, since),
          or(eq(users.isDisabled, false), isNull(users.isDisabled)),
        ),
      )
      .limit(1);

    return match || null;
  };

  app.post("/api/restaurants/signup", async (req: any, res) => {
    try {
      const { userData, restaurantData } = req.body;
      let user: User;

      if (req.isAuthenticated && req.isAuthenticated() && req.user) {
        user = req.user as User;
        console.log("Using authenticated user for restaurant signup:", {
          userId: user.id,
          userType: user.userType,
        });

        if (!user.emailVerified) {
          return res.status(403).json({
            message: "Please verify your email before continuing.",
            code: "email_not_verified",
          });
        }

        if (user.userType === "customer") {
          console.log("Converting customer account to restaurant owner:", user.id);
          await storage.updateUserType(user.id, "restaurant_owner");
          user = (await storage.getUserById(user.id)) || user;
        }
      } else {
        const validatedUserData = z
          .object({
            email: z.string().email(),
            firstName: z.string().min(1),
            lastName: z.string().min(1),
            phone: z.string().min(10),
            password: z
              .string()
              .min(1, PASSWORD_REQUIREMENTS)
              .refine(isPasswordStrong, PASSWORD_REQUIREMENTS),
          })
          .parse(userData);

        const existingUser = await storage.getUserByEmail(
          validatedUserData.email,
        );
        if (existingUser) {
          return res
            .status(409)
            .json({
              message:
                "An account already exists for this email. Please sign in instead.",
              code: "account_exists_email",
            });
        }

        const existingPhone = await storage.getUserByPhone(
          normalizePhone(validatedUserData.phone),
        );
        if (existingPhone) {
          return res
            .status(409)
            .json({
              message:
                "An account already exists for this phone number. Please sign in instead.",
              code: "account_exists_phone",
            });
        }

        const recentDuplicate = await findRecentPossibleDuplicateByName({
          firstName: validatedUserData.firstName,
          lastName: validatedUserData.lastName,
          email: validatedUserData.email,
        });
        if (recentDuplicate) {
          return res.status(409).json({
            message:
              "It looks like you may already have a MealScout account. Please sign in to that account, or contact MealScout support and we will connect the right profile.",
            code: "possible_duplicate_account",
          });
        }

        const passwordHash = await bcrypt.hash(validatedUserData.password, 10);
        user = await storage.upsertUserByAuth(
          "email",
          { ...validatedUserData, passwordHash },
          "restaurant_owner",
        );

        const verifyUrl = await createEmailVerificationUrl(user, req, {
          next: req.body?.next || "/restaurant-signup",
        });
        if (verifyUrl) {
          await emailService.sendEmailVerificationEmail(user, verifyUrl);
        }

        return res.status(201).json({
          message:
            "Account created. Please verify your email before completing signup.",
          requiresEmailVerification: true,
        });
      }

      const validatedRestaurantData = insertRestaurantSchema
        .omit({ ownerId: true })
        .parse(restaurantData);
      const minimalRestaurantPayload: any = {
        name: String((validatedRestaurantData as any).name || "").trim(),
        address: String((validatedRestaurantData as any).address || "").trim(),
        city: String((validatedRestaurantData as any).city || "").trim(),
        state: String((validatedRestaurantData as any).state || "").trim(),
        businessType: String(
          (validatedRestaurantData as any).businessType || "restaurant",
        ),
        ownerId: user.id,
      };
      const normalizedPhone = String(
        (validatedRestaurantData as any).phone || user.phone || "",
      ).trim();
      if (normalizedPhone) {
        minimalRestaurantPayload.phone = normalizedPhone;
      }

      const cuisineType = String(
        (validatedRestaurantData as any).cuisineType || "",
      ).trim();
      const description = String(
        (validatedRestaurantData as any).description || "",
      ).trim();
      const websiteUrl = String(
        (validatedRestaurantData as any).websiteUrl || "",
      ).trim();
      const instagramUrl = String(
        (validatedRestaurantData as any).instagramUrl || "",
      ).trim();
      const facebookPageUrl = String(
        (validatedRestaurantData as any).facebookPageUrl || "",
      ).trim();

      if (cuisineType) minimalRestaurantPayload.cuisineType = cuisineType;
      if (description) minimalRestaurantPayload.description = description;
      if (websiteUrl) minimalRestaurantPayload.websiteUrl = websiteUrl;
      if (instagramUrl) minimalRestaurantPayload.instagramUrl = instagramUrl;
      if (facebookPageUrl)
        minimalRestaurantPayload.facebookPageUrl = facebookPageUrl;
      if (
        minimalRestaurantPayload.businessType === "caterer" ||
        minimalRestaurantPayload.businessType === "private_chef"
      ) {
        minimalRestaurantPayload.offersCatering = true;
        minimalRestaurantPayload.cateringDetails = {
          headline:
            minimalRestaurantPayload.businessType === "private_chef"
              ? "Private chef bookings available"
              : "Catering available",
          description: description || "",
          serviceArea: [minimalRestaurantPayload.city, minimalRestaurantPayload.state]
            .filter(Boolean)
            .join(", "),
        };
      }

      const amenities = (validatedRestaurantData as any).amenities;
      const hasAmenities =
        amenities &&
        (amenities.parking || amenities.wifi || amenities.outdoor_seating);
      if (
        hasAmenities &&
        !["food_truck", "caterer", "private_chef"].includes(
          minimalRestaurantPayload.businessType,
        )
      ) {
        minimalRestaurantPayload.amenities = amenities;
      }

      const restaurant = await storage.createRestaurant(minimalRestaurantPayload);

      try {
        await db.insert(menus).values({
          restaurantId: restaurant.id,
          name: "All Day Menu",
          serviceType: "all",
          isActive: true,
          acceptsCash: true,
          hidePlatformFee: false,
        });
      } catch (error) {
        console.warn("Failed to create starter menu:", error);
      }

      if (String((restaurant as any)?.businessType || "") === "food_truck") {
        const currentType = String((user as any)?.userType || "");
        const allowedToPromote = [
          "customer",
          "restaurant_owner",
          "caterer",
          "private_chef",
        ].includes(currentType);
        if (allowedToPromote && currentType !== "food_truck") {
          await storage.updateUserType(user.id, "food_truck");
          user = (await storage.getUserById(user.id)) || user;
        }
      } else if (String((restaurant as any)?.businessType || "") === "caterer") {
        const currentType = String((user as any)?.userType || "");
        if (
          ["customer", "restaurant_owner", "food_truck", "private_chef"].includes(
            currentType,
          )
        ) {
          await storage.updateUserType(user.id, "caterer");
          user = (await storage.getUserById(user.id)) || user;
        }
      } else if (
        String((restaurant as any)?.businessType || "") === "private_chef"
      ) {
        const currentType = String((user as any)?.userType || "");
        if (
          ["customer", "restaurant_owner", "food_truck", "caterer"].includes(
            currentType,
          )
        ) {
          await storage.updateUserType(user.id, "private_chef");
          user = (await storage.getUserById(user.id)) || user;
        }
      }

      if (String((restaurant as any)?.businessType || "") === "food_truck") {
        try {
          const { maybeTriggerPensacolaFoodTruckDrip } =
            await import("../services/pensacolaFoodTruckDrip");
          await maybeTriggerPensacolaFoodTruckDrip({
            userId: user.id,
            restaurant,
          });
        } catch (error) {
          console.warn("[drip] Unable to trigger Pensacola food truck drip:", error);
        }
      }

      try {
        const enabled =
          String(
            process.env.VAC_AUTO_VERIFY_ENABLED || "true",
          ).toLowerCase() !== "false";
        if (enabled) {
          const isFoodTruckSignup =
            String((restaurant as any)?.businessType || "") === "food_truck" ||
            Boolean((restaurant as any)?.isFoodTruck);
          const vac = await vacEvaluateRestaurantSignup({
            user,
            restaurant,
            req,
          });
          console.log("🔍 VAC-lite evaluation:", {
            restaurantId: restaurant.id,
            restaurantName: (restaurant as any).name,
            score: vac.score,
            threshold: vac.threshold,
            shouldAutoVerify: vac.shouldAutoVerify,
            signals: vac.signals,
          });

          if (vac.shouldAutoVerify) {
            console.log("✅ Auto-verifying restaurant:", restaurant.id);
            await storage.setRestaurantVerified(restaurant.id, true);
            (restaurant as any).isVerified = true;
            try {
              user = (await ensureTrialForUser(user)) || user;
            } catch (error) {
              console.warn("ensureTrialForUser failed after auto-verify:", error);
            }
          } else if (!isFoodTruckSignup) {
            console.log(
              "⚠️  Creating manual verification request for:",
              restaurant.id,
            );
            const hasPending = await storage.hasPendingVerificationRequest(
              restaurant.id,
            );
            if (!hasPending) {
              await storage.createVerificationRequest({
                restaurantId: restaurant.id,
                documents: [],
              });
            } else {
              console.log("ℹ️  Pending verification request already exists");
            }
          } else {
            console.log(
              "ℹ️  Food truck onboarding skipped manual verification request:",
              restaurant.id,
            );
          }
        }
      } catch (error) {
        console.warn("VAC-lite failed", error);
      }

      if ((restaurant as any).businessType === "food_truck") {
        try {
          const baseUrl = (
            process.env.PUBLIC_BASE_URL || "https://www.mealscout.us"
          ).replace(/\/+$/, "");
          await queueSocialPost({
            platform: "facebook",
            target: "mealscout_page",
            message: `Welcome ${restaurant.name} to MealScout! Catch them on the map and follow their schedule.`,
            link: `${baseUrl}/restaurant/${restaurant.id}`,
          });
        } catch (error) {
          console.error("Failed to queue social post:", error);
        }
      }

      const referralId =
        req.body?.referralId ||
        req.query?.referralId ||
        req.cookies?.referralRecordId ||
        req.cookies?.referralId;

      if (referralId) {
        try {
          const { attachReferralToSignup } = await import("../referralService");
          await attachReferralToSignup(referralId, restaurant.id);
          console.log("[Phase 2] Referral attached:", {
            referralId,
            restaurantId: restaurant.id,
          });
        } catch (error) {
          console.error("[Phase 2] Error attaching referral:", error);
        }
      }

      if (referralId && user?.id) {
        try {
          const { resolveAffiliateUserId } =
            await import("../affiliateTagService");
          const affiliateUserId = await resolveAffiliateUserId(referralId);
          if (affiliateUserId && affiliateUserId !== user.id) {
            const [existingUser] = await db
              .select({ affiliateCloserUserId: users.affiliateCloserUserId })
              .from(users)
              .where(eq(users.id, user.id))
              .limit(1);

            if (!existingUser?.affiliateCloserUserId) {
              const [affiliate] = await db
                .select({
                  affiliatePercent: users.affiliatePercent,
                  userType: users.userType,
                })
                .from(users)
                .where(eq(users.id, affiliateUserId))
                .limit(1);
              const percentSnapshot = Math.max(
                Number(
                  affiliate?.affiliatePercent ??
                    getDefaultAffiliatePercent(affiliate?.userType),
                ),
                0,
              );

              await db
                .update(users)
                .set({
                  affiliateCloserUserId: affiliateUserId,
                  affiliateCloserPercent: percentSnapshot,
                  updatedAt: new Date(),
                })
                .where(eq(users.id, user.id));
            }
          }
        } catch (error) {
          console.error("[Phase 2] Error attaching user referral:", error);
        }
      }

      res.json({
        user,
        restaurant,
        message: "Restaurant owner account created successfully",
      });
    } catch (error: any) {
      console.error("Error in restaurant signup:", error);
      const duplicate = duplicateSignupResponse(error);
      if (duplicate) return res.status(duplicate.status).json(duplicate.body);
      res.status(400).json({
        message: error.message || "Failed to create restaurant account",
      });
    }
  });
}
