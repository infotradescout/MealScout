import type { CapacitorConfig } from "@capacitor/cli";

// Phase 6 fast-track wrapper strategy:
// keep the existing web app and wrap it for iOS/Android first.
const config: CapacitorConfig = {
  appId: "us.mealscout.app",
  appName: "MealScout",
  webDir: "dist/public",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https",
  },
};

export default config;
