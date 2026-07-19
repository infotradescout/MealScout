CREATE TABLE IF NOT EXISTS parking_route_plans (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar NOT NULL,
  origin_label varchar NOT NULL,
  destination_label varchar NOT NULL,
  origin jsonb NOT NULL,
  destination jsonb NOT NULL,
  scope varchar NOT NULL DEFAULT 'nationwide',
  recurring boolean NOT NULL DEFAULT true,
  schedule jsonb NOT NULL DEFAULT '[]'::jsonb,
  host_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_checked_at timestamp DEFAULT now(),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parking_route_plans_user ON parking_route_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_parking_route_plans_updated ON parking_route_plans(updated_at);
