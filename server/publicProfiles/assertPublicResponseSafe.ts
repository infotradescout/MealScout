const forbiddenPublicKeys = new Set([
  "ownerid",
  "userid",
  "createdby",
  "claimedby",
  "adminnotes",
  "internalnotes",
  "privatenotes",
  "privateemail",
  "emailprivate",
  "phoneprivate",
  "stripe",
  "stripecustomerid",
  "stripeaccountid",
  "payout",
  "taxinfo",
  "insurance",
  "verificationinternalstatus",
  "rawsettings",
  "parkingpass",
  "parkingpassid",
  "hostinventory",
  "capacityinternal",
  "sourceinternal",
  "auth",
  "password",
  "token",
  "session",
  "role",
  "permissions",
  "deliveryaddress",
  "deliverycity",
  "deliverystate",
  "deliverypostalcode",
  "deliveryinstructions",
  "stripepaymentintentid",
  "stripetransfergroupid",
  "customeraccesstoken",
  "customeraccesstokenhash",
  "checkoutrequestid",
]);

type PublicGuardMode = "throw" | "throw-prod-safe";

const resolveMode = (): PublicGuardMode =>
  process.env.NODE_ENV === "production" ? "throw-prod-safe" : "throw";

const pathJoin = (base: string, segment: string) =>
  base ? `${base}.${segment}` : segment;

function assertSafeInternal(value: unknown, path: string): void {
  if (value == null) return;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertSafeInternal(value[i], `${path}[${i}]`);
    }
    return;
  }

  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  for (const [key, nested] of Object.entries(record)) {
    const keyPath = pathJoin(path, key);
    if (forbiddenPublicKeys.has(key.toLowerCase())) {
      throw new Error(`[public-response-safety] forbidden key "${key}" at path "${keyPath}"`);
    }
    assertSafeInternal(nested, keyPath);
  }
}

export function assertPublicResponseSafe<T>(payload: T): T {
  const mode = resolveMode();
  try {
    assertSafeInternal(payload, "");
    return payload;
  } catch (error) {
    if (mode === "throw-prod-safe") {
      console.error("[public-response-safety] blocked unsafe payload", error);
      throw new Error("Public response safety validation failed");
    }
    throw error;
  }
}

export { forbiddenPublicKeys };
