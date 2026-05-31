import crypto from "crypto";

const isProduction = process.env.NODE_ENV === "production";

const hashValue = (value: unknown): string | null => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 10);
};

const redactEmail = (value: unknown): string | null => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || !raw.includes("@")) return null;
  const [local] = raw.split("@");
  return `${local.slice(0, 2)}***@***`;
};

type AuthLogPayload = Record<string, unknown>;

const sanitizeForProduction = (payload: AuthLogPayload): AuthLogPayload => {
  const out: AuthLogPayload = {};
  for (const [key, value] of Object.entries(payload || {})) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.includes("session")) {
      if (normalizedKey.includes("id")) {
        out[key] = hashValue(value);
      }
      continue;
    }
    if (
      normalizedKey.includes("cookie") ||
      normalizedKey.includes("token") ||
      normalizedKey.includes("secret") ||
      normalizedKey === "query" ||
      normalizedKey.includes("code")
    ) {
      continue;
    }
    if (normalizedKey.includes("email")) {
      out[key] = redactEmail(value);
      continue;
    }
    out[key] = value;
  }
  return out;
};

export const authLog = (message: string, payload: AuthLogPayload = {}) => {
  const safePayload = isProduction ? sanitizeForProduction(payload) : payload;
  console.log(message, safePayload);
};

