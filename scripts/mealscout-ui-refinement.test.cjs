/** Targeted checks, not a substitute for the app typecheck or real checkout E2E. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const postcss = require("postcss");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

// Include the restored payment modal when running in a complete checkout.
// --slice is explicit for an offline source slice; never silently skip files.
const files = [
  "client/src/components/payment-browser-gate.tsx",
  "client/src/components/public-ordering/PublicOrderingTopBar.tsx",
  "client/src/components/ui/modal-styles.ts",
  "client/src/components/ui/dialog.tsx",
  "client/src/components/ui/alert-dialog.tsx",
  "client/src/lib/paymentLinkCopy.ts",
];
if (!process.argv.includes("--slice")) {
  files.push("client/src/components/booking-payment-modal.tsx");
}
for (const file of files) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  assert.equal(source.parseDiagnostics.length, 0, `${file} must parse completely`);
}
// Protect against the exact class of failure seen in the previous branch edit.
assert.ok(ts.createSourceFile("broken.tsx", 'export const Modal = () => <section><input className="x"', ts.ScriptTarget.Latest, true).parseDiagnostics.length > 0);

const css = postcss.parse(read("client/src/ui-refinement.css"));
css.walkRules((rule) => {
  assert.ok(!/#root\s+/.test(rule.selector), `Unscoped app override: ${rule.selector}`);
  assert.ok(!/\.p-6|\.px-6|\.rounded-(?:md|lg|xl|2xl)/.test(rule.selector), `Utility override: ${rule.selector}`);
});

const modalStyles = read("client/src/components/ui/modal-styles.ts");
assert.equal((modalStyles.match(/z-\[1200\]/g) || []).length, 2);
assert.ok(modalStyles.includes("100vh-2rem") && modalStyles.includes("100dvh-2rem"));
for (const name of ["dialog", "alert-dialog"]) {
  const source = read(`client/src/components/ui/${name}.tsx`);
  assert.ok(source.includes('from "./modal-styles"'));
  assert.ok(source.includes("...props"), "Caller handlers must remain forwarded");
}
const gate = read("client/src/components/payment-browser-gate.tsx");
assert.ok(gate.includes("allowContinueAnyway && onContinueAnyway"));
assert.ok(gate.includes('role="status"') && gate.includes('copyState === "manual"'));
assert.ok(gate.includes("attempt === copyAttemptRef.current"));
const topBar = read("client/src/components/public-ordering/PublicOrderingTopBar.tsx");
assert.ok(!topBar.includes("hidden"), "Return link must not disappear on mobile");
assert.ok(topBar.includes('href={secondaryHref}') && topBar.includes('href="/scout"'));

const compiled = ts.transpileModule(read("client/src/lib/paymentLinkCopy.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(compiled, { exports: moduleObject.exports, module: moduleObject });
const { copyPaymentLink } = moduleObject.exports;

(async () => {
  const url = "https://mealscout.us/checkout/truck?ref=sample&return=%2Fmenu%2Ftruck#payment";
  let copiedValue;
  assert.equal(await copyPaymentLink(url, { writeText: async (value) => { copiedValue = value; } }), "copied");
  assert.equal(copiedValue, url, "Keep the full destination and attribution");
  assert.equal(await copyPaymentLink(url), "manual");
  assert.equal(await copyPaymentLink(url, null), "manual");
  assert.equal(await copyPaymentLink(url, {}), "manual");
  assert.equal(await copyPaymentLink(url, { writeText: async () => { throw new Error("denied"); } }), "manual");
  assert.equal(await copyPaymentLink(url, { writeText: () => { throw new Error("blocked"); } }), "manual");
  let called = false;
  assert.equal(await copyPaymentLink("", { writeText: async () => { called = true; } }), "manual");
  assert.equal(called, false, "Do not copy an empty destination");
  const boundClipboard = { allowed: true, async writeText() { assert.ok(this.allowed); } };
  assert.equal(await copyPaymentLink(url, boundClipboard), "copied", "Preserve clipboard method binding");
  console.log(`PASS: ${files.length} source syntax checks, CSS/export guards, and 8 clipboard cases (${process.argv.includes("--slice") ? "offline slice" : "complete checkout"}).`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
