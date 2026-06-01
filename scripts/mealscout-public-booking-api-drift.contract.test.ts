import { readFileSync } from "node:fs";

const targetFiles = [
  "client/src/pages/parking-pass.tsx",
  "client/src/pages/search.tsx",
  "client/src/pages/scout-prototype.tsx",
  "client/src/pages/public-profile.tsx",
  "client/src/components/booking-payment-modal.tsx",
  "client/src/components/admin/host-location-manager.tsx",
];

const disallowedPatterns = [
  { label: 'fetch("/api/...") raw call', regex: /fetch\(\s*["'`]\/api\// },
  { label: 'axios("/api/...") raw call', regex: /axios\(\s*["'`]\/api\// },
];

for (const filePath of targetFiles) {
  const source = readFileSync(filePath, "utf8");
  const lines = source.split(/\r?\n/);

  for (const pattern of disallowedPatterns) {
    if (pattern.regex.test(source)) {
      throw new Error(`${filePath}: disallowed ${pattern.label}`);
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed.includes("mutationFn")) continue;
    if (!trimmed.includes("/api/")) continue;
    if (trimmed.includes("apiUrl(") || trimmed.includes("apiRequest(")) continue;
    throw new Error(
      `${filePath}:${index + 1} disallowed mutationFn raw /api usage`,
    );
  }
}

console.log("mealscout-public-booking-api-drift.contract: PASS");
