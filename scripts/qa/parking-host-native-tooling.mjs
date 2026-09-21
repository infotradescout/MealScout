/** Prepare only the required contrib extensions in this executor's existing
 * owned PostgreSQL installation. No system package or hosted service changes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const sha = data => createHash('sha256').update(data).digest('hex');
export function prepareNativeExtensions({ root, out }) {
  assert.equal(process.env.MEALSCOUT_HOST_ROUTE_PROOF, '1');
  assert.equal(process.env.MEALSCOUT_HOST_ROUTE_RELEASE_CHECKS, '1');
  const bin = process.env.MEALSCOUT_NATIVE_PG_BIN;
  assert.ok(bin && path.isAbsolute(bin));
  const prefix = path.resolve(bin, '..'), cache = path.dirname(prefix);
  assert.equal(prefix, path.join(process.env.HOME, '.cache/mealscout-host-route-pg16.14/install'));
  const pgConfig = path.join(bin, 'pg_config');
  const config = flag => execFileSync(pgConfig, [flag], { encoding: 'utf8' }).trim();
  assert.equal(config('--version'), 'PostgreSQL 16.14');
  assert.equal(config('--bindir'), bin);
  const source = path.join(cache, 'postgresql-16.14');
  const archive = path.join(cache, 'source.tar.gz');
  const expected = 'ca18d43510bbb09a271383e1aa705b05b76bc8e9400f9857178ba8ec54cf461a';
  assert.equal(sha(fs.readFileSync(archive)), expected, 'Cached upstream archive checksum');
  const required = new Set();
  for (const filename of fs.readdirSync(path.join(root, 'migrations')).filter(p => /^\d.*\.sql$/.test(p))) {
    const sql = fs.readFileSync(path.join(root, 'migrations', filename), 'utf8');
    for (const match of sql.matchAll(/CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))/gi)) required.add(match[1] || match[2]);
  }
  const allowed = new Set(['pg_trgm', 'pgcrypto', 'btree_gin', 'btree_gist', 'citext', 'hstore', 'fuzzystrmatch', 'uuid-ossp']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|HOME|TMPDIR|TMP|TEMP|LANG|LC_ALL)$/.test(k)));
  const receipt = { postgres: '16.14', cachedArchiveSha256: expected, required: [...required].sort(), extensions: [] };
  for (const name of receipt.required) {
    assert.ok(allowed.has(name), 'Unsupported canonical extension prerequisite: ' + name);
    const control = path.join(config('--sharedir'), 'extension', name + '.control');
    const library = path.join(config('--pkglibdir'), name + '.so');
    const step = { name, built: false };
    if (!fs.existsSync(control) || !fs.existsSync(library)) {
      const directory = path.join(source, 'contrib', name);
      assert.ok(fs.existsSync(path.join(directory, 'Makefile')));
      console.log('HOST_NATIVE_EXTENSION_BUILD ' + name);
      const result = spawnSync('make', ['-C', directory, '-j2', 'install'], { cwd: root, env, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
      const output = (result.stdout || '') + (result.stderr || '');
      fs.writeFileSync(path.join(out, 'native-extension-' + name + '.log'), output);
      step.buildLogSha256 = sha(output); step.built = true;
      assert.equal(result.status, 0, 'Extension build failed: ' + name + '\n' + output.slice(-5000));
    }
    assert.ok(fs.existsSync(control) && fs.existsSync(library), 'Missing compiled extension: ' + name);
    step.controlSha256 = sha(fs.readFileSync(control)); step.librarySha256 = sha(fs.readFileSync(library));
    receipt.extensions.push(step);
  }
  console.log('HOST_NATIVE_EXTENSIONS_READY ' + JSON.stringify(receipt));
  return receipt;
}
