// Explicit modes preserve existing recovery and already completed acquisition work.
if (process.env.MEAL_HOST_INDEXNOW_MODE) {
  await import("./verifyHostIndexNowDelivery.mjs");
} else if (process.env.MEAL_RETAINED_TAINT_PROOF === "1") {
  await import("./verifyRetainedJourneyTaints.mjs");
} else if (process.env.MEAL_TRAFFIC_DASHBOARD_OBSERVE) {
  await import("./observeTrafficQualityDashboard.mjs");
} else if (process.env.MEAL_TRAFFIC_DASHBOARD_SHA) {
  await import("./verifyTrafficQualityDashboard.mjs");
} else if (process.env.MEALSCOUT_ACQUISITION_PROOF === "1") {
  await import("./verifyAcquisitionSignals.mjs");
} else {
  await import("./verifyRecoveryIsolatedOriginal.mjs");
}
