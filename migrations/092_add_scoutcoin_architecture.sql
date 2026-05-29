CREATE TABLE IF NOT EXISTS scoutcoin_token_configs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  chain varchar NOT NULL DEFAULT 'base-sepolia',
  contract_address varchar,
  symbol varchar NOT NULL DEFAULT 'SCOUT',
  decimals integer NOT NULL DEFAULT 18,
  status varchar NOT NULL DEFAULT 'disabled',
  price_module_enabled boolean NOT NULL DEFAULT false,
  price_provider varchar,
  provider_configured boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id varchar REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scoutcoin_wallet_registry (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id),
  wallet_address varchar NOT NULL,
  custodial_provider_id varchar,
  kyc_status varchar NOT NULL DEFAULT 'not_started',
  is_frozen boolean NOT NULL DEFAULT false,
  freeze_reason text,
  jurisdiction_code varchar,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scoutcoin_wallet_user
  ON scoutcoin_wallet_registry(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scoutcoin_wallet_address
  ON scoutcoin_wallet_registry(wallet_address);

CREATE TABLE IF NOT EXISTS scoutcoin_compliance_config (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  kyc_required_for_buy_send boolean NOT NULL DEFAULT true,
  blocked_jurisdictions jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_tx_amount_atomic varchar NOT NULL DEFAULT '0',
  daily_tx_amount_atomic varchar NOT NULL DEFAULT '0',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id varchar REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scoutcoin_tx_ledger (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_type varchar NOT NULL,
  status varchar NOT NULL DEFAULT 'confirmed',
  from_user_id varchar REFERENCES users(id),
  to_user_id varchar REFERENCES users(id),
  from_wallet_address varchar,
  to_wallet_address varchar,
  amount_atomic varchar NOT NULL DEFAULT '0',
  chain_tx_hash varchar,
  price_source varchar,
  perk_surface varchar,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id varchar REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scoutcoin_tx_type ON scoutcoin_tx_ledger(tx_type);
CREATE INDEX IF NOT EXISTS idx_scoutcoin_tx_from ON scoutcoin_tx_ledger(from_user_id);
CREATE INDEX IF NOT EXISTS idx_scoutcoin_tx_to ON scoutcoin_tx_ledger(to_user_id);
