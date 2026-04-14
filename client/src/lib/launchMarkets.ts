export const PENSACOLA_MARKET = {
  city: "Pensacola",
  state: "FL",
  latitude: 30.4213,
  longitude: -87.2169,
} as const;

export const PENSACOLA_RADIATE_MARKETS = [
  { city: "Pensacola", state: "FL" },
  { city: "Gulf Breeze", state: "FL" },
  { city: "Pensacola Beach", state: "FL" },
  { city: "Milton", state: "FL" },
  { city: "Pace", state: "FL" },
  { city: "Navarre", state: "FL" },
  { city: "Fort Walton Beach", state: "FL" },
  { city: "Destin", state: "FL" },
  { city: "Mobile", state: "AL" },
] as const;

const toRad = (v: number) => (v * Math.PI) / 180;

export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function isPensacolaAreaCity(name?: string | null): boolean {
  const normalized = String(name || "").trim().toLowerCase();
  return PENSACOLA_RADIATE_MARKETS.some(
    (row) => row.city.toLowerCase() === normalized,
  );
}

