// Save only request identity/input. Never persist a payment client secret.
export type ParkingBookingScope = { userId: string; passId: string; truckId: string };
export type ParkingBookingInput = {
  truckId: string;
  slotTypes: string[];
  selectedDates: string[];
  applyCreditsCents?: number;
  promoCode?: string;
};
export type ParkingBookingRequest = ParkingBookingScope & {
  version: 1;
  requestId: string;
  createdAt: number;
  body: ParkingBookingInput;
};
// Stop before the server's default 24-hour replay lifetime, not after it.
const MAX_REPLAY_AGE_MS = 23 * 60 * 60 * 1000;
const storageMessage = "Booking recovery storage is unavailable. Enable site storage before starting a booking.";
function keyFor(scope: ParkingBookingScope): string {
  if (!scope.userId || !scope.passId || !scope.truckId) throw new Error("Sign in and select a food truck before booking.");
  return `mealscout:parking-request:${[scope.userId, scope.truckId, scope.passId].map(encodeURIComponent).join(":")}`;
}
function storage(): Storage {
  try { return window.sessionStorage; } catch { throw new Error(storageMessage); }
}
export function validateParkingBookingRequest(value: unknown, scope: ParkingBookingScope): ParkingBookingRequest {
  const row = value as ParkingBookingRequest | null;
  if (!row || row.version !== 1 || row.userId !== scope.userId || row.passId !== scope.passId || row.truckId !== scope.truckId ||
      typeof row.requestId !== "string" || !row.requestId || !Number.isFinite(row.createdAt) || !row.body || row.body.truckId !== scope.truckId) {
    throw new Error("The saved booking request could not be read. Check My Schedule before starting another booking.");
  }
  const allowed = new Set(["truckId", "slotTypes", "selectedDates", "applyCreditsCents", "promoCode"]);
  if (Object.keys(row.body).some((key) => !allowed.has(key)) ||
      !Array.isArray(row.body.slotTypes) || row.body.slotTypes.length === 0 ||
      !row.body.slotTypes.every((value) => typeof value === "string" && value.length > 0) ||
      !Array.isArray(row.body.selectedDates) || !row.body.selectedDates.every((value) => typeof value === "string") ||
      (row.body.applyCreditsCents !== undefined && (!Number.isFinite(row.body.applyCreditsCents) || row.body.applyCreditsCents < 0)) ||
      (row.body.promoCode !== undefined && typeof row.body.promoCode !== "string")) {
    throw new Error("The saved booking details are invalid. Check My Schedule before starting another booking.");
  }
  return row;
}
export function loadParkingBookingRequest(scope: ParkingBookingScope): ParkingBookingRequest | null {
  const key = keyFor(scope);
  let raw: string | null;
  try { raw = storage().getItem(key); } catch { throw new Error(storageMessage); }
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Saved booking recovery is unreadable. Check My Schedule before starting another booking."); }
  return validateParkingBookingRequest(value, scope);
}
export function assertParkingBookingReplayAge(request: ParkingBookingRequest, now = Date.now()): void {
  const age = now - request.createdAt;
  if (age < 0 || age >= MAX_REPLAY_AGE_MS) {
    throw new Error("This saved request is too old to retry safely. Check My Schedule and contact support before booking this spot again.");
  }
}
export function prepareParkingBookingRequest(scope: ParkingBookingScope, body: ParkingBookingInput): ParkingBookingRequest {
  const existing = loadParkingBookingRequest(scope);
  if (existing) { assertParkingBookingReplayAge(existing); return existing; }
  const request: ParkingBookingRequest = {
    version: 1, ...scope, requestId: typeof crypto.randomUUID === "function" ? crypto.randomUUID() :
      Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(""), createdAt: Date.now(),
    body: JSON.parse(JSON.stringify(body)) as ParkingBookingInput,
  };
  validateParkingBookingRequest(request, scope);
  const raw = JSON.stringify(request);
  try {
    const store = storage();
    store.setItem(keyFor(scope), raw);
    if (store.getItem(keyFor(scope)) !== raw) throw new Error(storageMessage);
  } catch { throw new Error(storageMessage); }
  return request;
}
export function clearParkingBookingRequest(scope: ParkingBookingScope, requestId: string): void {
  const existing = loadParkingBookingRequest(scope);
  // An obsolete completion must never erase a newer request.
  if (existing?.requestId === requestId) {
    try { storage().removeItem(keyFor(scope)); } catch { throw new Error(storageMessage); }
  }
}
