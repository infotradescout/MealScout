const REQUIRED_ENV_VARS = ["DATABASE_URL", "SESSION_SECRET"] as const;

function getMissingRequiredEnvVars(): string[] {
  return REQUIRED_ENV_VARS.filter((envName) => !process.env[envName]);
}

export function validateRequiredEnvOnModuleLoad(): void {
  const missing = getMissingRequiredEnvVars();

  if (missing.length > 0) {
    const errorMessage = `FATAL: Missing required environment variables: ${missing.join(", ")}`;
    console.error(errorMessage);
    if (process.env.NODE_ENV === "production") {
      throw new Error(errorMessage);
    }
  }

  if (process.env.ALLOWED_ORIGINS) {
    const origins = process.env.ALLOWED_ORIGINS.split(",").map((origin) =>
      origin.trim(),
    );
    if (origins.length === 0) {
      console.warn(
        "ALLOWED_ORIGINS is empty, using default: http://localhost:5000",
      );
    } else {
      console.log("ALLOWED_ORIGINS configured:", origins.join(", "));
    }
  } else {
    console.warn(
      "ALLOWED_ORIGINS not set, defaulting to: http://localhost:5000",
    );
  }
}

export function validateEnvironmentForStartup(): boolean {
  const missing = getMissingRequiredEnvVars();

  if (missing.length > 0) {
    const errorMessage = `FATAL: Missing required environment variables: ${missing.join(", ")}`;
    console.error(errorMessage);
    if (process.env.NODE_ENV === "production") {
      console.error(
        "Production mode: cannot start without required configuration",
      );
      process.exit(1);
    } else {
      console.warn(
        "Development mode: starting with incomplete configuration. Runtime errors may follow.",
      );
    }
    return false;
  }

  console.log("All required environment variables present");
  return true;
}
