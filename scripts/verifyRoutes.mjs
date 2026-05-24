import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const mustRead = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const appTsx = mustRead("client/src/App.tsx");
const publicRoutes = mustRead("server/routes/publicDiscoveryRoutes.ts");

const checks = [
  {
    label: "Public profile route exists",
    ok:
      appTsx.includes('path="/p/:profileType/:profileId"') &&
      appTsx.includes('path="/p/:profileType/:profileId/:profileSlug"'),
  },
  {
    label: "Legacy public detail routes exist",
    ok:
      appTsx.includes('path="/restaurant/:id"') &&
      appTsx.includes('path="/truck/:slug"') &&
      appTsx.includes('path="/bar/:slug"') &&
      appTsx.includes('path="/location/:slug"'),
  },
  {
    label: "Public resolver endpoint exists",
    ok: publicRoutes.includes('"/api/public/resolve/:entity/:slug"'),
  },
  {
    label: "Public profile endpoint exists",
    ok: publicRoutes.includes('"/api/public/profiles/:entity/:id"'),
  },
];

const failed = checks.filter((check) => !check.ok);
if (failed.length > 0) {
  console.error("verify:routes failed");
  for (const check of failed) {
    console.error(`- ${check.label}`);
  }
  process.exit(1);
}

console.log("verify:routes passed");
