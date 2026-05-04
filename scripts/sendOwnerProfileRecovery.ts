import {
  findOwnerProfileRecoveryCandidates,
  sendOwnerProfileRecoveryEmail,
} from "../server/services/ownerProfileRecovery";

const lookbackDays = Math.max(
  1,
  Number(process.env.OWNER_PROFILE_RECOVERY_LOOKBACK_DAYS || 365),
);
const shouldSend =
  String(process.env.SEND_OWNER_PROFILE_RECOVERY || "").toLowerCase() ===
  "true";
const force =
  String(process.env.OWNER_PROFILE_RECOVERY_FORCE || "").toLowerCase() ===
  "true";
const baseUrl = process.env.PUBLIC_BASE_URL || "https://www.mealscout.us";
const thresholdMinutes = Math.max(
  1,
  Number(process.env.OWNER_PROFILE_RECOVERY_THRESHOLD_MINUTES || 20),
);
const intervalHours = Math.max(
  1,
  Number(process.env.OWNER_PROFILE_RECOVERY_EMAIL_INTERVAL_HOURS || 24),
);

const maskEmail = (value: unknown) =>
  String(value || "").replace(/^(.).+(@.*)$/, "$1***$2");

const candidates = await findOwnerProfileRecoveryCandidates({
  lookbackDays,
  thresholdMinutes,
  intervalHours,
  includeAlreadySent: force,
});
console.log(
  `[owner-profile-recovery] candidates=${candidates.length} lookbackDays=${lookbackDays} thresholdMinutes=${thresholdMinutes} intervalHours=${intervalHours} mode=${shouldSend ? "send" : "dry-run"} force=${force}`,
);

let sent = 0;
let skipped = 0;
for (const row of candidates) {
  if (!shouldSend) {
    console.log(
      `[owner-profile-recovery] dry-run owner=${row.id} email=${maskEmail(row.email)} type=${row.userType} verified=${Boolean(row.emailVerified)} reason=${row.recoveryReason} restaurants=${row.restaurantCount} items=${row.menuItemCount}`,
    );
    continue;
  }

  const outcome = await sendOwnerProfileRecoveryEmail({
    user: row,
    baseUrl,
    force,
    requestMeta: {
      adminId: "script:sendOwnerProfileRecovery",
    },
  });
  if (outcome.ok && !outcome.skipped) sent++;
  if (outcome.skipped) skipped++;
  console.log(
    `[owner-profile-recovery] owner=${row.id} email=${maskEmail(row.email)} ok=${outcome.ok} skipped=${outcome.skipped || "none"} reason=${row.recoveryReason}`,
  );
}

console.log(`[owner-profile-recovery] done sent=${sent} skipped=${skipped}`);
