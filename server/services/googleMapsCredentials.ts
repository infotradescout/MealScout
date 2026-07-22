export type GoogleMapsServerCredentialMode =
  | "dedicated"
  | "browser_only"
  | "missing";

export type GoogleMapsCredentialState = {
  browserApiKey: string;
  serverApiKey: string;
  browserAuthorized: boolean;
  serverAuthorized: boolean;
  serverCredentialMode: GoogleMapsServerCredentialMode;
};

const readFirst = (
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): string => {
  for (const name of names) {
    const value = String(env[name] || "").trim();
    if (value) return value;
  }
  return "";
};

/**
 * Browser Google keys are normally HTTP-referrer restricted. Google rejects
 * those credentials from server-to-server Places and Routes requests, so the
 * two credential classes must never fall back to one another.
 */
export function resolveGoogleMapsCredentials(
  env: NodeJS.ProcessEnv = process.env,
): GoogleMapsCredentialState {
  const serverApiKey = readFirst(env, [
    "GOOGLE_MAPS_API_KEY",
    "GOOGLE_API_KEY",
  ]);
  const browserApiKey = readFirst(env, [
    "VITE_GOOGLE_MAPS_WEB_API_KEY",
    "VITE_GOOGLE_MAPS_API_KEY",
    "VITE_GOOGLE_API_KEY",
  ]);
  const serverAuthorized = serverApiKey.length > 0;
  const browserAuthorized = browserApiKey.length > 0;

  return {
    browserApiKey,
    serverApiKey,
    browserAuthorized,
    serverAuthorized,
    serverCredentialMode: serverAuthorized
      ? "dedicated"
      : browserAuthorized
        ? "browser_only"
        : "missing",
  };
}

export const getGoogleMapsServerApiKey = () =>
  resolveGoogleMapsCredentials().serverApiKey;

export const getGoogleMapsWebApiKey = () =>
  resolveGoogleMapsCredentials().browserApiKey;
