import { createHash } from "node:crypto";

type InfinityShadowResult = "sent" | "disabled" | "failed";

function config() {
  return {
    baseUrl: String(process.env.INFINITY_API_URL || "").replace(/\/$/, ""),
    apiKey: String(process.env.INFINITY_API_KEY || ""),
    tenantId: String(process.env.INFINITY_TENANT_ID || ""),
    programId: String(process.env.INFINITY_PROGRAM_ID || ""),
  };
}

function opaqueObjectId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

async function post(
  path: string,
  body: unknown,
  idempotencyKey?: string,
): Promise<InfinityShadowResult> {
  const current = config();
  if (
    !current.baseUrl ||
    !current.apiKey ||
    !current.tenantId ||
    !current.programId
  ) {
    return "disabled";
  }
  if (
    process.env.NODE_ENV === "production" &&
    !current.baseUrl.startsWith("https://")
  ) {
    console.warn(
      "[infinity-shadow] disabled: production endpoint must use HTTPS",
    );
    return "disabled";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(`${current.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${current.apiKey}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Infinity returned ${response.status}`);
    return "sent";
  } catch (error) {
    console.warn("[infinity-shadow] observation was not delivered", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

export async function mirrorInfinityTouch(input: {
  partnerId: string;
  affiliateTag: string;
  canonicalPath: string;
  carrier: "query_ref" | "path_segment";
}): Promise<InfinityShadowResult> {
  const current = config();
  return post("/v1/attribution-touches", {
    programId: current.programId,
    partnerId: input.partnerId,
    carrier: input.carrier,
    target: {
      object: {
        tenantId: current.tenantId,
        objectType: "mealscout_route",
        objectId: opaqueObjectId(input.canonicalPath),
      },
      canonicalPath: input.canonicalPath,
    },
    evidence: {
      affiliateTag: input.affiliateTag,
      source: "mealscout_referral",
    },
  });
}

export async function mirrorInfinitySignup(input: {
  partnerId: string;
  referralProofId: string;
  restaurantId: string;
}): Promise<InfinityShadowResult> {
  const current = config();
  return post(
    "/v1/conversion-evidence",
    {
      object: {
        tenantId: current.tenantId,
        objectType: "restaurant_signup",
        objectId: opaqueObjectId(input.restaurantId),
      },
      eventType: "signup_completed",
      attributionProofId: input.referralProofId,
    },
    `mealscout:signup:${input.partnerId}:${input.restaurantId}`,
  );
}
