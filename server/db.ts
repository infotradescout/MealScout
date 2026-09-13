import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzleNodePostgres } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import ws from "ws";
import * as schema from "@shared/schema";

const { Pool: NodePostgresPool } = pg;

neonConfig.webSocketConstructor = ws;

const useDisposableNodePostgres =
  process.env.MEALSCOUT_DISPOSABLE_POSTGRES === "1";
if (useDisposableNodePostgres) {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  const hostname = databaseUrl
    ? new URL(databaseUrl).hostname.toLowerCase()
    : "";
  if (
    process.env.NODE_ENV !== "test" ||
    !["127.0.0.1", "localhost", "::1"].includes(hostname)
  ) {
    throw new Error(
      "MEALSCOUT_DISPOSABLE_POSTGRES is restricted to a test-only local PostgreSQL fixture.",
    );
  }
}

// Allow development to boot without a DATABASE_URL; server will run in limited mode
if (!process.env.DATABASE_URL) {
  if (process.env.NODE_ENV === 'development') {
    console.warn("[DB] Warning: DATABASE_URL is not set. Running in limited dev mode without DB.");
  } else {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
}

export const pool: any = process.env.DATABASE_URL
  ? useDisposableNodePostgres
    ? new NodePostgresPool({ connectionString: process.env.DATABASE_URL })
    : new NeonPool({ connectionString: process.env.DATABASE_URL })
  : undefined;

// Some managed Postgres setups (or older DBs) can end up with a `search_path`
// that excludes `public`, which breaks unqualified table lookups (SQLSTATE 42P01)
// for tables that were created in `public`.
if (process.env.DATABASE_URL && pool) {
  pool.on("connect", (client: any) => {
    void client
      .query("show search_path")
      .then((result: any) => {
        const current = String(result?.rows?.[0]?.search_path || "").trim();
        if (!current) return;
        const tokens = current
          .split(",")
          .map((part) => part.trim().replace(/^"+|"+$/g, "").toLowerCase());
        if (tokens.includes("public")) return;
        const next = `${current}, public`;
        return client.query("select set_config('search_path', $1, false)", [next]);
      })
      .catch((error: any) => {
        console.warn("[DB] Failed to normalize search_path:", error?.message || error);
      });
  });
}
// Cast to any to keep query builder usable even when DATABASE_URL is absent in local dev.
// Runtime will still require a real connection string in production.
export const db = (process.env.DATABASE_URL
  ? useDisposableNodePostgres
    ? drizzleNodePostgres({ client: pool, schema })
    : drizzle({ client: pool as NeonPool, schema })
  : undefined) as any;
