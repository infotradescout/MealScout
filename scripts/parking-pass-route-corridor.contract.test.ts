import { readFileSync } from "node:fs";

const routes = readFileSync("server/routes/publicMapRoutes.ts", "utf8");
const cache = readFileSync("server/utils/googleApiCache.ts", "utf8");
const parkingPass = readFileSync("client/src/pages/parking-pass.tsx", "utf8");
const mapPicker = readFileSync(
  "client/src/components/maps/GoogleMapPicker.tsx",
  "utf8",
);

const corridorStart = routes.indexOf('app.get("/api/map/route-corridor"');
const corridorEnd = routes.indexOf(
  'app.get("/api/map/place-autocomplete"',
  corridorStart,
);
if (corridorStart < 0 || corridorEnd <= corridorStart) {
  throw new Error("Route corridor endpoint is missing");
}
const corridorRoute = routes.slice(corridorStart, corridorEnd);

for (const snippet of [
  "routes.polyline.encodedPolyline",
  "decodeGooglePolyline",
  "locatePointAlongRoute",
  'getCached<any>("route_corridor"',
  "ROUTE_CORRIDOR_HOST_RADIUS_MILES",
  "ROUTE_CORRIDOR_MAX_HOSTS",
  "storage.getAllHosts()",
  "routeCorridorDiscovery",
  "searchAlongRouteParameters",
  "encodedPolyline: route.encodedPolyline",
  "routingSummaries",
  "addedDurationSeconds",
  "intermediate: waypoint",
  'textQuery: "gas station"',
  'textQuery: "propane supplier"',
  'textQuery: "restaurant supply store"',
  'textQuery: "commercial kitchen equipment repair"',
]) {
  if (!routes.includes(snippet)) {
    throw new Error("Route corridor server contract missing: " + snippet);
  }
}

if (!/setCached\(\s*"route_corridor"/.test(routes)) {
  throw new Error("Route corridor cache write is missing");
}

if (corridorRoute.includes("googleMapsApiKey:")) {
  throw new Error(
    "Route corridor response must never serialize a Google API key",
  );
}

if (!cache.includes('| "route_corridor"')) {
  throw new Error("Persistent Google API cache must support route corridors");
}

for (const snippet of [
  "/api/map/route-corridor",
  "Plan along your route",
  "Travel is a food truck’s advantage.",
  "Find stops on my route",
  "Your mobile service corridor",
  "Parking Pass hosts along the way",
  "Truck essentials by added time",
  "formatJourneyDetour",
  "routePath={journeyResult.route.path}",
]) {
  if (!parkingPass.includes(snippet)) {
    throw new Error("Route corridor UI contract missing: " + snippet);
  }
}

for (const snippet of [
  "routePath?: GeoPoint[]",
  "new g.maps.Polyline",
  "<Polyline",
  'strokeColor: "#ea580c"',
  "detachGoogleMarker(marker)",
  'typeof marker.setPosition === "function"',
  "marker.position = position",
]) {
  if (!mapPicker.includes(snippet)) {
    throw new Error("Route path renderer contract missing: " + snippet);
  }
}

console.log("Parking Pass route corridor contract OK");
