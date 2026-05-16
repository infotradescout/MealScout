type EnvSpec = {
  DATABASE_URL: string;
  TRADESCOUT_API_TOKEN?: string;
  SESSION_SECRET: string;
  CLIENT_ORIGIN: string;
  BREVO_API_KEY?: string;
  INCIDENT_EMAIL_RECIPIENTS?: string;
  INCIDENT_SIGNATURE_SECRET?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
};

function required(name: keyof EnvSpec): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: keyof EnvSpec): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v : undefined;
}

function requiredInProd(name: keyof EnvSpec): string | undefined {
  const value = optional(name);
  if (process.env.NODE_ENV === "production" && !value) {
    throw new Error(`Missing required env var in production: ${name}`);
  }
  return value;
}

export function validateEnv(): EnvSpec {
  const isProduction = process.env.NODE_ENV === "production";
  const env: EnvSpec = {
    DATABASE_URL: optional("DATABASE_URL") || "",
    TRADESCOUT_API_TOKEN: optional("TRADESCOUT_API_TOKEN"),
    SESSION_SECRET: required("SESSION_SECRET"),
    CLIENT_ORIGIN: required("CLIENT_ORIGIN"),
    // Email notifications are nice-to-have; don't hard-block startup if missing.
    // If missing, related actions should fail gracefully and/or log warnings.
    BREVO_API_KEY: optional("BREVO_API_KEY"),
    INCIDENT_EMAIL_RECIPIENTS: optional("INCIDENT_EMAIL_RECIPIENTS"),
    INCIDENT_SIGNATURE_SECRET: requiredInProd("INCIDENT_SIGNATURE_SECRET"),
    TWILIO_ACCOUNT_SID: optional("TWILIO_ACCOUNT_SID"),
    TWILIO_AUTH_TOKEN: optional("TWILIO_AUTH_TOKEN"),
  };

  if (!env.CLIENT_ORIGIN.startsWith("http")) {
    throw new Error("CLIENT_ORIGIN must be a valid http(s) origin");
  }

  const tradeScoutIntegrationEnabled =
    process.env.TRADESCOUT_INTEGRATION_ENABLED === "true" ||
    process.env.TRADESCOUT_API_TOKEN_REQUIRED === "true";
  if (!env.TRADESCOUT_API_TOKEN && tradeScoutIntegrationEnabled) {
    console.warn(
      "⚠️  TRADESCOUT_API_TOKEN not set - TradeScout LLM integration will be unavailable"
    );
  }

  if (!env.DATABASE_URL) {
    console.warn(
      "⚠️  DATABASE_URL is not set – running in limited dev mode without database connectivity."
    );
  }

  // Warn but do not prevent the server from starting when incident email
  // configuration is missing.
  if (!env.BREVO_API_KEY) {
    console.warn(
      "⚠️  BREVO_API_KEY is not set – incident email notifications will fail and related actions will error until configured."
    );
  }

  if (!env.INCIDENT_EMAIL_RECIPIENTS) {
    console.warn(
      "⚠️  INCIDENT_EMAIL_RECIPIENTS is not set – incident email notifications will throw errors when triggered."
    );
  }

  if (
    (env.TWILIO_ACCOUNT_SID && !env.TWILIO_AUTH_TOKEN) ||
    (!env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)
  ) {
    console.warn(
      "⚠️  Partial Twilio configuration detected – SMS incident notifications will be disabled until all TWILIO_* vars are set."
    );
  }

  return env;
}
