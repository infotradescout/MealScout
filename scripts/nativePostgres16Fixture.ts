import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Own a new loopback-only cluster. Never accept an existing data directory or URL.
export async function startNativePostgres16(binDirectory: string, password: string) {
  const binary = (name: string) => resolve(binDirectory, `${name}${process.platform === "win32" ? ".exe" : ""}`);
  for (const name of ["postgres", "initdb", "pg_ctl", "psql", "pg_dump", "pg_restore"]) {
    assert.ok(existsSync(binary(name)), `Native PostgreSQL binary missing: ${binary(name)}`);
    const version = spawnSync(binary(name), ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    assert.equal(version.status, 0, `Cannot execute ${name}: ${version.stderr}`);
    assert.match(version.stdout, /\(PostgreSQL\) 16\./, `Expected PostgreSQL 16 ${name}`);
  }
  const reservation = createServer();
  await new Promise<void>((done, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", done);
  });
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));

  const directory = mkdtempSync(join(tmpdir(), "mealscout-migration142-"));
  const data = join(directory, "data");
  const passwordFile = join(directory, "fixture-password");
  writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
  const env = { ...process.env };
  // Ambient libpq services/hostaddr can override CLI hosts. Keep every connection local.
  for (const key of Object.keys(env)) if (key.startsWith("PG")) delete env[key];
  Object.assign(env, { PGHOST: "127.0.0.1", PGPORT: String(port), PGUSER: "postgres", PGDATABASE: "postgres", PGPASSWORD: password, PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable" });
  const control = (args: string[]) => spawnSync(binary("pg_ctl"), ["-D", data, ...args], { env, encoding: "utf8", windowsHide: true, timeout: 45_000 });
  const init = spawnSync(binary("initdb"), ["-D", data, "-U", "postgres", "--auth=scram-sha-256", `--pwfile=${passwordFile}`, "--encoding=UTF8", "--no-locale"], { env, encoding: "utf8", windowsHide: true, timeout: 45_000 });
  assert.equal(init.status, 0, `Native initdb failed: ${init.stderr || init.error}`);
  const start = control(["-l", join(directory, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "-t", "30", "start"]);
  if (start.status !== 0) {
    control(["-m", "immediate", "-w", "stop"]);
    throw new Error(`Native PostgreSQL start failed: ${start.stderr || start.error}; logs: ${directory}`);
  }
  console.log(`migration142 fixture: native PostgreSQL 16, owned cluster ${directory}, loopback port ${port}`);
  const command = (program: string, args: string[], applicationName?: string) => {
    assert.ok(["psql", "pg_dump", "pg_restore"].includes(program), `Unsupported fixture command: ${program}`);
    assert.ok(!args.some(arg => /postgres(?:ql)?:\/\/|(?:host|service)=/i.test(arg)), "Fixture commands cannot override the owned connection");
    assert.ok(!args.some(arg => /^(?:-h|-p|--host(?:=|$)|--port(?:=|$))/.test(arg)), "Fixture host and port are owned by the runner");
    return { executable: binary(program), args: ["-h", "127.0.0.1", "-p", String(port), ...args], env: { ...env, PGAPPNAME: applicationName || "migration142-native" } };
  };
  return {
    directory,
    port,
    run(program: string, args: string[], input?: string, applicationName?: string) {
      const cmd = command(program, args, applicationName);
      return spawnSync(cmd.executable, cmd.args, { env: cmd.env, input, encoding: "utf8", windowsHide: true, maxBuffer: 20 * 1024 * 1024, timeout: 60_000 });
    },
    runAsync(program: string, args: string[], input: string, applicationName?: string) {
      const cmd = command(program, args, applicationName);
      return new Promise<{ status: number; stdout: string; stderr: string }>((done, reject) => {
        const child = spawn(cmd.executable, cmd.args, { env: cmd.env, windowsHide: true, shell: false, timeout: 60_000 });
        let stdout = "", stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => { stderr += chunk; });
        child.on("error", reject);
        child.stdin.on("error", reject);
        child.on("close", status => done({ status: status ?? 1, stdout, stderr }));
        child.stdin.end(input);
      });
    },
    stop() {
      const result = control(["-m", "fast", "-w", "-t", "30", "stop"]);
      assert.equal(result.status, 0, `Owned PostgreSQL cluster did not stop: ${result.stderr || result.error}; ${directory}`);
      console.log(`migration142 native cluster stopped; evidence retained at ${directory}`);
    },
  };
}
