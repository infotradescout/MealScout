// Explicit modes preserve existing recovery and already completed acquisition work.
if (process.env.MEAL_TRAFFIC_DASHBOARD_SHA) {
  await import("./verifyTrafficQualityDashboard.mjs");
} else if (process.env.MEALSCOUT_ACQUISITION_PROOF === "1") {
  await import("./verifyAcquisitionSignals.mjs");
} else {
  await import("./verifyRecoveryIsolatedOriginal.mjs");
}
