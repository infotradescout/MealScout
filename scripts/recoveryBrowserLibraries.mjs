import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Download and extract missing WebKit libraries into the disposable build only.
// A private APT configuration prevents host hooks, status or cache mutations.
export async function prepareRecoveryBrowserLibraries(tooling, run) {
  const os = readFileSync("/etc/os-release", "utf8");
  assert.match(os, /^ID=debian$/m, "This library fixture is scoped to the observed Debian host");
  assert.match(os, /^VERSION_ID="12"$/m, "Use the observed Debian 12 browser ABI");
  const apt = join(tooling, "apt");
  const libraries = join(tooling, "browser-libraries");
  for (const directory of ["state/lists/partial", "cache/archives/partial", "log", "empty"]) {
    mkdirSync(join(apt, directory), { recursive: true });
  }
  mkdirSync(libraries, { recursive: true });
  // The resolver gets a snapshot, never the real package manager's writable state.
  const installedStatus = readFileSync("/var/lib/dpkg/status");
  writeFileSync(join(apt, "state/status"), installedStatus);
  writeFileSync(join(apt, "empty.conf"), "");
  writeFileSync(join(apt, "sources.list"), [
    "deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian bookworm main",
    "deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian bookworm-updates main",
    "deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://security.debian.org/debian-security bookworm-security main",
    "",
  ].join("\n"));
  const config = join(apt, "apt.conf");
  writeFileSync(config, [
    `Dir::Etc::parts "${join(apt, "empty")}";`,
    `Dir::Etc::main "${join(apt, "empty.conf")}";`,
    `Dir::Etc::sourcelist "${join(apt, "sources.list")}";`,
    `Dir::Etc::sourceparts "${join(apt, "empty")}";`,
    `Dir::State "${join(apt, "state")}";`,
    `Dir::State::status "${join(apt, "state/status")}";`,
    `Dir::Cache "${join(apt, "cache")}";`,
    `Dir::Log "${join(apt, "log")}";`,
    'Acquire::Languages "none";',
    'APT::Install-Recommends "false";',
    'APT::Install-Suggests "false";',
    "",
  ].join("\n"));
  const aptEnv = { APT_CONFIG: config };
  await run("browser-library-index", "apt-get", ["--error-on=any", "update"], aptEnv, apt);
  const packages = ["libgtk-4-1", "libgraphene-1.0-0", "libgstreamer-gl1.0-0", "libgstreamer-plugins-bad1.0-0", "libenchant-2-2", "libsecret-1-0", "libmanette-0.2-0", "libgles2"];
  await run("browser-library-download-only", "apt-get", ["--download-only", "--no-install-recommends", "--no-upgrade", "--assume-yes", "install", ...packages], aptEnv, apt);
  const archives = join(apt, "cache/archives");
  const downloaded = readdirSync(archives).filter(name => name.endsWith(".deb"));
  for (const name of downloaded) {
    await run(`browser-library-extract:${name}`, "dpkg-deb", ["--extract", join(archives, name), libraries]);
  }
  assert.deepEqual(readFileSync("/var/lib/dpkg/status"), installedStatus, "System package state must remain unchanged");
  return {
    packages,
    downloaded,
    systemPackageInstall: false,
    env: {
      LD_LIBRARY_PATH: [join(libraries, "usr/lib/x86_64-linux-gnu"), join(libraries, "lib/x86_64-linux-gnu"), join(libraries, "usr/lib")].join(":"),
      GIO_EXTRA_MODULES: join(libraries, "usr/lib/x86_64-linux-gnu/gio/modules"),
      GST_PLUGIN_PATH: join(libraries, "usr/lib/x86_64-linux-gnu/gstreamer-1.0"),
      XDG_DATA_DIRS: `${join(libraries, "usr/share")}:/usr/local/share:/usr/share`,
    },
  };
}
