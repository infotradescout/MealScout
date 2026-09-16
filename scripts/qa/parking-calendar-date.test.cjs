/** Executes the actual initial-date resolver with real date-fns. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { parseISO, format } = require('date-fns');
const file = path.resolve(__dirname, '../../client/src/components/parking-schedule-calendar.tsx');
const source = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length, 0);
const declaration = ast.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'resolveScheduleInitialDate');
assert.ok(declaration);
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { module: mod, exports: mod.exports, Date, parseISO, format });
const resolve = mod.exports.resolveScheduleInitialDate;
const today = new Date(2026, 8, 16, 12);
for (const value of ['2026-10-18', '2028-02-29']) {
  const date = resolve(value, today); assert.equal(format(date, 'yyyy-MM-dd'), value); assert.equal(date.getHours(), 0);
}
for (const value of [undefined, '', '2026-02-29', '2026-13-01', '2026-00-01', '2026-09-31', '2026-10-18T00:00:00Z', 'not-a-date']) {
  assert.equal(resolve(value, today), today, 'Invalid date must not crash or invent a day: ' + value);
}
assert.ok(source.includes('aria-pressed={isActive}'));
assert.ok(source.includes('aria-label={format(day, "EEEE, MMMM d, yyyy")}'));
console.log('PASS 10 Parking Schedule initial-date cases plus accessible day-selection wiring.');
