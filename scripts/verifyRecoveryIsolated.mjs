// Explicit acquisition mode reuses this isolated service without replaying recovery work.
if (process.env.MEALSCOUT_ACQUISITION_PROOF === "1") {
  await import("./verifyAcquisitionSignals.mjs");
} else {
  await import("./verifyRecoveryIsolatedOriginal.mjs");
}
