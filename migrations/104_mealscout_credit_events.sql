CREATE TABLE IF NOT EXISTS mealscout_credit_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action varchar(100) NOT NULL,
  source_type varchar(140) NOT NULL,
  source_id varchar(240) NOT NULL,
  entity_type varchar(80),
  entity_id varchar(120),
  credit_amount_cents integer NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'credited',
  credit_ledger_id varchar REFERENCES credit_ledger(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mealscout_credit_events_user
  ON mealscout_credit_events(user_id);

CREATE INDEX IF NOT EXISTS idx_mealscout_credit_events_action
  ON mealscout_credit_events(action);

CREATE INDEX IF NOT EXISTS idx_mealscout_credit_events_source
  ON mealscout_credit_events(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_mealscout_credit_events_entity
  ON mealscout_credit_events(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_mealscout_credit_events_created
  ON mealscout_credit_events(created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mealscout_credit_events_user_source
  ON mealscout_credit_events(user_id, source_type, source_id);
