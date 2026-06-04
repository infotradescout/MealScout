import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const auditPath = "MEALSCOUT_EMAIL_COPY_AUDIT.md";
const cleanupMapPath = "CLEANUP_MAP.md";
const activationPath = "server/restaurantActivationService.ts";

if (!existsSync(auditPath)) {
  throw new Error("MEALSCOUT_EMAIL_COPY_AUDIT.md must exist.");
}

if (!existsSync(cleanupMapPath)) {
  throw new Error("CLEANUP_MAP.md must exist.");
}

const audit = readFileSync(auditPath, "utf8");
const cleanupMap = readFileSync(cleanupMapPath, "utf8");
const activation = readFileSync(activationPath, "utf8");

function requireIncludes(source: string, snippet: string, label = snippet) {
  if (!source.toLowerCase().includes(snippet.toLowerCase())) {
    throw new Error(`Missing ${label}.`);
  }
}

function requireMatch(source: string, pattern: RegExp, label: string) {
  if (!pattern.test(source)) {
    throw new Error(`Missing ${label}.`);
  }
}

function normalize(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const normalized = normalize(fullPath);
    if (
      normalized.startsWith("server/public/") ||
      normalized.startsWith("dist/") ||
      normalized.includes("/node_modules/")
    ) {
      continue;
    }
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (/\.(ts|tsx|js|mjs|md)$/.test(entry)) {
      files.push(normalized);
    }
  }
  return files;
}

[
  "Email/template name",
  "File path",
  "Audience",
  "Trigger",
  "Current purpose",
  "CTA",
  "Risk classification",
  "Required correction",
  "Allowed claims",
  "Disallowed claims",
  "Validation/test coverage needed",
  "Correction Status",
].forEach((snippet) => requireIncludes(audit, snippet, `audit section ${snippet}`));

[
  "server/emailNotifications.ts",
  "server/emailService.ts",
  "server/restaurantActivationService.ts",
  "server/eventNotificationCron.ts",
  "server/bootstrap/registerSchedulers.ts",
  "server/utils/accountSetup.ts",
  "server/utils/emailVerification.ts",
  "server/routes/bookingRoutes.ts",
  "server/routes/admin/verificationRoutes.ts",
  "server/routes/dealRouteDependencies.ts",
  "server/dinerDigestService.ts",
  "server/onboardingDripService.ts",
  "server/parkingPassReminder.ts",
  "server/productNotifications.ts",
].forEach((snippet) => requireIncludes(audit, snippet, `inventory file ${snippet}`));

[
  "MealScout emails must never say `TradeScout`",
  "Deals are optional",
  "Deals may help visibility in the MealScout Deals feed",
  "Deals are not required for discovery",
  "A listing/profile can be useful without a deal",
  "Do not claim “new customers” are guaranteed",
  "Do not claim a deal is the single highest-leverage action",
  "Insurance verification and email verification must be separate",
  "Parking Pass booking requires non-expired stored insurance verification",
  "unsubscribe or notification settings language",
].forEach((snippet) => requireIncludes(audit, snippet, `global copy rule ${snippet}`));

[
  "Your MealScout business listing is live",
  "Deals are optional",
  "MealScout Deals feed",
  "menu, photos, hours, schedule, and contact info",
  "notification settings",
].forEach((snippet) => requireIncludes(activation, snippet, `activation correction ${snippet}`));

const riskyPhrases = [
  "Hey TradeScout!",
  "only thing standing between you and new customers",
  "single highest-leverage thing",
  "must create a deal",
  "deal is required",
  "deal required",
  "required to create a deal",
];

const sourceText = listSourceFiles("server")
  .concat(listSourceFiles("client/src"), listSourceFiles("shared"))
  .map((filePath) => `${filePath}\n${readFileSync(filePath, "utf8")}`)
  .join("\n");

for (const phrase of riskyPhrases) {
  if (sourceText.toLowerCase().includes(phrase.toLowerCase())) {
    throw new Error(`Risky email/copy phrase still present: ${phrase}`);
  }
}

if (/Hey\s+\$\{name\}/.test(activation)) {
  throw new Error("Restaurant activation email must not render as 'Hey TradeScout!' when the business/name is TradeScout.");
}

if (!/Deals are optional[\s\S]*MealScout Deals feed/i.test(activation)) {
  throw new Error("Activation deal copy must describe deals as optional and mention the MealScout Deals feed.");
}

if (!/menu[\s\S]*photos[\s\S]*hours[\s\S]*schedule[\s\S]*contact info/i.test(activation)) {
  throw new Error("Activation deal copy must mention non-deal profile improvement paths.");
}

if (!/To unsubscribe[\s\S]*notification settings/i.test(activation)) {
  throw new Error("Activation marketing email must include unsubscribe/notification settings language.");
}

requireMatch(
  cleanupMap,
  /C5A - MealScout Email \+ Copy Audit[\s\S]*Status: `DONE`/,
  "CLEANUP_MAP.md marks C5A DONE",
);

const productFeatureLines = `${audit}\n${cleanupMap}`
  .split(/\r?\n/)
  .filter((line) =>
    /(new product feature|new dashboard|new monetization flow|new provider integration|feature plan)/i.test(
      line,
    ),
  );

for (const line of productFeatureLines) {
  if (!/(no |not |do not|does not|disallowed|without|frozen|approval)/i.test(line)) {
    throw new Error(`Email copy audit appears to introduce feature scope: ${line}`);
  }
}

console.log("mealscout-email-copy-audit.contract: PASS");
