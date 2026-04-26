import type { CapacitorConfig } from "@capacitor/cli";

// Phase 6 fast-track wrapper strategy:
// keep the existing web app and wrap it for iOS/Android first.
// Use the hosted app URL in native wrappers so users get the latest web release
// without waiting for a full binary asset refresh.
const liveAppUrl =
  String(process.env.CAPACITOR_LIVE_URL || "https://www.mealscout.us").trim() ||
  "https://www.mealscout.us";

const config: CapacitorConfig = {
  appId: "us.mealscout.app",
  appName: "MealScout",
  webDir: "dist/public",
  bundledWebRuntime: false,
  server: {
    url: liveAppUrl,
    androidScheme: "https",
    cleartext: liveAppUrl.startsWith("http://"),
    allowNavigation: ["www.mealscout.us", "mealscout.us", "mealscout.onrender.com"],
  },
};

export default config;
