import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { storage } from "./storage";
import type { GoogleUserData, EmailUserData } from "@shared/schema";
import { sanitizeUser } from "./utils/sanitize";
import {
  isPasswordStrong,
  PASSWORD_REQUIREMENTS,
} from "./utils/passwordPolicy";

export async function setupRestaurantAuth(app: Express) {
  // Check for Google OAuth environment variables
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    // Google Strategy for restaurant owners
    passport.use('google-restaurant', new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `/api/auth/google/callback`,
    },
    async (accessToken: string, refreshToken: string, profile: any, done: any) => {
      try {
        // Extract user data from Google profile
        const userData: GoogleUserData = {
          googleId: profile.id,
          email: profile.emails?.[0]?.value,
          firstName: profile.name?.givenName || null,
          lastName: profile.name?.familyName || null,
          profileImageUrl: profile.photos?.[0]?.value || null,
          googleAccessToken: accessToken,
        };

        // Create or update restaurant owner in database
        const user = await storage.upsertUserByAuth('google', userData, 'restaurant_owner');
        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }));
  }

  // Google OAuth routes for restaurant owners
  app.get("/api/auth/google", (req, res, next) => {
    passport.authenticate('google-restaurant', {
      scope: ['profile', 'email']
    })(req, res, next);
  });

  app.get("/api/auth/google/callback", (req, res, next) => {
    passport.authenticate('google-restaurant', {
      successRedirect: "/restaurant-signup",
      failureRedirect: "/restaurant-signup?error=auth_failed",
    })(req, res, next);
  });

  // Email/password registration for restaurant owners
  app.post("/api/auth/restaurant/register", async (req, res) => {
    try {
      const { email, firstName, lastName, phone, password } = req.body;

      // Validate input
      if (!email || !firstName || !lastName || !phone || !password) {
        return res.status(400).json({ error: "All fields are required" });
      }

      if (!isPasswordStrong(password)) {
        return res.status(400).json({ error: PASSWORD_REQUIREMENTS });
      }

      if (phone.length < 10) {
        return res.status(400).json({ error: "Valid phone number is required" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: "User with this email already exists" });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      const userData: EmailUserData = {
        email,
        firstName,
        lastName,
        phone,
        passwordHash,
      };

      // Create restaurant owner in database
      const user = await storage.upsertUserByAuth('email', userData, 'restaurant_owner');

      // Log in the user
      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({ error: "Failed to log in after registration" });
        }
        res.json({ user: sanitizeUser(user), message: "Registration successful" });
      });
    } catch (error) {
      console.error("Restaurant registration error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Email/password login for restaurant owners
  app.post("/api/auth/restaurant/login", async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }

      // Find user by email
      const user = await storage.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Allow shared business accounts (host + restaurant/bar/truck) to use this login flow.
      const blockedUserTypes = new Set(["admin", "super_admin", "staff"]);
      if (blockedUserTypes.has(String(user.userType || ""))) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Verify password
      if (!user.passwordHash || !await bcrypt.compare(password, user.passwordHash)) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Log in the user
      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({ error: "Failed to log in" });
        }
        res.json({ user: sanitizeUser(user), message: "Login successful" });
      });
    } catch (error) {
      console.error("Restaurant login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Logout route
  app.post("/api/auth/restaurant/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: "Failed to logout" });
      }
      res.json({ message: "Logout successful" });
    });
  });
}

// Middleware to check if user is authenticated restaurant owner
export const isRestaurantOwner = (req: any, res: any, next: any) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (
    ![
      "restaurant_owner",
      "caterer",
      "private_chef",
      "food_truck",
      "admin",
      "super_admin",
    ].includes(req.user.userType)
  ) {
    return res.status(403).json({ error: "Restaurant owner access required" });
  }

  next();
};
