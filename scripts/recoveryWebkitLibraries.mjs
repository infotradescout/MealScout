import assert from "node:assert/strict";
import { lstatSync, readdirSync, realpathSync, statSync, symlinkSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

// WebKit's bundled MiniBrowser wrapper replaces LD_LIBRARY_PATH with its own
// lib directories. Fill only missing names there, using our extracted libraries.
// Browser launchers, existing bundled libraries and system files stay untouched.
export function linkRecoveryWebkitLibraries(tooling, browsers, libraryDirectories) {
  const owned = realpathSync(tooling);
  const requireOwned = path => {
    const resolved = realpathSync(path);
    const remainder = relative(owned, resolved);
    assert.ok(remainder && remainder !== ".." && !remainder.startsWith("../") && !isAbsolute(remainder), `Library path must remain inside owned tooling: ${path}`);
    return resolved;
  };
  const browserRoot = requireOwned(browsers);
  const webkitNames = readdirSync(browserRoot).filter(name => /^webkit-\d+$/.test(name));
  assert.equal(webkitNames.length, 1, "Fresh tooling must contain exactly one WebKit revision");
  const sources = new Map();
  for (const directory of libraryDirectories) {
    let entries;
    try { entries = readdirSync(directory); } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    requireOwned(directory);
    for (const name of entries.filter(name => /\.so(?:\.|$)/.test(name))) {
      const source = requireOwned(join(directory, name));
      assert.ok(statSync(source).isFile(), `Expected an extracted library: ${name}`);
      if (!sources.has(name)) sources.set(name, source);
    }
  }
  assert.ok(sources.size > 0, "Extracted browser libraries are required");
  const linked = {};
  for (const bundle of ["minibrowser-gtk", "minibrowser-wpe"]) {
    const destination = requireOwned(join(browserRoot, webkitNames[0], bundle, "lib"));
    linked[bundle] = 0;
    for (const [name, source] of sources) {
      const target = join(destination, name);
      try { lstatSync(target); continue; } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      symlinkSync(source, target);
      linked[bundle]++;
    }
  }
  return { revision: webkitNames[0], linked, existingLibrariesReplaced: 0 };
}
