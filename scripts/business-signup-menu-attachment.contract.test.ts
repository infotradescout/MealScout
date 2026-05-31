import fs from "fs";
import path from "path";

const root = process.cwd();
const userAdminPath = path.join(root, "server", "routes", "admin", "userAdminRoutes.ts");
const signupPath = path.join(root, "server", "routes", "restaurantSignupRoutes.ts");
const promotionPath = path.join(root, "server", "services", "businessOnboardingPromotion.ts");

const userAdminSource = fs.readFileSync(userAdminPath, "utf8");
const signupSource = fs.readFileSync(signupPath, "utf8");
const promotionSource = fs.readFileSync(promotionPath, "utf8");

const checks = [
  {
    label: "admin create-and-attach endpoint",
    ok: userAdminSource.includes('/api/admin/business-users/:userId/create-and-attach'),
  },
  {
    label: "admin endpoint uses shared promotion service",
    ok: userAdminSource.includes("promoteBusinessSetupToProfile"),
  },
  {
    label: "signup uses shared promotion service",
    ok: signupSource.includes("promoteBusinessSetupToProfile") && signupSource.includes("menuInsertedCount"),
  },
  {
    label: "promotion service hydrates canonical menu tables",
    ok: promotionSource.includes("ensureRestaurantMenuItems") && promotionSource.includes("menuItems"),
  },
];

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error("business-signup-menu-attachment.contract: FAIL");
  failed.forEach((c) => console.error(`missing: ${c.label}`));
  process.exit(1);
}

console.log("business-signup-menu-attachment.contract: PASS");
