import { existsSync, readFileSync } from "node:fs";

const auditPath = "MEALSCOUT_SIGNUP_ACCOUNT_TYPE_MAPPING_AUDIT.md";

if (!existsSync(auditPath)) {
  throw new Error("MEALSCOUT_SIGNUP_ACCOUNT_TYPE_MAPPING_AUDIT.md must exist.");
}

const audit = readFileSync(auditPath, "utf8");
const customerSignup = readFileSync("client/src/pages/customer-signup.tsx", "utf8");
const app = readFileSync("client/src/App.tsx", "utf8");
const unifiedAuth = readFileSync("server/unifiedAuth.ts", "utf8");
const schema = readFileSync("shared/schema.ts", "utf8");
const combined = `${audit}\n${customerSignup}\n${app}\n${unifiedAuth}\n${schema}`;

function requireIncludes(source: string, snippet: string, label = snippet) {
  if (!source.toLowerCase().includes(snippet.toLowerCase())) {
    throw new Error(`Missing ${label}.`);
  }
}

[
  "`Diner` is a user-facing label",
  "`diner` in `/customer-signup?role=diner` maps to the existing `customer` registration behavior",
  "No `diner` database role or `userType` is introduced",
  "`ref` is referral metadata only",
  "/customer-signup?role=diner` is a public, guest-safe route",
  "/customer-signup?role=diner` must enter the normal customer signup form instead of staying on the account-type chooser",
  "Clicking the `Diner` card must mark the signup flow selected locally",
  "Diner UI selection is normalized before chooser/form gating and still submits the canonical existing `customer` account type",
  "Unauthenticated `/api/auth/user` returning 401 on signup pages is guest-safe and non-fatal",
].forEach((snippet) => requireIncludes(audit, snippet, `audit ${snippet}`));

[
  'id: "diner"',
  'accountType: "diner"',
  'label: "Diner"',
  'href: "/customer-signup?role=diner"',
  'type AccountType = "diner" | "host" | "event_organizer" | "business" | "supplier"',
  "const normalizeSignupRole =",
  'if (role === "diner" || role === "customer") return "diner"',
  "const normalizedRole = normalizeSignupRole(searchParams.get(\"role\"))",
  "const hasExplicitSignupFlow = Boolean(normalizedRole || businessTypeParam)",
  "const [signupFlowSelected, setSignupFlowSelected] = useState(hasExplicitSignupFlow)",
  "setSignupFlowSelected(true)",
  'href={preserveReferralHref("/customer-signup")}',
  "onClick={() => setSignupFlowSelected(false)}",
  "if (!signupFlowSelected)",
  'const getRegistrationUserType = ()',
  ': "customer"',
  '"/api/auth/customer/register"',
  'accountType: getRegistrationUserType()',
  'preserveReferralHref(option.href)',
].forEach((snippet) => requireIncludes(customerSignup, snippet, `customer signup ${snippet}`));

if (!app.includes('<Route path="/customer-signup" component={CustomerSignup} />')) {
  throw new Error("/customer-signup route must exist and not route to 404.");
}

if (/const\s+hasExplicitSignupFlow\s*=\s*Boolean\(role\s*\|\|/i.test(customerSignup)) {
  throw new Error("Diner signup gating must use normalizedRole, not raw role.");
}

if (/if\s*\(!hasExplicitSignupFlow\)/.test(customerSignup)) {
  throw new Error("Account-type chooser must not depend only on URL-derived hasExplicitSignupFlow.");
}

if (!unifiedAuth.includes('app.post("/api/auth/customer/register"')) {
  throw new Error("Existing customer registration endpoint must remain present.");
}

if (/\buserType\b[^;\n]*\bdiner\b/i.test(schema) || /\bdiner\b/.test(schema)) {
  throw new Error("shared/schema.ts must not introduce diner as a userType/role.");
}

[
  "new diner role",
  "diner database role",
  "payout logic",
  "fake affiliate tags",
  "Parking Pass access change",
].forEach((forbidden) => {
  const offenders = combined
    .split(/\r?\n/)
    .filter((line) => line.toLowerCase().includes(forbidden.toLowerCase()))
    .filter((line) => !/(no |not |do not|must not|without|disallowed)/i.test(line));
  if (offenders.length) {
    throw new Error(`Signup mapping appears to introduce forbidden scope: ${offenders[0]}`);
  }
});

console.log("mealscout-signup-account-type-mapping.contract: PASS");
