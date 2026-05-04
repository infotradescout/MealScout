import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, "client", "src");

const excludedParts = [
  `${path.sep}components${path.sep}admin${path.sep}`,
  `${path.sep}pages${path.sep}admin`,
  `${path.sep}__tests__${path.sep}`,
];

const extensions = new Set([".ts", ".tsx"]);

const banned = [
  /Stripe payment may fail/i,
  /Stripe is not configured/i,
  /not configured for this environment/i,
  /Payment Setup Required/i,
  /Setup Failed/i,
  /Setup Error/i,
  /Setup Successful/i,
  /Request setup/i,
  /Referral credit still/i,
  /routes back to you/i,
  /Owner credit/i,
  /Ask an admin/i,
  /admin should/i,
  /complete account setup/i,
  /unlock login/i,
  /configured per host/i,
  /Free profile setup/i,
  /Start owner setup/i,
  /Setup checklist/i,
  /Setup path/i,
  /setup status/i,
  /Setup progress/i,
  /Push setup failed/i,
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

const matches = [];

for (const filePath of walk(sourceRoot)) {
  if (excludedParts.some((part) => filePath.includes(part))) continue;
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("{/*")
    ) {
      return;
    }

    for (const pattern of banned) {
      if (pattern.test(line)) {
        matches.push({
          filePath: path.relative(repoRoot, filePath),
          line: index + 1,
          pattern: pattern.source,
          text: line.trim(),
        });
      }
    }
  });
}

if (matches.length > 0) {
  console.error("Public copy audit found implementation-facing language:");
  for (const match of matches) {
    console.error(
      `- ${match.filePath}:${match.line} [${match.pattern}] ${match.text}`,
    );
  }
  process.exit(1);
}

console.log("Public copy audit passed.");
