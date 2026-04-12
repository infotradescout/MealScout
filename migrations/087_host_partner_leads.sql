CREATE TABLE IF NOT EXISTS host_partner_leads (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar NOT NULL,
  first_name varchar,
  phone varchar,
  business_name varchar NOT NULL,
  address text,
  city varchar,
  state varchar,
  location_type varchar NOT NULL DEFAULT 'other',
  parking_spots integer,
  daily_foot_traffic integer,
  notes text,
  source varchar NOT NULL DEFAULT 'host_location_partner',
  status varchar NOT NULL DEFAULT 'new',
  ip varchar,
  user_agent text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_host_partner_leads_created
  ON host_partner_leads (created_at);
CREATE INDEX IF NOT EXISTS idx_host_partner_leads_status
  ON host_partner_leads (status, created_at);
CREATE INDEX IF NOT EXISTS idx_host_partner_leads_source
  ON host_partner_leads (source, created_at);

CREATE TABLE IF NOT EXISTS host_partner_lead_sequence_sends (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id varchar NOT NULL REFERENCES host_partner_leads(id) ON DELETE CASCADE,
  sequence varchar NOT NULL,
  step integer NOT NULL,
  sent_at timestamp DEFAULT now(),
  metadata jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_host_partner_lead_sequence_step
  ON host_partner_lead_sequence_sends (lead_id, sequence, step);
CREATE INDEX IF NOT EXISTS idx_host_partner_lead_sequence_step_sent
  ON host_partner_lead_sequence_sends (sequence, step, sent_at);

