import { readFileSync } from "node:fs";

const publicProfile = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const profileBoundary = readFileSync(
  "client/src/components/public-profile/ProfileErrorBoundary.tsx",
  "utf8",
);
const analyticsRoutes = readFileSync("server/routes/analyticsRoutes.ts", "utf8");

const approvedSignals = [
  "public_profile_page_error",
  "public_profile_not_found_viewed",
  "missing_menu_viewed",
  "missing_schedule_viewed",
  "failed_profile_image",
];

for (const signal of approvedSignals) {
  if (!publicProfile.includes(signal) && !analyticsRoutes.includes(signal)) {
    throw new Error(`Missing approved public profile quality signal: ${signal}`);
  }
}

const forbiddenSignalNames = [
  "search_no_results",
  "city_low_coverage_search",
  "scout_card_navigation_failed",
  "stale_schedule_shown",
  "failed_scout_card_image",
];
for (const signal of forbiddenSignalNames) {
  if (publicProfile.includes(signal) || analyticsRoutes.includes(signal)) {
    throw new Error(`Out-of-scope quality signal included in public profile slice: ${signal}`);
  }
}

const requiredSafeFields = [
  "type",
  "profile_id",
  "profile_type",
  "path",
  "missing_menu",
  "missing_schedule",
  "failed_image_type",
  "timestamp",
];
for (const field of requiredSafeFields) {
  if (!publicProfile.includes(field) || !analyticsRoutes.includes(field)) {
    throw new Error(`Quality signal safe field missing from client/server path: ${field}`);
  }
}

const forbiddenPayloadFields = [
  "error_message",
  "errorMessage",
  "stack",
  "apiResponse",
  "rawResponse",
  "phone",
  "email",
  "address",
  "latitude",
  "longitude",
  "cookie",
  "authorization",
  "token",
  "payment",
  "screenshot",
  "sessionReplay",
];
const signalClientBlock = publicProfile.slice(
  publicProfile.indexOf("const sendPublicProfileQualitySignal"),
  publicProfile.indexOf("const hasStructuredPublicMenu"),
);
const signalServerBlock = analyticsRoutes.slice(
  analyticsRoutes.indexOf('app.post("/api/analytics/shell"'),
  analyticsRoutes.indexOf('app.get("/api/search/trending"'),
);
for (const field of forbiddenPayloadFields) {
  if (signalClientBlock.includes(field) || signalServerBlock.includes(field)) {
    throw new Error(`Sensitive field must not be sent by quality telemetry: ${field}`);
  }
}

if (!signalServerBlock.includes(".strip()")) {
  throw new Error("/api/analytics/shell must strip unsupported client fields");
}
for (const snippet of [
  "userId: null",
  "sessionId: null",
  "anonymousActorId: null",
  "ip: null",
  "userAgent: null",
]) {
  if (!signalServerBlock.includes(snippet)) {
    throw new Error(`Quality signal request log must avoid user/device identifiers: ${snippet}`);
  }
}

if (signalClientBlock.includes(".message") || signalClientBlock.includes("String(error")) {
  throw new Error("Raw JavaScript error messages must not be sent in quality telemetry");
}
if (!profileBoundary.includes("componentDidCatch(_error: Error, _errorInfo: ErrorInfo)")) {
  throw new Error("Profile error boundary must avoid reading raw error details");
}
const pageErrorSignalPattern =
  /trackQualitySignal\(\s*"public_profile_page_error",\s*undefined,\s*"render-error",?\s*\)/;
if (!pageErrorSignalPattern.test(publicProfile)) {
  throw new Error("Public profile page error signal must use safe render-error category only");
}

const dedupeRequirements = [
  "`mealscout:public-profile-quality:${dedupeKey}`",
  '"missing-menu"',
  '"missing-schedule"',
  "`failed-image:${candidate.type}:${candidate.url}`",
  "imageFailureRef.current.has(imageKey)",
];
for (const snippet of dedupeRequirements) {
  if (!publicProfile.includes(snippet)) {
    throw new Error(`Missing public profile quality dedupe guard: ${snippet}`);
  }
}

if (!signalClientBlock.includes('fetch(apiUrl("/api/analytics/shell")')) {
  throw new Error("Public profile quality telemetry must use /api/analytics/shell");
}
if (!signalClientBlock.includes(".catch(() => {})")) {
  throw new Error("Telemetry network failure must be swallowed");
}
if (!signalClientBlock.includes("Quality telemetry must never affect public profile rendering.")) {
  throw new Error("Telemetry try/catch safety comment missing");
}

if (!profileBoundary.includes("export class ProfileErrorBoundary")) {
  throw new Error("Public profile error boundary must be present");
}
if (
  !profileBoundary.includes('href="/scout"') ||
  !profileBoundary.includes("Refresh profile") ||
  !profileBoundary.includes("profile-surface")
) {
  throw new Error("Public profile error boundary must render a safe recovery state");
}
if (!publicProfile.includes("<ProfileErrorBoundary")) {
  throw new Error("Public profile page must wrap public profile rendering in the gated boundary");
}

const forbiddenRuntimeSurfaces = [
  "actionCards",
  "/api/mealscout/intake/preview",
  "/api/import/preview",
  "adminQueue",
  "claiming",
  "live-feed",
  "importGeminiUnverifiedProfilesLive",
  "prepareGeminiUnverifiedProfileImport",
];
for (const snippet of forbiddenRuntimeSurfaces) {
  if (publicProfile.includes(snippet) || analyticsRoutes.includes(snippet) || profileBoundary.includes(snippet)) {
    throw new Error(`Out-of-scope runtime surface touched by quality signal lane: ${snippet}`);
  }
}

console.log("public-profile-quality-signals.contract: PASS");
