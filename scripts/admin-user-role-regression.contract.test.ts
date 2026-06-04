import { readFileSync } from "node:fs";

const dashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const requiredSnippets = [
  "const toIdentityRole = (userType?: string | null) => {",
  "if (type === \"customer\") return \"customer\";",
  "if (type === \"restaurant_owner\") return \"restaurant_owner\";",
  "if (type === \"food_truck\") return \"food_truck\";",
  "return type || \"unknown\";",
  "userType: selectedUser.userType || \"unknown\"",
  "<option value=\"unknown\">Needs review</option>",
  "role:{toIdentityRole(user.userType)}",
  "attachment:",
  "needs_business_shell",
  "Conflict detected: account role intent",
  "Select business type intent",
];

const forbiddenSnippets = [
  "userType: selectedUser.userType || \"customer\"",
  "if (!attachedBusiness) return \"customer\"",
  "role || \"customer\"",
  "return \"business_owner\"",
];

for (const snippet of requiredSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing admin role regression guard snippet: ${snippet}`);
  }
}

for (const snippet of forbiddenSnippets) {
  if (dashboard.includes(snippet)) {
    throw new Error(`Found forbidden customer fallback snippet: ${snippet}`);
  }
}

console.log("admin-user-role-regression.contract: PASS");
