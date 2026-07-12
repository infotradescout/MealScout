import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canAssignUserType,
  isInternalTeamUserType,
} from "../server/roleAccess";

// Normalize CRLF -> LF so multi-line marker matching below (which embeds
// literal "\n") works the same on a Windows checkout as it does in CI.
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const staffRoutes = read("server/staffRoutes.ts");
const unifiedAuth = read("server/unifiedAuth.ts");

function extractRouteBlock(method: "get" | "post", path: string): string {
  const marker = `app.${method}(\n    "${path}",`;
  const start = staffRoutes.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${method.toUpperCase()} ${path} route`);

  const nextRoute = staffRoutes.indexOf("\n  app.", start + marker.length);
  return staffRoutes.slice(start, nextRoute === -1 ? undefined : nextRoute);
}

function assertRouteUses(
  method: "get" | "post",
  path: string,
  middlewares: string[],
) {
  const block = extractRouteBlock(method, path);

  for (const middleware of middlewares) {
    assert.ok(
      block.includes(middleware),
      `${method.toUpperCase()} ${path} must include ${middleware}`,
    );
  }
}

assert.ok(
  unifiedAuth.includes("export const isStaffOrAdmin = requireRole([") &&
    unifiedAuth.includes('"staff"') &&
    unifiedAuth.includes('"admin"') &&
    unifiedAuth.includes('"duper_admin"') &&
    unifiedAuth.includes('"super_admin"'),
  "isStaffOrAdmin must include staff, admin, duper_admin, and super_admin roles",
);

assertRouteUses("get", "/api/admin/staff", ["isAuthenticated", "isAdmin"]);
assertRouteUses("post", "/api/admin/staff/:userId/promote", [
  "isAuthenticated",
  "isAdmin",
]);
assertRouteUses("post", "/api/admin/staff/:userId/demote", [
  "isAuthenticated",
  "isAdmin",
]);
assertRouteUses("post", "/api/staff/users", [
  "isAuthenticated",
  "isStaffOrAdmin",
]);
assertRouteUses("post", "/api/staff/restaurant-owners", [
  "isAuthenticated",
  "isStaffOrAdmin",
]);

assert.equal(
  canAssignUserType("staff", "admin"),
  false,
  "staff users must not be able to assign admin accounts",
);
assert.equal(
  canAssignUserType("staff", "staff"),
  false,
  "staff users must not be able to assign staff accounts",
);
assert.equal(
  canAssignUserType("staff", "customer"),
  true,
  "staff users should still be able to create customer accounts",
);
assert.equal(
  canAssignUserType("admin", "staff"),
  true,
  "admin users should still be able to assign staff accounts",
);
assert.equal(
  canAssignUserType("admin", "super_admin"),
  false,
  "admin users must not be able to assign super_admin accounts",
);
assert.equal(
  canAssignUserType("super_admin", "super_admin"),
  true,
  "super_admin users should be able to assign super_admin accounts",
);
assert.equal(
  isInternalTeamUserType("staff"),
  true,
  "staff must remain an internal team role",
);
assert.equal(
  isInternalTeamUserType("customer"),
  false,
  "customer must not be treated as an internal team role",
);

const staffUsersBlock = extractRouteBlock("post", "/api/staff/users");
assert.ok(
  staffUsersBlock.includes("canAssignUserType(staffUser.userType, targetUserType)"),
  "POST /api/staff/users must gate requested userType through canAssignUserType",
);
assert.ok(
  staffUsersBlock.includes("userType: targetUserType"),
  "POST /api/staff/users must persist the sanitized targetUserType",
);

console.log("PASS staff RBAC non-mutating guardrails remain enforced.");
