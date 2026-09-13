/** Import prices with explicit units. Unknown is distinct from a free item. */
export function parseImportPrice(
  value: unknown,
  unit: "dollars" | "cents",
): { valid: boolean; cents: number | null } {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { valid: true, cents: null };
  }
  if (typeof value !== "number" && typeof value !== "string") {
    return { valid: false, cents: null };
  }
  let text = String(value).trim();
  if (unit === "dollars") text = text.replace(/^\$\s*/, "");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) {
    return { valid: false, cents: null };
  }
  const [whole, fraction = ""] = text.replace(/,/g, "").split(".");
  if (unit === "cents" ? /[1-9]/.test(fraction) : fraction.length > 2) {
    return { valid: false, cents: null };
  }
  const cents = unit === "cents"
    ? Number(whole)
    : Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 2_147_483_647) {
    return { valid: false, cents: null };
  }
  return { valid: true, cents };
}
