const truthyValues = new Set(["1", "true", "yes", "on"]);

function readFlag(name: string) {
  return truthyValues.has(String(process.env[name] || "").trim().toLowerCase());
}

export function isLaunchDegradedMode() {
  return (
    readFlag("LAUNCH_DEGRADED_MODE") ||
    readFlag("MEALSCOUT_LAUNCH_DEGRADED_MODE") ||
    readFlag("MAP_DEGRADED_MODE")
  );
}
