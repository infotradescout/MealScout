/** Isolated layout regression checks using the actual component classes.
 * Does not simulate Stripe, Radix focus management, authenticated data or E2E.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const postcss = require("postcss");
const tailwind = require("tailwindcss");
const { chromium } = require(process.env.UI_PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const componentPaths = [
  "client/src/components/ui/modal-styles.ts",
  "client/src/components/ui/dialog.tsx",
  "client/src/components/ui/alert-dialog.tsx",
  "client/src/components/public-ordering/PublicOrderingTopBar.tsx",
];
const componentSource = componentPaths.map(read).join("\n");
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(read(componentPaths[0]), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module: mod, exports: mod.exports });
const styles = mod.exports;

function classes(file, tag) {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const results = [];
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === tag) {
      const attr = node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(ast) === "className");
      if (attr?.initializer && ts.isStringLiteral(attr.initializer)) results.push(attr.initializer.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return results;
}

const barPath = componentPaths[3];
const headerClasses = classes(barPath, "header")[0];
const headerInnerClasses = classes(barPath, "div")[0];
const navClasses = classes(barPath, "nav")[0];
const [brandClasses, secondaryClasses, scoutClasses] = classes(barPath, "Link");
const closeClasses = classes(componentPaths[1], "DialogPrimitive.Close")[0];
assert.ok(headerClasses && closeClasses && secondaryClasses, "Read real component class names");
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

const fixture = `
<div id="root">
  <header class="${escape(headerClasses)}">
    <div class="${escape(headerInnerClasses)}">
      <a id="brand" href="/" class="${escape(brandClasses)}">MealScout</a>
      <nav aria-label="Ordering navigation" class="${escape(navClasses)}">
        <a id="return-link" href="/menu/fixture" class="${escape(secondaryClasses)}">Return to menu</a>
        <a id="scout-link" href="/scout" class="${escape(scoutClasses)}">Scout</a>
      </nav>
    </div>
  </header>
  <div id="legacy-card" class="p-6 px-6 rounded-xl">
    <img id="food-image" class="h-12 w-20 object-cover" alt="Test food image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E">
    <button id="map-control" class="h-6 w-6" type="button">+</button>
    <input id="range-control" type="range" class="h-6 w-20">
    <textarea id="dense-field" class="h-10">Notes</textarea>
    <table><tbody><tr><td id="dense-cell" class="p-1">Data</td></tr></tbody></table>
  </div>
  <div id="motion-probe" style="transition-duration:1s">Motion</div>
</div>`;

const variables = `
:root { --action-primary:#ff4d2e; --border-subtle:rgba(15,23,42,.12); --border-strong:rgba(15,23,42,.18); --bg-popup:#fff; --bg-surface:#fff; --bg-surface-muted:#f5f2ec; --text-primary:#0a0a0a; --text-secondary:#1f2937; --text-muted:#6b7280; --profile-border:#ead7c7; --profile-ink:#2b160d; --profile-ink-soft:#5f4435; }
.theme-night { --bg-popup:#1c1a18; --bg-surface:#171513; --text-primary:#fff; --text-secondary:#e2e8f0; --text-muted:#e5e7eb; }
body { margin:0; }`;

(async () => {
  const tailwindVersion = require("tailwindcss/package.json").version;
  const extraClasses = "p-4 text-sm space-y-3 border h-11 px-4 fixed inset-x-0 top-0 z-[1100] text-xl font-bold flex min-w-0 flex-col space-y-1.5 break-words pr-12 text-left";
  let compiled;
  if (Number(tailwindVersion.split(".")[0]) < 4) {
    compiled = await postcss([tailwind({
      content: [{ raw: componentSource + fixture + extraClasses, extension: "tsx" }],
      theme: { extend: {} },
      plugins: [],
    })]).process("@tailwind base;@tailwind components;@tailwind utilities;", { from: undefined });
  } else {
    // Offline environments may supply a different compiler than the repo.
    // Report its version: these remain isolated geometry checks, not build proof.
    const candidates = new Set(extraClasses.split(/\s+/));
    for (const file of componentPaths) {
      const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (ts.isStringLiteral(node)) node.text.split(/\s+/).forEach((item) => candidates.add(item));
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
    for (const match of fixture.matchAll(/class="([^"]*)"/g)) {
      match[1].split(/\s+/).forEach((item) => candidates.add(item));
    }
    const packageRoot = path.dirname(require.resolve("tailwindcss/package.json"));
    const compiler = await tailwind.compile(
      fs.readFileSync(path.join(packageRoot, "theme.css"), "utf8") +
      fs.readFileSync(path.join(packageRoot, "preflight.css"), "utf8") +
      "\n@tailwind utilities;",
    );
    compiled = { css: compiler.build([...candidates]) };
  }
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.UI_CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox"],
  });
  const results = [];
  try {
    for (const [width, height] of [[320, 568], [390, 844], [640, 360], [844, 390], [768, 1024], [1440, 900]]) {
      for (const theme of ["theme-day", "theme-night"]) {
        const page = await browser.newPage({ viewport: { width, height } });
        // No external app, payment, media or analytics requests are allowed.
        await page.route("**/*", (route) => route.abort());
        await page.setContent(`<html class="${theme}"><head><style>${compiled.css}${variables}</style></head><body>${fixture}</body></html>`);
        const snapshot = () => page.evaluate(() => Object.fromEntries(
          ["legacy-card", "food-image", "map-control", "range-control", "dense-field", "dense-cell"].map((id) => {
            const s = getComputedStyle(document.getElementById(id));
            return [id, [s.width, s.height, s.paddingTop, s.paddingLeft, s.borderRadius, s.fontSize]];
          }),
        ));
        const before = await snapshot();
        await page.addStyleTag({ content: read("client/src/ui-refinement.css") });
        assert.deepEqual(await snapshot(), before, `${width}/${theme}: preserve existing component geometry`);
        for (const id of ["brand", "return-link", "scout-link"]) {
          const rect = await page.locator(`#${id}`).boundingBox();
          assert.ok(rect && rect.height >= 44 && rect.x >= 0 && rect.x + rect.width <= width + 1, `${id} must stay reachable at ${width}`);
        }
        const dialogHTML = `
          <nav id="app-nav" class="fixed inset-x-0 top-0 z-[1100]">App navigation</nav>
          <div id="overlay" class="${escape(styles.modalOverlayClasses)}"></div>
          <section id="dialog" role="dialog" aria-modal="true" aria-labelledby="title" class="${escape(styles.modalContentClasses)}">
            <div class="flex min-w-0 flex-col space-y-1.5 break-words pr-12 text-left">
              <h2 id="title" class="text-xl font-bold">Review your booking and selected parking slots</h2>
              <p>Confirm the host, date and payment total before continuing.</p>
            </div>
            ${Array.from({ length: 12 }, (_, i) => `<p class="p-4 text-sm border">Review detail ${i + 1}: date, time, location, credits and cancellation terms.</p>`).join("")}
            <div class="${escape(styles.modalFooterClasses)}">
              <button id="cancel" class="h-11 px-4" type="button">Cancel checkout</button>
              <button id="continue" class="h-11 px-4" type="button">Continue to payment</button>
            </div>
            <button id="close" class="${escape(closeClasses)}" type="button" aria-label="Close">×</button>
          </section>`;
        await page.evaluate((html) => document.body.insertAdjacentHTML("beforeend", html), dialogHTML);
        const rect = await page.locator("#dialog").boundingBox();
        assert.ok(rect.x >= 15 && rect.y >= 15 && rect.x + rect.width <= width - 15 && rect.y + rect.height <= height - 15, `Dialog must fit ${width}x${height}`);
        const layer = await page.evaluate(() => ["app-nav", "overlay", "dialog"].map((id) => Number(getComputedStyle(document.getElementById(id)).zIndex)));
        assert.ok(layer[1] > layer[0] && layer[2] === layer[1], "Modal portal must cover navigation and allow nested overlays");
        const close = await page.locator("#close").boundingBox();
        assert.ok(close.width >= 44 && close.height >= 44, "Close target must be at least 44px");
        assert.ok(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest("#dialog") !== null));
        await page.locator("#dialog").evaluate((el) => { el.scrollTop = el.scrollHeight; });
        for (const id of ["cancel", "continue"]) {
          const button = await page.locator(`#${id}`).boundingBox();
          assert.ok(button.y >= rect.y && button.y + button.height <= rect.y + rect.height + 1, `Action ${id} must be reachable after scroll`);
        }
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.ok(await page.locator("#motion-probe").evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration) <= 0.001));
        if (process.env.UI_SCREENSHOT_DIR && width === 390) {
          fs.mkdirSync(process.env.UI_SCREENSHOT_DIR, { recursive: true });
          await page.locator("#dialog").evaluate((el) => { el.scrollTop = 0; });
          await page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, `modal-${theme}.png`) });
        }
        results.push({ width, height, theme, status: "pass" });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ browser: "Chromium", tailwindVersion, scope: "isolated component CSS and native geometry; no live flows", scenarios: results }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
