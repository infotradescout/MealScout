import { sql } from "drizzle-orm";
import { db } from "../db";

async function isSentimentSchemaReady() {
  const result = await db.execute(sql`
    select to_regclass('public.sentiment_signal_events')::text as table_name
  `);
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return Boolean(row?.table_name);
}

export async function ensureSentimentSchema() {
  if (!db) return;

  try {
    if (!(await isSentimentSchemaReady())) {
      console.warn("[sentiment-schema] missing; creating sentiment signal table");
    }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sentiment_signal_events (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        user_id varchar REFERENCES users(id) ON DELETE SET NULL,
        source varchar(24) NOT NULL,
        score_100 integer NOT NULL,
        previous_score_100 integer,
        delta_score_100 integer,
        menu_item_name varchar(140),
        cuisine_type varchar(120),
        city varchar(120),
        state varchar(80),
        created_at timestamp DEFAULT now()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "IDX_sentiment_signal_events_created"
      ON sentiment_signal_events (created_at DESC)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "IDX_sentiment_signal_events_restaurant_created"
      ON sentiment_signal_events (restaurant_id, created_at DESC)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "IDX_sentiment_signal_events_source_created"
      ON sentiment_signal_events (source, created_at DESC)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "IDX_sentiment_signal_events_city_created"
      ON sentiment_signal_events (city, created_at DESC)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "IDX_sentiment_signal_events_cuisine_created"
      ON sentiment_signal_events (cuisine_type, created_at DESC)
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'sentiment_signal_events_score_100_range'
        ) THEN
          ALTER TABLE sentiment_signal_events
            ADD CONSTRAINT sentiment_signal_events_score_100_range
            CHECK (score_100 BETWEEN 1 AND 100);
        END IF;
      END
      $$
    `);
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'sentiment_signal_events_prev_score_100_range'
        ) THEN
          ALTER TABLE sentiment_signal_events
            ADD CONSTRAINT sentiment_signal_events_prev_score_100_range
            CHECK (
              previous_score_100 IS NULL OR
              previous_score_100 BETWEEN 1 AND 100
            );
        END IF;
      END
      $$
    `);

    console.log("[sentiment-schema] ready");
  } catch (error) {
    console.warn(
      "[sentiment-schema] compatibility check failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
