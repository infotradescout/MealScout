import fs from "node:fs";
import path from "node:path";

type FindingLevel = "high" | "medium" | "note";

type Finding = {
  level: FindingLevel;
  surface: string;
  location: string;
  detail: string;
};

type ServerSurface = {
  method: string;
  path: string;
  file: string;
  line: number;
  guard: string;
};

const root = process.cwd();
const appPath = path.join(root, "client", "src", "App.tsx");
const pagesRoot = path.join(root, "client", "src", "pages");
const serverRoot = path.join(root, "server");

const findings: Finding[] = [];
const serverSurfaces: ServerSurface[] = [];

const adminMountedRouterPrefixes: Record<string, string> = {
  "server/adminRoutes.ts": "/api/admin",
  "server/telemetryRoutes.ts": "/api/admin/telemetry",
  "server/evidenceExportRoutes.ts": "/api/admin",
  "server/incidentRoutes.ts": "/api/incidents",
};

const pathSepRegex = /\\/g;

function toRepoPath(filePath: string) {
  return path.relative(root, filePath).replace(pathSepRegex, "/");
}

function readText(filePath: string) {
  return fs.readFileSync(filePath, "utf8");
}

function walk(dir: string, predicate: (filePath: string) => boolean) {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath, predicate));
    } else if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function lineNumberForIndex(text: string, index: number) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function addFinding(
  level: FindingLevel,
  surface: string,
  location: string,
  detail: string,
) {
  findings.push({ level, surface, location, detail });
}

function extractRouteBlocks(text: string) {
  const routeRegex =
    /<Route\s+path="([^"]+)"[\s\S]*?(?:<\/Route>|\/>)/g;
  const blocks: Array<{ path: string; block: string; line: number }> = [];
  for (const match of text.matchAll(routeRegex)) {
    blocks.push({
      path: match[1],
      block: match[0],
      line: lineNumberForIndex(text, match.index ?? 0),
    });
  }
  return blocks;
}

function auditClientRoutes() {
  const appText = readText(appPath);
  const splitMarker = "        ) : (";
  const splitIndex = appText.indexOf(splitMarker);
  if (splitIndex < 0) {
    addFinding(
      "high",
      "client router",
      "client/src/App.tsx",
      "Could not locate the guest/authenticated route split.",
    );
    return { guestAdminRoutes: 0, authedAdminRoutes: 0 };
  }

  const guestText = appText.slice(0, splitIndex);
  const authedText = appText.slice(splitIndex);

  const guestAdminRoutes = extractRouteBlocks(guestText).filter((route) =>
    route.path.startsWith("/admin"),
  );
  for (const route of guestAdminRoutes) {
    if (!route.block.includes("AdminLogin")) {
      addFinding(
        "high",
        route.path,
        `client/src/App.tsx:${route.line}`,
        "Guest admin route does not render the admin login gate.",
      );
    }
  }

  const authedAdminRoutes = extractRouteBlocks(authedText).filter(
    (route) => route.path.startsWith("/admin") || route.path === "/staff",
  );
  for (const route of authedAdminRoutes) {
    const guarded =
      route.block.includes("adminOnlyRoute") ||
      route.block.includes("staffOrAdminRoute") ||
      route.block.includes("adminLandingRoute");
    if (!guarded) {
      addFinding(
        "high",
        route.path,
        `client/src/App.tsx:${route.line + lineNumberForIndex(appText, splitIndex) - 1}`,
        "Authenticated admin/staff route is not wrapped in a route-level role guard.",
      );
    }
  }

  return {
    guestAdminRoutes: guestAdminRoutes.length,
    authedAdminRoutes: authedAdminRoutes.length,
  };
}

function auditClientPages() {
  const adminPageFiles = walk(
    pagesRoot,
    (filePath) =>
      filePath.endsWith(".tsx") &&
      /(^|[\\/])(admin|staff)|Admin|Staff|admin-|staff-/i.test(
        toRepoPath(filePath),
      ),
  );

  for (const filePath of adminPageFiles) {
    const repoPath = toRepoPath(filePath);
    if (repoPath.endsWith("admin-login.tsx")) continue;
    const text = readText(filePath);
    const hasRoleAwareCode =
      /useAuth|userType|admin\/verify|Admin access|Staff or admin|isAdmin|isStaff/.test(
        text,
      );
    const hasAdminFetch = /\/api\/admin|\/api\/staff|\/api\/incidents/.test(
      text,
    );
    if (!hasRoleAwareCode && hasAdminFetch) {
      addFinding(
        "note",
        repoPath,
        repoPath,
        "Page relies on route/API protection without an obvious page-level role state.",
      );
    }
  }

  return adminPageFiles.length;
}

