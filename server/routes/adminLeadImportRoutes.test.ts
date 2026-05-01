import { beforeAll, describe, expect, it } from "vitest";

let helpers: typeof import("./adminLeadImportRoutes");

beforeAll(async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  helpers = await import("./adminLeadImportRoutes");
  process.env.NODE_ENV = previousNodeEnv;
});

describe("admin lead import helpers", () => {
  it("normalizes host location keys for duplicate detection", () => {
    expect(helpers.normalizeLocationValue("  123   MAIN St  ")).toBe("123 main st");
    expect(helpers.buildLocationKey("  123   MAIN St  ", " Fort   Worth ", " TX ")).toBe(
      "123 main st|fort worth|tx",
    );
  });

  it("recognizes privileged user types that lead import cannot create or reuse", () => {
    expect(helpers.isPrivilegedLeadImportUserType("staff")).toBe(true);
    expect(helpers.isPrivilegedLeadImportUserType("admin")).toBe(true);
    expect(helpers.isPrivilegedLeadImportUserType("super_admin")).toBe(true);
    expect(helpers.isPrivilegedLeadImportUserType("host")).toBe(false);
    expect(helpers.isPrivilegedLeadImportUserType("restaurant_owner")).toBe(false);
  });

  it("parses imported menu prices as cents", () => {
    expect(helpers.parsePriceCents({ priceCents: 1299 } as any)).toBe(1299);
    expect(helpers.parsePriceCents({ price: "$12.50" } as any)).toBe(1250);
    expect(helpers.parsePriceCents({ price: 8 } as any)).toBe(800);
    expect(helpers.parsePriceCents({ price: "market price" } as any)).toBe(0);
  });
});
