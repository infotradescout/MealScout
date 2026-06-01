import { readFileSync } from "node:fs";

const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const adminRoutes = readFileSync("server/adminRoutes.ts", "utf8");
const adminManagementRoutes = readFileSync(
  "server/routes/adminManagementRoutes.ts",
  "utf8",
);
const navigation = readFileSync("client/src/components/navigation.tsx", "utf8");

const requiredSnippets = [
  "Boolean(hostsFoodTrucks || wantsFoodTrucks)",
  "hostAddress",
  "hostBusinessName",
  "resolvedHostAddress",
  "resolvedHostBusinessName",
  "Use business address for parking-pass host profile",
  "isRestaurantHostCapable",
  "{ path: \"/parking-pass\", icon: ParkingSquare, label: \"Parking Pass\" }",
];

for (const snippet of requiredSnippets) {
  if (
    !adminRoutes.includes(snippet) &&
    !adminManagementRoutes.includes(snippet) &&
    !adminDashboard.includes(snippet) &&
    !navigation.includes(snippet)
  ) {
    throw new Error(`Missing required bar-host parking-pass snippet: ${snippet}`);
  }
}

if (!adminRoutes.includes("const shouldCreateHostProfile =")) {
  throw new Error("adminRoutes.ts must gate host profile creation for bar host capability");
}

if (!adminManagementRoutes.includes("const shouldCreateHostProfile =")) {
  throw new Error(
    "adminManagementRoutes.ts must gate host profile creation for bar host capability",
  );
}

console.log("bar-host-parking-pass-capability.contract: PASS");
