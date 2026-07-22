export function isMealScoutProductionUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/\.$/, "");
    return hostname === "mealscout.us" || hostname.endsWith(".mealscout.us");
  } catch {
    return false;
  }
}
