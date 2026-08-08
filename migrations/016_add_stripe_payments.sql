-- Migration 016: Add Stripe payment support for parking pass / event bookings
-- Business model: Host sets price, MealScout adds $10 fee, truck sees total upfront

-- 1. Update hosts table for Stripe Connect
ALTER TABLE hosts
ADD COLUMN IF NOT EXISTS stripe_connect_account_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS stripe_connect_status VARCHAR(50) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS stripe_onboarding_completed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_hosts_stripe_account ON hosts(stripe_connect_account_id);

-- 2. Update events table for pricing
ALTER TABLE events
ADD COLUMN IF NOT EXISTS host_price_cents INTEGER, -- Host sets this, can be NULL for free events
ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS stripe_product_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_events_requires_payment ON events(requires_payment);

-- 3. Create event_bookings table
CREATE TABLE IF NOT EXISTS event_bookings (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  truck_id VARCHAR NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  host_id VARCHAR NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,

  -- Pricing (locked at booking time so price changes don't affect existing bookings)
  host_price_cents INTEGER NOT NULL,
  platform_fee_cents INTEGER NOT NULL DEFAULT 1000, -- Always $10
  total_cents INTEGER NOT NULL, -- host_price + platform_fee (what truck actually pays)

  -- Payment status
  status VARCHAR NOT NULL DEFAULT 'pending', -- 'pending' | 'confirmed' | 'cancelled' | 'refunded'
  stripe_payment_intent_id VARCHAR,
  stripe_payment_status VARCHAR, -- 'pending' | 'succeeded' | 'failed'
  paid_at TIMESTAMP,

  -- Stripe Connect (splits payment between platform and host)
  stripe_application_fee_amount INTEGER DEFAULT 1000, -- Always $10 to platform
  stripe_transfer_destination VARCHAR, -- Host's Stripe Connect account ID

  -- Refunds
  refund_status VARCHAR DEFAULT 'none', -- 'none' | 'partial' | 'full'
  refund_amount_cents INTEGER,
  refunded_at TIMESTAMP,
  refund_reason TEXT,

  -- Metadata
  booking_confirmed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  cancellation_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- One booking per truck per event
  UNIQUE(event_id, truck_id)
);

CREATE INDEX IF NOT EXISTS idx_bookings_event ON event_bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_truck ON event_bookings(truck_id);
CREATE INDEX IF NOT EXISTS idx_bookings_host ON event_bookings(host_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON event_bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_intent ON event_bookings(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON event_bookings(created_at);
