type LaunchModeState = {
  degraded: boolean;
  source: "env" | "runtime";
  reason: string | null;
  updatedAt: string;
};

const envDefaultDegraded =
  String(process.env.MEALSCOUT_LAUNCH_DEGRADED_MODE || "")
    .trim()
    .toLowerCase() === "true";

let runtimeOverride: boolean | null = null;
let runtimeReason: string | null = null;
let runtimeUpdatedAt: string | null = null;

export function isLaunchDegradedMode() {
  return runtimeOverride ?? envDefaultDegraded;
}

export function getLaunchModeState(): LaunchModeState {
  const degraded = isLaunchDegradedMode();
  if (runtimeOverride !== null) {
    return {
      degraded,
      source: "runtime",
      reason: runtimeReason,
      updatedAt: runtimeUpdatedAt || new Date().toISOString(),
    };
  }

  return {
    degraded,
    source: "env",
    reason: envDefaultDegraded
      ? "MEALSCOUT_LAUNCH_DEGRADED_MODE enabled"
      : null,
    updatedAt: new Date().toISOString(),
  };
}

export function setLaunchDegradedMode(
  degraded: boolean,
  reason?: string | null,
) {
  runtimeOverride = Boolean(degraded);
  runtimeReason = String(reason || "").trim() || null;
  runtimeUpdatedAt = new Date().toISOString();
  return getLaunchModeState();
}

export function clearLaunchDegradedModeOverride() {
  runtimeOverride = null;
  runtimeReason = null;
  runtimeUpdatedAt = null;
  return getLaunchModeState();
}

