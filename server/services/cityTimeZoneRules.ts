export function usStateToTimeZone(state: string | null | undefined): string {
  const abbr = String(state || "").trim().toUpperCase();
  if (abbr === "AZ") return "America/Phoenix";
  const pacific = new Set(["CA", "OR", "WA", "NV"]);
  const mountain = new Set(["CO", "ID", "MT", "NM", "UT", "WY"]);
  const central = new Set([
    "AL", "AR", "IL", "IA", "KS", "KY", "LA", "MN", "MS", "MO",
    "ND", "NE", "OK", "SD", "TN", "TX", "WI",
  ]);
  const eastern = new Set([
    "CT", "DC", "DE", "FL", "GA", "IN", "MA", "MD", "ME", "MI",
    "NC", "NH", "NJ", "NY", "OH", "PA", "RI", "SC", "VA", "VT",
    "WV",
  ]);
  if (pacific.has(abbr)) return "America/Los_Angeles";
  if (mountain.has(abbr)) return "America/Denver";
  if (central.has(abbr)) return "America/Chicago";
  if (eastern.has(abbr)) return "America/New_York";
  return "America/Chicago";
}

const FL_PANHANDLE_CITY_HINT =
  /\b(pensacola|gulf\s*breeze|navarre|pace|milton|cantonment|crestview|niceville|fort\s*walton|destin|panama\s*city|lynn\s*haven)\b/i;

export function resolveCityTimeZoneSync(params: {
  city?: string | null;
  state?: string | null;
}): string {
  const city = String(params.city || "").trim();
  const state = String(params.state || "").trim().toUpperCase();
  if (state === "FL") {
    return city && FL_PANHANDLE_CITY_HINT.test(city)
      ? "America/Chicago"
      : "America/New_York";
  }
  return usStateToTimeZone(state);
}
