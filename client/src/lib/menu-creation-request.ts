type MenuCreationInput = { restaurantId: string; name: string; serviceType: string };
export type MenuCreationAttempt = {
  actorId: string;
  requestId: string;
  fingerprint: string;
  input: MenuCreationInput;
};

const storageKey = (actorId: string, restaurantId: string, fingerprint: string) =>
  `mealscout.menu-creation:${actorId}:${restaurantId}:${fingerprint}`;

// Store no menu contents: only an opaque retry identity and an input fingerprint.
export async function prepareMenuCreationAttempt(
  actorId: string,
  input: MenuCreationInput,
  storage: Pick<Storage, "getItem" | "setItem"> = window.sessionStorage,
): Promise<MenuCreationAttempt> {
  const canonicalInput = { restaurantId: input.restaurantId, name: input.name, serviceType: input.serviceType };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonicalInput)));
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const key = storageKey(actorId, input.restaurantId, fingerprint);
  const stored = storage.getItem(key);
  let previous: { requestId?: string; fingerprint?: string } | null = null;
  try { previous = stored ? JSON.parse(stored) : null; } catch { /* Ignore invalid local metadata. */ }
  const requestId = previous?.fingerprint === fingerprint &&
    typeof previous.requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(previous.requestId)
    ? previous.requestId : crypto.randomUUID();
  storage.setItem(key, JSON.stringify({ requestId, fingerprint }));
  return { actorId, requestId, fingerprint, input: canonicalInput };
}

export function confirmMenuCreationAttempt(
  attempt: MenuCreationAttempt,
  storage: Pick<Storage, "getItem" | "removeItem"> = window.sessionStorage,
) {
  // A late response must not clear a newer attempt in the same business.
  try {
    const key = storageKey(attempt.actorId, attempt.input.restaurantId, attempt.fingerprint);
    const stored = JSON.parse(storage.getItem(key) || "null");
    if (stored?.requestId === attempt.requestId) storage.removeItem(key);
  } catch { /* Keeping a confirmed retry ID is safe; it replays instead of duplicating. */ }
}

export function assertMenuCreationReceipt(payload: any, attempt: MenuCreationAttempt) {
  if (payload?.menu?.id !== attempt.requestId ||
    payload?.menu?.restaurantId !== attempt.input.restaurantId ||
    payload?.lisaRecord?.id !== attempt.requestId || payload?.lisaRecord?.status !== "recorded") {
    throw new Error("Menu creation could not be confirmed. Retry this same request.");
  }
}
