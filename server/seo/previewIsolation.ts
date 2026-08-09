export type PreviewIsolationEnvironment = {
  [name: string]: string | undefined;
  MEALSCOUT_PREVIEW_NOINDEX?: string;
  VERCEL_ENV?: string;
};

const normalizedEnvironmentValue = (value: unknown): string =>
  String(value || "").trim().toLowerCase();

export const isIsolatedDeployment = (
  environment: PreviewIsolationEnvironment = process.env,
): boolean =>
  normalizedEnvironmentValue(environment.MEALSCOUT_PREVIEW_NOINDEX) ===
    "true" || normalizedEnvironmentValue(environment.VERCEL_ENV) === "preview";

export const isIsolatedSitemapPath = (pathValue: unknown): boolean =>
  /^\/sitemap(?:-[^/]+)?\.xml$/i.test(String(pathValue || ""));
