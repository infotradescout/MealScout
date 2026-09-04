import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { eq, is, SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import * as schema from "../shared/schema";
import { lisaClaims, menus } from "../shared/schema";
import { createMenuWithLisaRecord, MenuCreationError } from "../server/services/menuCreation";

// Always creates a fresh in-memory PostgreSQL instance. No environment variable,
// connection string, existing database, production fixture, or provider is used.
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
function createModelTable(table: PgTable) {
  const config = getTableConfig(table);
  const dialect = new PgDialect();
  const columns = config.columns.map((column) => {
    let definition = `${quote(column.name)} ${column.getSQLType()}`;
    if (column.primary) definition += " PRIMARY KEY";
    if (column.notNull) definition += " NOT NULL";
    if (column.default !== undefined) {
      const value = column.default;
      definition += " DEFAULT " + (is(value, SQL) ? dialect.sqlToQuery(value).sql
        : typeof value === "string" ? `'${value.replaceAll("'", "''")}'` : String(value));
    }
    return definition;
  });
  if (table === menus) columns.push('FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE');
  return `CREATE TABLE ${quote(config.name)} (${columns.join(", ")})`;
}

for (const claimLayout of ["migration-009-uuid", "current-model-varchar"] as const) {
  test(`menu creation: ${claimLayout}`, async (suite) => {
    const pg = new PGlite();
    const database = drizzle(pg, { schema });
    const actor = { id: randomUUID(), userType: "restaurant_owner" };
    const outsider = { id: randomUUID(), userType: "restaurant_owner" };
    const restaurantId = randomUUID();
    const input = { restaurantId, name: "Owner's Café — Lunch", serviceType: "lunch" };
    const create = (key: string, body: unknown = input, who = actor) => createMenuWithLisaRecord(database, who, body, key);
    const count = async (table: "menus" | "lisa_claim", key: string) => {
      const result = await pg.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table} WHERE id = $1`, [key]);
      return result.rows[0].count;
    };
    const expectCode = async (promise: Promise<unknown>, status: number, code: string) => assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof MenuCreationError);
      assert.equal(error.statusCode, status);
      assert.equal(error.code, code);
      return true;
    });
    try {
      await pg.exec('CREATE TABLE restaurants (id varchar PRIMARY KEY, owner_id varchar NOT NULL)');
      await pg.exec(createModelTable(menus));
      await pg.exec(claimLayout === "migration-009-uuid"
        ? readFileSync(new URL("../migrations/009_lisa_claim_table.sql", import.meta.url), "utf8")
        : createModelTable(lisaClaims));
      await pg.query("INSERT INTO restaurants (id, owner_id) VALUES ($1, $2)", [restaurantId, actor.id]);

      await suite.test("reproduces the old writer's silent evidence loss", async () => {
        const [menu] = await database.insert(menus).values(input).returning();
        let caught: any;
        try {
          await database.insert(lisaClaims).values({
            app: "mealscout", claimType: "menu_published", source: "menu",
            subjectType: "menu", subjectId: menu.id, actorType: "user", actorId: actor.id,
            payload: { restaurantId, menuName: menu.name },
          } as any);
        } catch (error) { caught = error; }
        assert.equal(caught?.cause?.code ?? caught?.code, "23502");
        assert.match(String(caught?.cause?.message ?? caught?.message), /claim_value/);
        assert.equal(await count("menus", menu.id), 1);
        const claims = await pg.query("SELECT id FROM lisa_claim WHERE subject_id = $1", [menu.id]);
        assert.equal(claims.rows.length, 0);
        await database.delete(menus).where(eq(menus.id, menu.id));
      });

      await suite.test("persists accurate attributed creation with no invented publication or sharing", async () => {
        const key = randomUUID();
        const result = await create(key);
        assert.equal(result.menu.id, key);
        assert.equal(result.replayed, false);
        assert.deepEqual(result.lisaRecord, { id: key, status: "recorded" });
        const [claim] = await database.select().from(lisaClaims).where(eq(lisaClaims.id, key));
        assert.equal(claim.app, "mealscout");
        assert.equal(claim.actorId, actor.id);
        assert.equal(claim.actorType, "user");
        assert.equal(claim.subjectId, key);
        assert.equal(claim.subjectType, "menu");
        assert.equal(claim.claimType, "menu_created");
        assert.equal(claim.source, schema.LISA_CLAIM_SOURCES.MENU);
        const value = claim.claimValue as Record<string, unknown>;
        assert.deepEqual(Object.keys(value).sort(), ["isActive", "menuCreatedAt", "menuName", "requestFingerprint", "restaurantId", "schemaVersion", "serviceType"]);
        assert.equal(value.menuName, input.name);
        assert.equal(value.restaurantId, restaurantId);
        assert.equal(value.menuCreatedAt, result.menu.createdAt?.toISOString());
        assert.equal(claim.createdAt?.toISOString(), result.menu.createdAt?.toISOString());
      });

      await suite.test("lost-response replay returns one pair; different content is rejected", async () => {
        const key = randomUUID();
        await create(key);
        const replay = await create(key.toUpperCase(), { serviceType: input.serviceType, name: input.name, restaurantId });
        assert.equal(replay.replayed, true);
        await expectCode(create(key, { ...input, name: "Different" }), 409, "menu_request_reused");
        assert.equal(await count("menus", key), 1);
        assert.equal(await count("lisa_claim", key), 1);
      });

      await suite.test("overlapping calls with the same identity produce one pair", async () => {
        const key = randomUUID();
        const results = await Promise.all(Array.from({ length: 8 }, () => create(key)));
        assert.equal(results.filter((result) => !result.replayed).length, 1);
        assert.equal(await count("menus", key), 1);
        assert.equal(await count("lisa_claim", key), 1);
      });

      await suite.test("a recording failure rolls back the menu; the same request recovers", async () => {
        const key = randomUUID();
        await pg.exec(`CREATE FUNCTION reject_menu_observation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected private database detail'; END $$;
          CREATE TRIGGER reject_menu_observation BEFORE INSERT ON lisa_claim FOR EACH ROW EXECUTE FUNCTION reject_menu_observation();`);
        try {
          await expectCode(create(key), 503, "menu_creation_unconfirmed");
          assert.equal(await count("menus", key), 0);
          assert.equal(await count("lisa_claim", key), 0);
        } finally {
          await pg.exec("DROP TRIGGER reject_menu_observation ON lisa_claim; DROP FUNCTION reject_menu_observation();");
        }
        await create(key);
        assert.equal(await count("menus", key), 1);
        assert.equal(await count("lisa_claim", key), 1);
      });

      await suite.test("an uncertain commit acknowledgment is resolved without a duplicate", async () => {
        const key = randomUUID();
        const lostAck = { transaction: async (callback: any) => {
          await database.transaction(callback);
          throw new Error("simulated response lost after COMMIT");
        } } as unknown as typeof database;
        await expectCode(createMenuWithLisaRecord(lostAck, actor, input, key), 503, "menu_creation_unconfirmed");
        assert.equal((await create(key)).replayed, true);
        assert.equal(await count("menus", key), 1);
        assert.equal(await count("lisa_claim", key), 1);
      });

      await suite.test("authorization is rechecked for new work and receipt replay", async () => {
        const key = randomUUID();
        await expectCode(create(key, input, outsider), 403, "menu_access_denied");
        await expectCode(create(key, input, { ...actor, userType: "customer" }), 403, "menu_access_denied");
        await create(key);
        await pg.query("UPDATE restaurants SET owner_id = $1 WHERE id = $2", [outsider.id, restaurantId]);
        try {
          await expectCode(create(key), 403, "menu_access_denied");
          await expectCode(create(key, input, outsider), 409, "menu_request_reused");
        } finally {
          await pg.query("UPDATE restaurants SET owner_id = $1 WHERE id = $2", [actor.id, restaurantId]);
        }
      });

      await suite.test("retry never resurrects a deliberately deleted menu", async () => {
        const key = randomUUID();
        await create(key);
        await database.delete(menus).where(eq(menus.id, key));
        await expectCode(create(key), 409, "menu_creation_no_longer_available");
        assert.equal(await count("menus", key), 0);
        assert.equal(await count("lisa_claim", key), 1);
      });

      await suite.test("distinct requests may create intentionally identical menus", async () => {
        const first = await create(randomUUID());
        const second = await create(randomUUID());
        assert.notEqual(first.menu.id, second.menu.id);
        assert.equal(first.menu.name, second.menu.name);
      });

      await suite.test("missing or invalid nonce fails without writing anything", async () => {
        const before = await pg.query("SELECT id FROM menus");
        for (const key of [undefined, "", "not-a-uuid", [randomUUID()]]) {
          await expectCode(createMenuWithLisaRecord(database, actor, input, key), 400, "invalid_menu_creation");
        }
        assert.deepEqual((await pg.query("SELECT id FROM menus")).rows, before.rows);
      });
    } finally {
      await pg.close();
    }
  });
}
