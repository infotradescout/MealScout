import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMenuCsv } from "../server/utils/menuCsvParser";
import { parseImportPrice } from "../server/utils/importPrice";

test("CSV prices use declared units and retain category and unknown prices", async () => {
  const result = await parseMenuCsv(Buffer.from(
    'name,price,price_cents,category\nSmall,,450,Sauces\nWhole,600,,Meals\nUnknown,,,Meals\nFree,0,,Extras\nBoth,4.50,450,Extras\n'
  ), "menu", "business");
  assert.deepEqual(result.imported.map(i => [i.name, i.priceCents, i.categoryName]), [
    ["Small",450,"Sauces"], ["Whole",60000,"Meals"], ["Unknown",null,"Meals"],
    ["Free",0,"Extras"], ["Both",450,"Extras"],
  ]);
  assert.equal(result.errors.length, 0);
});

test("negative, fractional-cent, overflowing and conflicting prices are rejected", async () => {
  const result = await parseMenuCsv(Buffer.from(
    'name,price,price_cents\nNegative,-12.99,\nConflict,5,450\nFraction,,4.5\nOverflow,21474836.48,\nMalformed,1.2.3,\n'
  ), "menu", "business");
  assert.equal(result.imported.length, 0);
  assert.equal(result.errors.length, 5);
  for (const input of [-1, Infinity, NaN, "-0.01", "1e3", "12abc", true, "1.234"]) {
    assert.equal(parseImportPrice(input,"dollars").valid, false, String(input));
  }
});

test("supplier and AI import units preserve explicit zero versus unknown", () => {
  assert.deepEqual(parseImportPrice("12","dollars"), {valid:true,cents:1200});
  assert.deepEqual(parseImportPrice("1200.00","cents"), {valid:true,cents:1200});
  assert.deepEqual(parseImportPrice("$1,234.56","dollars"), {valid:true,cents:123456});
  for (const input of [null, undefined, "", " "]) {
    assert.deepEqual(parseImportPrice(input,"dollars"), {valid:true,cents:null});
  }
  assert.deepEqual(parseImportPrice(0,"dollars"), {valid:true,cents:0});
});
