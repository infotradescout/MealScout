import fs from "fs";
import path from "path";

const routePath = path.join(process.cwd(), "server", "routes", "publicDiscoveryRoutes.ts");
const source = fs.readFileSync(routePath, "utf8");

const requiredSnippets = [
  "const isTruckRestaurantRow = (row: any) =>",
  'entity === "truck"',
  "await resolveTruckRestaurantForPublicId(idHint)",
  "entity: \"truck\"",
  "const trucks = cityRestaurants.filter((row: any) => isTruckRestaurantRow(row));",
  "const restaurantsOnly = cityRestaurants.filter(",
  "(row: any) => !isTruckRestaurantRow(row),",
];

const missing = requiredSnippets.filter((snippet) => !source.includes(snippet));

if (missing.length > 0) {
  console.error("public-food-truck-discovery-menu.contract: FAIL");
  for (const snippet of missing) {
    console.error(`missing snippet: ${snippet}`);
  }
  process.exit(1);
}

console.log("public-food-truck-discovery-menu.contract: PASS");
