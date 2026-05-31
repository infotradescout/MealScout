import type { Express } from "express";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { emailService } from "../emailService";
import { storage } from "../storage";
import { isPasswordStrong, PASSWORD_REQUIREMENTS } from "../utils/passwordPolicy";
import { vacEvaluateRestaurantSignup } from "../vacLite";
import { promoteBusinessSetupToProfile } from "../services/businessOnboardingPromotion";
import { users, insertRestaurantSchema, type User } from "@shared/schema";

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
            .status(400)
            .json({ message: "User with this email already exists" });
        }

        const passwordHash = await bcrypt.hash(validatedUserData.password, 10);
        user = await storage.upsertUserByAuth(
          "email",
          { ...validatedUserData, passwordHash },
          "restaurant_owner",
        );

        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await storage.createEmailVerificationToken({
          userId: user.id,
          tokenHash,
          expiresAt,
          requestIp: req.ip || req.connection?.remoteAddress || undefined,
          userAgent: req.get("User-Agent") || undefined,
        });

        const apiBaseUrl = (
          process.env.PUBLIC_BASE_URL ||
          (req.get("host") ? `${req.protocol}://${req.get("host")}` : null) ||
          "http://localhost:5000"
        ).replace(/\/+$/, "");
        const verifyParams = new URLSearchParams({
          token,
          redirect: "/restaurant-signup",
        });
        const verifyUrl = `${apiBaseUrl}/api/auth/verify-email?${verifyParams.toString()}`;
        await emailService.sendEmailVerificationEmail(user, verifyUrl);

        return res.status(201).json({
          message:
            "Account created. Please verify your email before completing signup.",
          requiresEmailVerification: true,
        });
      }

      const validatedRestaurantData = insertRestaurantSchema
        .omit({ ownerId: true })
        .parse(restaurantData);
      const promoted = await promoteBusinessSetupToProfile(user.id, {
        businessName: validatedRestaurantData.name,
        businessType: validatedRestaurantData.businessType,
        address: validatedRestaurantData.address,
        city: validatedRestaurantData.city,
        state: validatedRestaurantData.state,
        phone: validatedRestaurantData.phone,
        cuisineType: validatedRestaurantData.cuisineType,
        description: validatedRestaurantData.description || null,
        websiteUrl: validatedRestaurantData.websiteUrl || null,
        instagramUrl: validatedRestaurantData.instagramUrl || null,
        facebookPageUrl: validatedRestaurantData.facebookPageUrl || null,
        logoUrl: validatedRestaurantData.logoUrl || null,
        coverImageUrl: validatedRestaurantData.coverImageUrl || null,
        menuItems:
          restaurantData?.menuItems ||
          restaurantData?.menu ||
          restaurantData?.menuDraft ||
          restaurantData?.truck?.menu ||
          [],
      });
      const restaurant = promoted.restaurant as any;

      if (String((restaurant as any)?.businessType || "") === "food_truck") {
        const currentType = String((user as any)?.userType || "");
        const allowedToPromote = ["customer", "restaurant_owner"].includes(
          currentType,
        );
        if (allowedToPromote && currentType !== "food_truck") {
          await storage.updateUserType(user.id, "food_truck");
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
          } else {
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
                .select({ affiliatePercent: users.affiliatePercent })
                .from(users)
                .where(eq(users.id, affiliateUserId))
                .limit(1);
              const percentSnapshot = Math.max(
                Number(affiliate?.affiliatePercent ?? 5),
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
        menuInsertedCount: promoted.menuInsertedCount,
        message: "Restaurant owner account created successfully",
      });
    } catch (error: any) {
      console.error("Error in restaurant signup:", error);
      res.status(400).json({
        message: error.message || "Failed to create restaurant account",
      });
    }
  });
}
