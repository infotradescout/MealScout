import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

export type FileHit = {
  file: string;
  line: number;
  text: string;
};

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|json)$/i.test(entry.name)) continue;
    files.push(full);
  }
  return files;
}

export function projectFiles(options?: { includeScripts?: boolean }): string[] {
  const roots = ["client/src", "server", "shared", ...(options?.includeScripts ? ["scripts"] : [])]
    .map((p) => path.join(repoRoot, p));
  return roots.flatMap((root) => walk(root));
}

export function findTokenHits(token: RegExp | string, files: string[]): FileHit[] {
  const pattern = typeof token === "string" ? new RegExp(token, "i") : token;
  const hits: FileHit[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        hits.push({
          file: path.relative(repoRoot, file).replace(/\\/g, "/"),
          line: index + 1,
          text: line.trim(),
        });
      }
    });
  }
  return hits;
}

export function assertNoDisallowedHits(label: string, hits: FileHit[]) {
  if (hits.length === 0) return;
  const preview = hits
    .slice(0, 20)
    .map((hit) => `${hit.file}:${hit.line} :: ${hit.text}`)
    .join("\n");
  throw new Error(`[${label}] found disallowed hits:\n${preview}`);
}

export function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}
