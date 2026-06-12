CREATE TABLE IF NOT EXISTS public_business_slug_ownerships (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  slug varchar(100) NOT NULL,
  entity_type varchar NOT NULL,
  entity_id varchar NOT NULL,
  preferred_slug varchar(100),
  source_name varchar,
  assignment_status varchar NOT NULL DEFAULT 'assigned',
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_public_business_slug_ownerships_slug
  ON public_business_slug_ownerships (slug);

CREATE UNIQUE INDEX IF NOT EXISTS uq_public_business_slug_ownerships_entity
  ON public_business_slug_ownerships (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_public_business_slug_ownerships_entity
  ON public_business_slug_ownerships (entity_type, entity_id);