function firstRoutePath(block: string) {
  const match = block.match(/["'](\/api\/(?:admin|staff)[^"']*|\/[^"']*)["']/);
  return match?.[1] ?? null;
}

function normalizeFullServerPath(file: string, rawPath: string) {
  if (rawPath.startsWith("/api/admin") || rawPath.startsWith("/api/staff")) {
    return rawPath;
  }

  const prefix = adminMountedRouterPrefixes[file];
  if (!prefix) return null;
  if (rawPath.includes("/cron")) return null;
  return `${prefix}${rawPath === "/" ? "" : rawPath}`;
}

function classifyGuard(block: string, preHandler: string) {
  if (/isAdmin\b|requireAdminUser|assertAdmin|Admin access required/.test(block)) {
    return "admin";
  }
  if (/isLeadImportAuthorized|isStaffOrAdmin|staffOrAdmin|userType[^;\n]+staff/.test(block)) {
    return "staff_or_admin";
  }
  if (/isAuthenticated|req\.user|Unauthorized|userType/.test(block)) {
    return "authenticated_inline";
  }
  if (/x-cron-secret|CRON_SECRET|cronSecret|validateCron/i.test(block)) {
    return "cron_secret";
  }
  if (/isAdmin\b|isStaffOrAdmin|isLeadImportAuthorized|isAuthenticated/.test(preHandler)) {
    return "authenticated";
  }
  return "missing";
}

function auditServerSurfaces() {
  const serverFiles = walk(serverRoot, (filePath) => filePath.endsWith(".ts"));
  const routeStartRegex = /\b(app|router)\s*\.\s*(get|post|put|patch|delete)\s*\(/;

  for (const filePath of serverFiles) {
    const repoPath = toRepoPath(filePath);
    const lines = readText(filePath).split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const start = lines[i].match(routeStartRegex);
      if (!start) continue;

      const block = lines.slice(i, Math.min(i + 90, lines.length)).join("\n");
      const rawPath = firstRoutePath(block);
      if (!rawPath) continue;

      const fullPath = normalizeFullServerPath(repoPath, rawPath);
      if (!fullPath) continue;

      const method = start[2].toUpperCase();
      const preHandler = block.split(/\basync\b/)[0] || block;
      const guard = classifyGuard(block, preHandler);
      serverSurfaces.push({
        method,
        path: fullPath,
        file: repoPath,
        line: i + 1,
        guard,
      });

      if (guard === "missing") {
        addFinding(
          "high",
          `${method} ${fullPath}`,
          `${repoPath}:${i + 1}`,
          "Admin/staff API route has no obvious auth or role guard.",
        );
      }

      const mutates = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
      const staffMayWrite =
        mutates && guard === "staff_or_admin" && /isStaffOrAdmin/.test(block);
      const hasStaffWriteBoundary =
        /denyStaffEdits|requireAdminUser|Only admins|staff cannot|Staff cannot|req\.user\?\.userType === "staff"|isAdminUser/.test(
          block,
        );
      if (staffMayWrite && !hasStaffWriteBoundary) {
        addFinding(
          "medium",
          `${method} ${fullPath}`,
          `${repoPath}:${i + 1}`,
          "Mutating staff-or-admin route should be reviewed for whether staff write access is intentional.",
        );
      }
    }
  }

  return serverSurfaces.length;
}

function printFindingGroup(level: FindingLevel, title: string) {
  const group = findings.filter((finding) => finding.level === level);
  console.log(`\n${title}: ${group.length}`);
  for (const finding of group.slice(0, 40)) {
    console.log(
      `- ${finding.surface} (${finding.location}): ${finding.detail}`,
    );
  }
  if (group.length > 40) {
    console.log(`- ... ${group.length - 40} more`);
  }
}

function main() {
  console.log("ADMIN / STAFF SURFACE AUDIT");
  console.log("===========================");

  const clientRouteCounts = auditClientRoutes();
  const clientPageCount = auditClientPages();
  const serverSurfaceCount = auditServerSurfaces();

  const guardCounts = serverSurfaces.reduce<Record<string, number>>(
    (acc, surface) => {
      acc[surface.guard] = (acc[surface.guard] || 0) + 1;
      return acc;
    },
    {},
  );

  console.log("\nInventory");
  console.log(`- Guest admin routes: ${clientRouteCounts.guestAdminRoutes}`);
  console.log(
    `- Authenticated admin/staff routes: ${clientRouteCounts.authedAdminRoutes}`,
  );
  console.log(`- Admin/staff page files: ${clientPageCount}`);
  console.log(`- Admin/staff server endpoints: ${serverSurfaceCount}`);
  console.log(
    `- Server guard mix: ${Object.entries(guardCounts)
      .map(([guard, count]) => `${guard}=${count}`)
      .join(", ")}`,
  );

  printFindingGroup("high", "Blocking Findings");
  printFindingGroup("medium", "Review Findings");
  printFindingGroup("note", "Notes");

  const highCount = findings.filter((finding) => finding.level === "high")
    .length;
  if (highCount > 0) {
    console.error(
      `\nAudit failed: ${highCount} blocking admin/staff surface issue(s) found.`,
    );
    process.exit(1);
  }

  console.log("\nAudit passed: no blocking admin/staff surface drift found.");
}

main();
