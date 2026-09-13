-- Integrated marketplace checkpoint: durable ordering review, canonical
-- Parking Pass purchase allocations, restricted credit, provider recovery,
-- and protected versioned arrival. The deploy runner supplies bounded lock and
-- statement timeouts and records this immutable migration fingerprint.

-- Parking Pass series are intentionally open-ended. Migration 101 established
-- this in the release ledger; repeat it here so disposable/bootstrap schemas
-- created from the declarative model cannot retain the legacy NOT NULL guard.
ALTER TABLE event_series
  ALTER COLUMN end_date DROP NOT NULL;

CREATE TABLE IF NOT EXISTS ordering_review_requests (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id VARCHAR NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  requester_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_authority_version INTEGER NOT NULL CHECK (submitted_authority_version >= 0),
  acknowledgement_minutes INTEGER NOT NULL CHECK (acknowledgement_minutes BETWEEN 5 AND 30),
  evidence_url TEXT NOT NULL CHECK (evidence_url ~* '^https://'),
  readiness_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  idempotency_key VARCHAR NOT NULL,
  reviewer_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT,
  rejection_reason TEXT,
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_ordering_review_request_idempotency
    UNIQUE (restaurant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ordering_review_restaurant
  ON ordering_review_requests (restaurant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ordering_review_status
  ON ordering_review_requests (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ordering_review_one_pending
  ON ordering_review_requests (restaurant_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS parking_pass_purchases (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  purchaser_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  truck_id VARCHAR NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  host_id VARCHAR NOT NULL REFERENCES hosts(id) ON DELETE RESTRICT,
  currency VARCHAR NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  host_amount_cents INTEGER NOT NULL CHECK (host_amount_cents >= 0),
  platform_fee_cents INTEGER NOT NULL CHECK (platform_fee_cents >= 0),
  charged_amount_cents INTEGER NOT NULL CHECK (charged_amount_cents > 0),
  refunded_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (refunded_amount_cents >= 0),
  cancellation_credit_issued_cents INTEGER NOT NULL DEFAULT 0
    CHECK (cancellation_credit_issued_cents >= 0),
  credit_applied_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_applied_cents >= 0),
  settlement_topology VARCHAR NOT NULL DEFAULT 'destination_charge'
    CHECK (settlement_topology = 'destination_charge'),
  settlement_status VARCHAR NOT NULL DEFAULT 'pending'
    CHECK (settlement_status IN (
      'pending', 'transferred_to_connect', 'reversed',
      'partially_reversed', 'disputed', 'failed'
    )),
  status VARCHAR NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'confirmed', 'partially_cancelled', 'cancelled',
      'partially_refunded', 'refunded', 'disputed', 'payment_failed'
    )),
  stripe_payment_intent_id VARCHAR,
  stripe_charge_id VARCHAR,
  stripe_transfer_id VARCHAR,
  stripe_application_fee_id VARCHAR,
  stripe_destination_account_id VARCHAR NOT NULL,
  idempotency_key VARCHAR NOT NULL,
  request_digest VARCHAR NOT NULL,
  allocation_digest VARCHAR NOT NULL,
  allocation_line_count INTEGER NOT NULL CHECK (allocation_line_count > 0),
  provider_lifecycle_state VARCHAR NOT NULL DEFAULT 'create_prepared'
    CHECK (provider_lifecycle_state IN (
      'create_prepared', 'create_submitted', 'provider_created',
      'bind_pending', 'bound', 'cancel_pending', 'action_required', 'closed'
    )),
  dispute_state VARCHAR NOT NULL DEFAULT 'none'
    CHECK (dispute_state IN ('none', 'open', 'won', 'lost')),
  stripe_dispute_id VARCHAR,
  dispute_outcome VARCHAR,
  provider_error_code VARCHAR,
  provider_error_message TEXT,
  paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_parking_pass_purchase_idempotency
    UNIQUE (purchaser_user_id, idempotency_key),
  CONSTRAINT ck_parking_pass_purchase_refund_total
    CHECK (refunded_amount_cents <= charged_amount_cents),
  CONSTRAINT ck_parking_pass_purchase_credit_total
    CHECK (
      cancellation_credit_issued_cents
        <= host_amount_cents + platform_fee_cents + credit_applied_cents
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_parking_pass_purchase_intent
  ON parking_pass_purchases (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parking_pass_purchase_purchaser
  ON parking_pass_purchases (purchaser_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_parking_pass_purchase_truck
  ON parking_pass_purchases (truck_id, created_at);
CREATE INDEX IF NOT EXISTS idx_parking_pass_purchase_host
  ON parking_pass_purchases (host_id, created_at);
CREATE INDEX IF NOT EXISTS idx_parking_pass_purchase_status
  ON parking_pass_purchases (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_parking_pass_purchase_lifecycle
  ON parking_pass_purchases (provider_lifecycle_state, updated_at);

ALTER TABLE event_bookings
  ADD COLUMN IF NOT EXISTS purchase_id VARCHAR REFERENCES parking_pass_purchases(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS allocation_ordinal INTEGER,
  ADD COLUMN IF NOT EXISTS allocation_digest VARCHAR,
  ADD COLUMN IF NOT EXISTS credit_applied_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_credit_issued_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancellation_actor_type VARCHAR,
  ADD COLUMN IF NOT EXISTS cancellation_actor_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_policy VARCHAR,
  ADD COLUMN IF NOT EXISTS cash_refunded_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS host_transfer_reversed_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS application_fee_refunded_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS restored_credit_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_state VARCHAR NOT NULL DEFAULT 'unsettled',
  ADD COLUMN IF NOT EXISTS settlement_topology VARCHAR,
  ADD COLUMN IF NOT EXISTS public_location_consent_snapshot BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS arrival_state VARCHAR NOT NULL DEFAULT 'not_captured',
  ADD COLUMN IF NOT EXISTS current_arrival_version_id VARCHAR,
  ADD COLUMN IF NOT EXISTS pending_arrival_version_id VARCHAR;

CREATE INDEX IF NOT EXISTS idx_bookings_purchase ON event_bookings (purchase_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_purchase_ordinal
  ON event_bookings (purchase_id, allocation_ordinal)
  WHERE purchase_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_arrival_state ON event_bookings (arrival_state);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_event_booking_cancellation_credit_amount'
  ) THEN
    ALTER TABLE event_bookings ADD CONSTRAINT ck_event_booking_cancellation_credit_amount
      CHECK (
        cancellation_credit_issued_cents >= 0
        AND cancellation_credit_issued_cents <= total_cents + credit_applied_cents
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_event_booking_refund_amount'
  ) THEN
    ALTER TABLE event_bookings ADD CONSTRAINT ck_event_booking_refund_amount
      CHECK (
        COALESCE(refund_amount_cents, 0) >= 0
        AND COALESCE(refund_amount_cents, 0) <= total_cents
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_event_booking_arrival_state'
  ) THEN
    ALTER TABLE event_bookings ADD CONSTRAINT ck_event_booking_arrival_state
      CHECK (arrival_state IN (
        'not_captured', 'acknowledged', 'arrival_change_pending', 'operator_cancelled'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_event_booking_allocation_amounts'
  ) THEN
    ALTER TABLE event_bookings ADD CONSTRAINT ck_event_booking_allocation_amounts
      CHECK (
        host_price_cents >= 0
        AND platform_fee_cents >= 0
        AND credit_applied_cents >= 0
        AND total_cents = host_price_cents + platform_fee_cents
        AND cash_refunded_cents >= 0
        AND host_transfer_reversed_cents >= 0
        AND application_fee_refunded_cents >= 0
        AND restored_credit_cents >= 0
        AND cash_refunded_cents <= total_cents
        AND host_transfer_reversed_cents <= host_price_cents
        AND application_fee_refunded_cents <= platform_fee_cents
        AND restored_credit_cents <= credit_applied_cents
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_event_booking_settlement_state'
  ) THEN
    ALTER TABLE event_bookings ADD CONSTRAINT ck_event_booking_settlement_state
      CHECK (settlement_state IN (
        'unsettled', 'destination_settled', 'reversal_pending',
        'provider_confirmed', 'action_required', 'disputed'
      ));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS parking_pass_cancellation_operations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id VARCHAR NOT NULL REFERENCES parking_pass_purchases(id) ON DELETE RESTRICT,
  request_id VARCHAR NOT NULL,
  idempotency_key VARCHAR NOT NULL UNIQUE,
  booking_line_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  request_digest VARCHAR NOT NULL,
  allocation_digest VARCHAR NOT NULL,
  actor_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy_facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_type VARCHAR NOT NULL,
  actor_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  policy_trigger VARCHAR NOT NULL,
  remedy VARCHAR NOT NULL CHECK (remedy IN ('release', 'restricted_credit', 'cash_refund', 'none')),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  expected_payment_intent_id VARCHAR,
  expected_charge_id VARCHAR,
  expected_currency VARCHAR NOT NULL DEFAULT 'usd',
  expected_cash_refund_cents INTEGER NOT NULL DEFAULT 0,
  expected_host_reversal_cents INTEGER NOT NULL DEFAULT 0,
  expected_application_fee_refund_cents INTEGER NOT NULL DEFAULT 0,
  expected_destination_account_id VARCHAR,
  status VARCHAR NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'processing', 'failed_action_required',
      'provider_confirmed', 'credit_issued', 'released', 'no_remedy'
    )),
  stripe_refund_id VARCHAR,
  provider_status VARCHAR,
  provider_error_code VARCHAR,
  provider_error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  completed_at TIMESTAMP,
  action_required_at TIMESTAMP,
  CONSTRAINT uq_parking_pass_operation_request UNIQUE (purchase_id, request_id)
);

ALTER TABLE parking_pass_cancellation_operations
  ADD COLUMN IF NOT EXISTS reason TEXT;
UPDATE parking_pass_cancellation_operations
   SET reason = 'Historical cancellation reason unavailable'
 WHERE reason IS NULL OR btrim(reason) = '';
ALTER TABLE parking_pass_cancellation_operations
  ALTER COLUMN reason SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_parking_pass_operation_refund
  ON parking_pass_cancellation_operations (stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parking_pass_operation_purchase
  ON parking_pass_cancellation_operations (purchase_id, created_at);
CREATE INDEX IF NOT EXISTS idx_parking_pass_operation_status
  ON parking_pass_cancellation_operations (status, updated_at);

CREATE OR REPLACE FUNCTION mealscout_guard_cancellation_operation_identity()
RETURNS TRIGGER AS $$
DECLARE
  purchase RECORD;
  sorted_line_ids JSONB;
  requested_line_count INTEGER;
  owned_line_count INTEGER;
  selected_cash_cents INTEGER;
  selected_host_cents INTEGER;
  selected_fee_cents INTEGER;
  selected_credit_cents INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'parking pass cancellation operations are append-only'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.purchase_id IS DISTINCT FROM OLD.purchase_id
    OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.booking_line_ids IS DISTINCT FROM OLD.booking_line_ids
    OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
    OR NEW.allocation_digest IS DISTINCT FROM OLD.allocation_digest
    OR NEW.actor_snapshot IS DISTINCT FROM OLD.actor_snapshot
    OR NEW.policy_facts IS DISTINCT FROM OLD.policy_facts
    OR NEW.actor_type IS DISTINCT FROM OLD.actor_type
    OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.policy_trigger IS DISTINCT FROM OLD.policy_trigger
    OR NEW.remedy IS DISTINCT FROM OLD.remedy
    OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
    OR NEW.expected_payment_intent_id IS DISTINCT FROM OLD.expected_payment_intent_id
    OR NEW.expected_charge_id IS DISTINCT FROM OLD.expected_charge_id
    OR NEW.expected_currency IS DISTINCT FROM OLD.expected_currency
    OR NEW.expected_cash_refund_cents IS DISTINCT FROM OLD.expected_cash_refund_cents
    OR NEW.expected_host_reversal_cents IS DISTINCT FROM OLD.expected_host_reversal_cents
    OR NEW.expected_application_fee_refund_cents IS DISTINCT FROM OLD.expected_application_fee_refund_cents
    OR NEW.expected_destination_account_id IS DISTINCT FROM OLD.expected_destination_account_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'parking pass cancellation request identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(NEW.booking_line_ids) <> 'array' THEN
    RAISE EXCEPTION 'parking pass cancellation lines must be an array'
      USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb), count(*)
    INTO sorted_line_ids, requested_line_count
    FROM jsonb_array_elements_text(NEW.booking_line_ids);
  IF requested_line_count = 0
     OR sorted_line_ids IS DISTINCT FROM NEW.booking_line_ids
     OR (SELECT count(DISTINCT value)
           FROM jsonb_array_elements_text(NEW.booking_line_ids))
          <> requested_line_count THEN
    RAISE EXCEPTION 'parking pass cancellation lines must be nonempty, sorted, and unique'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO purchase
    FROM parking_pass_purchases WHERE id = NEW.purchase_id;
  SELECT count(*)::INTEGER,
         COALESCE(sum(booking.total_cents), 0)::INTEGER,
         COALESCE(sum(booking.host_price_cents), 0)::INTEGER,
         COALESCE(sum(booking.platform_fee_cents), 0)::INTEGER,
         COALESCE(sum(booking.credit_applied_cents), 0)::INTEGER
    INTO owned_line_count, selected_cash_cents, selected_host_cents,
         selected_fee_cents, selected_credit_cents
    FROM event_bookings booking
   WHERE booking.purchase_id = NEW.purchase_id
     AND booking.allocation_digest = NEW.allocation_digest
     AND booking.id IN (
       SELECT value FROM jsonb_array_elements_text(NEW.booking_line_ids)
     );
  IF NOT FOUND
     OR owned_line_count <> requested_line_count
     OR purchase.allocation_digest IS DISTINCT FROM NEW.allocation_digest
     OR purchase.currency IS DISTINCT FROM NEW.expected_currency
     OR NEW.expected_payment_intent_id IS DISTINCT FROM purchase.stripe_payment_intent_id
     OR NEW.expected_charge_id IS DISTINCT FROM purchase.stripe_charge_id
     OR NEW.expected_destination_account_id
          IS DISTINCT FROM purchase.stripe_destination_account_id
     OR (NEW.remedy = 'cash_refund' AND (
       NEW.amount_cents <> selected_cash_cents
       OR NEW.expected_cash_refund_cents <> selected_cash_cents
       OR NEW.expected_host_reversal_cents <> selected_host_cents
       OR NEW.expected_application_fee_refund_cents <> selected_fee_cents
     ))
     OR (NEW.remedy = 'restricted_credit' AND (
       NEW.amount_cents <> selected_cash_cents + selected_credit_cents
       OR NEW.expected_cash_refund_cents <> 0
       OR NEW.expected_host_reversal_cents <> 0
       OR NEW.expected_application_fee_refund_cents <> 0
     ))
     OR (NEW.remedy IN ('release', 'none') AND (
       NEW.amount_cents <> 0
       OR NEW.expected_cash_refund_cents <> 0
       OR NEW.expected_host_reversal_cents <> 0
       OR NEW.expected_application_fee_refund_cents <> 0
     ))
     OR jsonb_typeof(NEW.actor_snapshot) <> 'object'
     OR jsonb_typeof(NEW.policy_facts) <> 'object' THEN
    RAISE EXCEPTION 'parking pass cancellation financial identity does not match selected lines'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_cancellation_operation_identity
  ON parking_pass_cancellation_operations;
CREATE TRIGGER trigger_guard_cancellation_operation_identity
BEFORE INSERT OR UPDATE OR DELETE ON parking_pass_cancellation_operations
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_cancellation_operation_identity();

CREATE TABLE IF NOT EXISTS parking_pass_provider_operations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id VARCHAR NOT NULL REFERENCES parking_pass_purchases(id) ON DELETE RESTRICT,
  cancellation_operation_id VARCHAR
    REFERENCES parking_pass_cancellation_operations(id) ON DELETE RESTRICT,
  operation_kind VARCHAR NOT NULL CHECK (operation_kind IN (
    'payment_intent_create', 'payment_intent_cancel',
    'selected_line_refund', 'dispute_reconcile'
  )),
  request_id VARCHAR NOT NULL,
  idempotency_key VARCHAR NOT NULL UNIQUE,
  request_digest VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared', 'submitted', 'processing', 'provider_confirmed',
    'action_required', 'failed', 'quarantined'
  )),
  policy_trigger VARCHAR,
  actor_type VARCHAR NOT NULL,
  actor_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  sorted_line_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  allocation_digest VARCHAR NOT NULL,
  expected_payment_intent_id VARCHAR,
  expected_charge_id VARCHAR,
  expected_currency VARCHAR NOT NULL CHECK (expected_currency = 'usd'),
  expected_amount_cents INTEGER NOT NULL CHECK (expected_amount_cents >= 0),
  expected_host_amount_cents INTEGER NOT NULL DEFAULT 0
    CHECK (expected_host_amount_cents >= 0),
  expected_application_fee_cents INTEGER NOT NULL DEFAULT 0
    CHECK (expected_application_fee_cents >= 0),
  expected_destination_account_id VARCHAR NOT NULL,
  provider_payment_intent_id VARCHAR,
  provider_charge_id VARCHAR,
  provider_transfer_id VARCHAR,
  provider_application_fee_id VARCHAR,
  provider_dispute_id VARCHAR,
  provider_status VARCHAR,
  provider_error_code VARCHAR,
  provider_error_message TEXT,
  idempotency_expires_at TIMESTAMP NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_parking_pass_provider_operation_request
    UNIQUE (purchase_id, operation_kind, request_id)
);

CREATE INDEX IF NOT EXISTS idx_parking_pass_provider_operation_recovery
  ON parking_pass_provider_operations (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_parking_pass_provider_operation_purchase
  ON parking_pass_provider_operations (purchase_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_parking_pass_provider_operation_dispute
  ON parking_pass_provider_operations (provider_dispute_id)
  WHERE provider_dispute_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS parking_pass_provider_operation_steps (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id VARCHAR NOT NULL
    REFERENCES parking_pass_provider_operations(id) ON DELETE RESTRICT,
  step_type VARCHAR NOT NULL CHECK (step_type IN (
    'payment_intent_create', 'payment_intent_bind', 'payment_intent_cancel',
    'cash_refund', 'transfer_reversal', 'application_fee_refund',
    'dispute_reconcile'
  )),
  step_order INTEGER NOT NULL CHECK (step_order > 0),
  status VARCHAR NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared', 'submitted', 'provider_confirmed', 'action_required', 'failed'
  )),
  idempotency_key VARCHAR NOT NULL UNIQUE,
  request_digest VARCHAR NOT NULL,
  allocation_digest VARCHAR NOT NULL,
  policy_trigger VARCHAR,
  expected_payment_intent_id VARCHAR,
  expected_charge_id VARCHAR,
  expected_currency VARCHAR NOT NULL CHECK (expected_currency = 'usd'),
  expected_amount_cents INTEGER NOT NULL CHECK (expected_amount_cents >= 0),
  expected_destination_account_id VARCHAR NOT NULL,
  expected_application_fee_cents INTEGER NOT NULL DEFAULT 0
    CHECK (expected_application_fee_cents >= 0),
  provider_object_id VARCHAR,
  provider_payment_intent_id VARCHAR,
  provider_charge_id VARCHAR,
  provider_transfer_id VARCHAR,
  provider_transfer_reversal_id VARCHAR,
  provider_application_fee_id VARCHAR,
  provider_application_fee_refund_id VARCHAR,
  provider_refund_id VARCHAR,
  provider_dispute_id VARCHAR,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  submitted_at TIMESTAMP,
  confirmed_at TIMESTAMP,
  provider_error_code VARCHAR,
  provider_error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_parking_pass_provider_step_kind UNIQUE (operation_id, step_type)
);

CREATE INDEX IF NOT EXISTS idx_parking_pass_provider_step_recovery
  ON parking_pass_provider_operation_steps (status, updated_at);

CREATE OR REPLACE FUNCTION mealscout_guard_provider_operation_identity()
RETURNS TRIGGER AS $$
DECLARE
  aggregate RECORD;
  parent_operation RECORD;
  sorted_ids JSONB;
  requested_line_count INTEGER;
  owned_line_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'parking_pass_provider_operations' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'provider operations are append-only'
        USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (
      NEW.purchase_id IS DISTINCT FROM OLD.purchase_id
      OR NEW.cancellation_operation_id IS DISTINCT FROM OLD.cancellation_operation_id
      OR NEW.operation_kind IS DISTINCT FROM OLD.operation_kind
      OR NEW.request_id IS DISTINCT FROM OLD.request_id
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
      OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
      OR NEW.policy_trigger IS DISTINCT FROM OLD.policy_trigger
      OR NEW.actor_type IS DISTINCT FROM OLD.actor_type
      OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
      OR NEW.sorted_line_ids IS DISTINCT FROM OLD.sorted_line_ids
      OR NEW.allocation_digest IS DISTINCT FROM OLD.allocation_digest
      OR (
        NEW.expected_payment_intent_id IS DISTINCT FROM OLD.expected_payment_intent_id
        AND NOT (
          OLD.expected_payment_intent_id IS NULL
          AND NEW.expected_payment_intent_id IS NOT NULL
          AND NEW.operation_kind = 'payment_intent_create'
          AND NEW.provider_payment_intent_id = NEW.expected_payment_intent_id
        )
      )
      OR NEW.expected_charge_id IS DISTINCT FROM OLD.expected_charge_id
      OR NEW.expected_currency IS DISTINCT FROM OLD.expected_currency
      OR NEW.expected_amount_cents IS DISTINCT FROM OLD.expected_amount_cents
      OR NEW.expected_host_amount_cents IS DISTINCT FROM OLD.expected_host_amount_cents
      OR NEW.expected_application_fee_cents IS DISTINCT FROM OLD.expected_application_fee_cents
      OR NEW.expected_destination_account_id IS DISTINCT FROM OLD.expected_destination_account_id
      OR NEW.idempotency_expires_at IS DISTINCT FROM OLD.idempotency_expires_at
      OR (OLD.provider_payment_intent_id IS NOT NULL
          AND NEW.provider_payment_intent_id IS DISTINCT FROM OLD.provider_payment_intent_id)
      OR (OLD.provider_charge_id IS NOT NULL
          AND NEW.provider_charge_id IS DISTINCT FROM OLD.provider_charge_id)
      OR (OLD.provider_transfer_id IS NOT NULL
          AND NEW.provider_transfer_id IS DISTINCT FROM OLD.provider_transfer_id)
      OR (OLD.provider_application_fee_id IS NOT NULL
          AND NEW.provider_application_fee_id IS DISTINCT FROM OLD.provider_application_fee_id)
      OR (OLD.provider_dispute_id IS NOT NULL
          AND NEW.provider_dispute_id IS DISTINCT FROM OLD.provider_dispute_id)
    ) THEN
      RAISE EXCEPTION 'provider operation financial identity is immutable'
        USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.status = 'provider_confirmed'
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'confirmed provider operation cannot be reopened'
        USING ERRCODE = '23514';
    END IF;

    SELECT * INTO aggregate
      FROM parking_pass_purchases
     WHERE id = NEW.purchase_id;
    IF NOT FOUND
       OR aggregate.currency IS DISTINCT FROM NEW.expected_currency
       OR aggregate.stripe_destination_account_id
            IS DISTINCT FROM NEW.expected_destination_account_id
       OR aggregate.allocation_digest IS DISTINCT FROM NEW.allocation_digest
       OR (
         NEW.expected_payment_intent_id IS NOT NULL
         AND aggregate.stripe_payment_intent_id
               IS DISTINCT FROM NEW.expected_payment_intent_id
       )
       OR (
         NEW.expected_charge_id IS NOT NULL
         AND aggregate.stripe_charge_id IS DISTINCT FROM NEW.expected_charge_id
       )
       OR NEW.expected_amount_cents > aggregate.charged_amount_cents
       OR NEW.expected_host_amount_cents > aggregate.host_amount_cents
       OR NEW.expected_application_fee_cents > aggregate.platform_fee_cents THEN
      RAISE EXCEPTION 'provider operation does not match purchase financial identity'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.cancellation_operation_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM parking_pass_cancellation_operations cancellation
       WHERE cancellation.id = NEW.cancellation_operation_id
         AND cancellation.purchase_id = NEW.purchase_id
         AND cancellation.request_digest = NEW.request_digest
         AND cancellation.allocation_digest = NEW.allocation_digest
    ) THEN
      RAISE EXCEPTION 'provider operation cancellation identity mismatch'
        USING ERRCODE = '23514';
    END IF;

    IF jsonb_typeof(NEW.sorted_line_ids) <> 'array' THEN
      RAISE EXCEPTION 'provider operation line identity must be an array'
        USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb), count(*)
      INTO sorted_ids, requested_line_count
      FROM jsonb_array_elements_text(NEW.sorted_line_ids);
    IF sorted_ids IS DISTINCT FROM NEW.sorted_line_ids OR (
      SELECT count(DISTINCT value)
        FROM jsonb_array_elements_text(NEW.sorted_line_ids)
    ) <> requested_line_count THEN
      RAISE EXCEPTION 'provider operation line identity must be sorted and unique'
        USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO owned_line_count
      FROM event_bookings booking
     WHERE booking.purchase_id = NEW.purchase_id
       AND booking.id IN (
         SELECT value FROM jsonb_array_elements_text(NEW.sorted_line_ids)
       )
       AND booking.allocation_digest = NEW.allocation_digest;
    IF owned_line_count <> requested_line_count THEN
      RAISE EXCEPTION 'provider operation contains a foreign or stale allocation line'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'provider_confirmed'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'provider_confirmed')
       AND (
         NOT EXISTS (
           SELECT 1 FROM parking_pass_provider_operation_steps step
            WHERE step.operation_id = NEW.id
         )
         OR EXISTS (
           SELECT 1 FROM parking_pass_provider_operation_steps step
            WHERE step.operation_id = NEW.id
              AND step.status <> 'provider_confirmed'
         )
         OR (NEW.operation_kind = 'payment_intent_create' AND NOT (
           EXISTS (
             SELECT 1 FROM parking_pass_provider_operation_steps step
              WHERE step.operation_id = NEW.id
                AND step.step_type = 'payment_intent_create'
                AND step.provider_payment_intent_id = NEW.provider_payment_intent_id
           )
           AND EXISTS (
             SELECT 1 FROM parking_pass_provider_operation_steps step
              WHERE step.operation_id = NEW.id
                AND step.step_type = 'payment_intent_bind'
                AND step.provider_payment_intent_id = NEW.provider_payment_intent_id
           )
         ))
         OR (NEW.operation_kind = 'payment_intent_cancel' AND NOT EXISTS (
           SELECT 1 FROM parking_pass_provider_operation_steps step
            WHERE step.operation_id = NEW.id
              AND step.step_type = 'payment_intent_cancel'
              AND (
                NEW.provider_payment_intent_id IS NULL
                OR step.provider_payment_intent_id = NEW.provider_payment_intent_id
              )
         ))
         OR (NEW.operation_kind = 'selected_line_refund' AND NOT (
           EXISTS (
             SELECT 1 FROM parking_pass_provider_operation_steps step
              WHERE step.operation_id = NEW.id
                AND step.step_type = 'cash_refund'
                AND step.provider_refund_id IS NOT NULL
                AND step.provider_charge_id = NEW.provider_charge_id
                AND step.provider_payment_intent_id = NEW.provider_payment_intent_id
           )
           AND EXISTS (
             SELECT 1 FROM parking_pass_provider_operation_steps step
              WHERE step.operation_id = NEW.id
                AND step.step_type = 'transfer_reversal'
                AND step.provider_transfer_id = NEW.provider_transfer_id
                AND step.provider_transfer_reversal_id IS NOT NULL
           )
           AND (
             NEW.expected_application_fee_cents = 0
             OR EXISTS (
               SELECT 1 FROM parking_pass_provider_operation_steps step
                WHERE step.operation_id = NEW.id
                  AND step.step_type = 'application_fee_refund'
                  AND step.provider_application_fee_id = NEW.provider_application_fee_id
                  AND step.provider_application_fee_refund_id IS NOT NULL
             )
           )
         ))
         OR (NEW.operation_kind = 'dispute_reconcile' AND NOT EXISTS (
           SELECT 1 FROM parking_pass_provider_operation_steps step
            WHERE step.operation_id = NEW.id
              AND step.step_type = 'dispute_reconcile'
              AND step.provider_dispute_id = NEW.provider_dispute_id
              AND step.provider_charge_id = NEW.provider_charge_id
              AND step.provider_payment_intent_id = NEW.provider_payment_intent_id
         ))
       ) THEN
      RAISE EXCEPTION 'provider confirmation requires exact confirmed step proof'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider operation steps are append-only'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.step_type IS DISTINCT FROM OLD.step_type
    OR NEW.step_order IS DISTINCT FROM OLD.step_order
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
    OR NEW.allocation_digest IS DISTINCT FROM OLD.allocation_digest
    OR NEW.policy_trigger IS DISTINCT FROM OLD.policy_trigger
    OR (
      NEW.expected_payment_intent_id IS DISTINCT FROM OLD.expected_payment_intent_id
      AND NOT (
        OLD.expected_payment_intent_id IS NULL
        AND NEW.expected_payment_intent_id IS NOT NULL
        AND NEW.step_type IN ('payment_intent_create', 'payment_intent_bind')
        AND NEW.provider_payment_intent_id = NEW.expected_payment_intent_id
      )
    )
    OR NEW.expected_charge_id IS DISTINCT FROM OLD.expected_charge_id
    OR NEW.expected_currency IS DISTINCT FROM OLD.expected_currency
    OR NEW.expected_amount_cents IS DISTINCT FROM OLD.expected_amount_cents
    OR NEW.expected_destination_account_id IS DISTINCT FROM OLD.expected_destination_account_id
    OR NEW.expected_application_fee_cents IS DISTINCT FROM OLD.expected_application_fee_cents
    OR (OLD.provider_object_id IS NOT NULL
        AND NEW.provider_object_id IS DISTINCT FROM OLD.provider_object_id)
    OR (OLD.provider_payment_intent_id IS NOT NULL
        AND NEW.provider_payment_intent_id IS DISTINCT FROM OLD.provider_payment_intent_id)
    OR (OLD.provider_charge_id IS NOT NULL
        AND NEW.provider_charge_id IS DISTINCT FROM OLD.provider_charge_id)
    OR (OLD.provider_transfer_id IS NOT NULL
        AND NEW.provider_transfer_id IS DISTINCT FROM OLD.provider_transfer_id)
    OR (OLD.provider_transfer_reversal_id IS NOT NULL
        AND NEW.provider_transfer_reversal_id IS DISTINCT FROM OLD.provider_transfer_reversal_id)
    OR (OLD.provider_application_fee_id IS NOT NULL
        AND NEW.provider_application_fee_id IS DISTINCT FROM OLD.provider_application_fee_id)
    OR (OLD.provider_application_fee_refund_id IS NOT NULL
        AND NEW.provider_application_fee_refund_id IS DISTINCT FROM OLD.provider_application_fee_refund_id)
    OR (OLD.provider_refund_id IS NOT NULL
        AND NEW.provider_refund_id IS DISTINCT FROM OLD.provider_refund_id)
    OR (OLD.provider_dispute_id IS NOT NULL
        AND NEW.provider_dispute_id IS DISTINCT FROM OLD.provider_dispute_id)
  ) THEN
    RAISE EXCEPTION 'provider operation step financial identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'provider_confirmed'
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'confirmed provider step cannot be reopened'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO parent_operation
    FROM parking_pass_provider_operations
   WHERE id = NEW.operation_id;
  IF NOT FOUND
     OR parent_operation.request_digest IS DISTINCT FROM NEW.request_digest
     OR parent_operation.allocation_digest IS DISTINCT FROM NEW.allocation_digest
     OR parent_operation.policy_trigger IS DISTINCT FROM NEW.policy_trigger
     OR parent_operation.expected_currency IS DISTINCT FROM NEW.expected_currency
     OR parent_operation.expected_destination_account_id
          IS DISTINCT FROM NEW.expected_destination_account_id
     OR parent_operation.expected_payment_intent_id
          IS DISTINCT FROM NEW.expected_payment_intent_id
     OR parent_operation.expected_charge_id IS DISTINCT FROM NEW.expected_charge_id
     OR NEW.expected_amount_cents > parent_operation.expected_amount_cents
     OR NEW.expected_application_fee_cents
          > parent_operation.expected_application_fee_cents THEN
    RAISE EXCEPTION 'provider step does not match its durable operation'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'provider_confirmed' AND (
    (NEW.step_type IN ('payment_intent_create', 'payment_intent_bind', 'payment_intent_cancel')
      AND NEW.provider_object_id IS NULL)
    OR (NEW.step_type IN ('payment_intent_create', 'payment_intent_bind')
      AND NEW.provider_payment_intent_id IS NULL)
    OR (NEW.step_type IN (
          'payment_intent_create', 'payment_intent_bind',
          'payment_intent_cancel', 'cash_refund', 'dispute_reconcile'
        )
      AND NEW.expected_payment_intent_id IS NOT NULL
      AND NEW.provider_payment_intent_id IS DISTINCT FROM NEW.expected_payment_intent_id)
    OR (NEW.step_type = 'cash_refund' AND (
      NEW.provider_refund_id IS NULL
      OR NEW.provider_charge_id IS DISTINCT FROM NEW.expected_charge_id
      OR NEW.provider_payment_intent_id IS DISTINCT FROM NEW.expected_payment_intent_id
    ))
    OR (NEW.step_type = 'transfer_reversal' AND (
      NEW.provider_transfer_id IS NULL OR NEW.provider_transfer_reversal_id IS NULL
    ))
    OR (NEW.step_type = 'application_fee_refund' AND (
      NEW.provider_application_fee_id IS NULL
      OR NEW.provider_application_fee_refund_id IS NULL
    ))
    OR (NEW.step_type = 'dispute_reconcile' AND (
      NEW.provider_dispute_id IS NULL
      OR NEW.provider_charge_id IS DISTINCT FROM NEW.expected_charge_id
      OR NEW.provider_payment_intent_id IS DISTINCT FROM NEW.expected_payment_intent_id
    ))
  ) THEN
    RAISE EXCEPTION 'provider step confirmation is missing exact provider identity'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_provider_operation_identity
  ON parking_pass_provider_operations;
CREATE TRIGGER trigger_guard_provider_operation_identity
BEFORE INSERT OR UPDATE OR DELETE ON parking_pass_provider_operations
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_provider_operation_identity();

DROP TRIGGER IF EXISTS trigger_guard_provider_step_identity
  ON parking_pass_provider_operation_steps;
CREATE TRIGGER trigger_guard_provider_step_identity
BEFORE INSERT OR UPDATE OR DELETE ON parking_pass_provider_operation_steps
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_provider_operation_identity();

CREATE TABLE IF NOT EXISTS parking_pass_credit_ledger (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  purchase_id VARCHAR REFERENCES parking_pass_purchases(id) ON DELETE RESTRICT,
  booking_id VARCHAR REFERENCES event_bookings(id) ON DELETE RESTRICT,
  operation_id VARCHAR REFERENCES parking_pass_cancellation_operations(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  entry_type VARCHAR NOT NULL CHECK (entry_type IN (
    'cancellation_credit', 'booking_fee_consumption',
    'non_service_credit_restoration', 'release', 'adjustment'
  )),
  state VARCHAR NOT NULL DEFAULT 'posted'
    CHECK (state IN ('reserved', 'posted', 'released')),
  idempotency_key VARCHAR NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parking_pass_credit_user
  ON parking_pass_credit_ledger (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_parking_pass_credit_purchase
  ON parking_pass_credit_ledger (purchase_id);

CREATE TABLE IF NOT EXISTS parking_pass_arrival_versions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id VARCHAR NOT NULL REFERENCES event_bookings(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  supersedes_version_id VARCHAR REFERENCES parking_pass_arrival_versions(id) ON DELETE RESTRICT,
  correction_idempotency_key VARCHAR,
  correction_request_digest VARCHAR,
  acknowledgement_idempotency_key VARCHAR,
  acknowledgement_request_digest VARCHAR,
  state VARCHAR NOT NULL DEFAULT 'current'
    CHECK (state IN ('current', 'proposed', 'historical', 'cancelled')),
  address TEXT NOT NULL,
  city VARCHAR,
  state_code VARCHAR,
  latitude NUMERIC(10,8),
  longitude NUMERIC(11,8),
  start_at TIMESTAMP NOT NULL,
  end_at TIMESTAMP NOT NULL,
  access_instructions TEXT,
  safety_instructions TEXT,
  actor_type VARCHAR NOT NULL,
  actor_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  effective_at TIMESTAMP NOT NULL,
  is_material BOOLEAN NOT NULL DEFAULT false,
  notification_state VARCHAR NOT NULL DEFAULT 'not_required'
    CHECK (notification_state IN ('not_required', 'pending', 'sent', 'failed')),
  acknowledgement_deadline_at TIMESTAMP,
  acknowledged_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_parking_pass_arrival_version UNIQUE (booking_id, version)
);

CREATE INDEX IF NOT EXISTS idx_parking_pass_arrival_booking
  ON parking_pass_arrival_versions (booking_id, version);
CREATE INDEX IF NOT EXISTS idx_parking_pass_arrival_deadline
  ON parking_pass_arrival_versions (state, acknowledgement_deadline_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_parking_pass_arrival_current
  ON parking_pass_arrival_versions (booking_id)
  WHERE state = 'current';
CREATE UNIQUE INDEX IF NOT EXISTS uq_parking_pass_arrival_proposed
  ON parking_pass_arrival_versions (booking_id)
  WHERE state = 'proposed';
CREATE UNIQUE INDEX IF NOT EXISTS uq_parking_pass_arrival_id_booking
  ON parking_pass_arrival_versions (id, booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_parking_pass_arrival_correction_idempotency
  ON parking_pass_arrival_versions (booking_id, correction_idempotency_key)
  WHERE correction_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_parking_pass_arrival_ack_idempotency
  ON parking_pass_arrival_versions (booking_id, acknowledgement_idempotency_key)
  WHERE acknowledgement_idempotency_key IS NOT NULL;

ALTER TABLE event_bookings
  DROP CONSTRAINT IF EXISTS fk_event_booking_current_arrival_version,
  DROP CONSTRAINT IF EXISTS fk_event_booking_pending_arrival_version;
ALTER TABLE event_bookings ADD CONSTRAINT fk_event_booking_current_arrival_version
  FOREIGN KEY (current_arrival_version_id, id)
  REFERENCES parking_pass_arrival_versions(id, booking_id) ON DELETE RESTRICT;
ALTER TABLE event_bookings ADD CONSTRAINT fk_event_booking_pending_arrival_version
  FOREIGN KEY (pending_arrival_version_id, id)
  REFERENCES parking_pass_arrival_versions(id, booking_id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION mealscout_guard_arrival_version_integrity()
RETURNS TRIGGER AS $$
DECLARE
  superseded_booking_id VARCHAR;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Parking Pass arrival facts are append-only'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.booking_id IS DISTINCT FROM OLD.booking_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.supersedes_version_id IS DISTINCT FROM OLD.supersedes_version_id
    OR NEW.address IS DISTINCT FROM OLD.address
    OR NEW.city IS DISTINCT FROM OLD.city
    OR NEW.state_code IS DISTINCT FROM OLD.state_code
    OR NEW.latitude IS DISTINCT FROM OLD.latitude
    OR NEW.longitude IS DISTINCT FROM OLD.longitude
    OR NEW.start_at IS DISTINCT FROM OLD.start_at
    OR NEW.end_at IS DISTINCT FROM OLD.end_at
    OR NEW.access_instructions IS DISTINCT FROM OLD.access_instructions
    OR NEW.safety_instructions IS DISTINCT FROM OLD.safety_instructions
    OR NEW.actor_type IS DISTINCT FROM OLD.actor_type
    OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.effective_at IS DISTINCT FROM OLD.effective_at
    OR NEW.is_material IS DISTINCT FROM OLD.is_material
    OR NEW.correction_idempotency_key IS DISTINCT FROM OLD.correction_idempotency_key
    OR NEW.correction_request_digest IS DISTINCT FROM OLD.correction_request_digest
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Parking Pass arrival factual columns are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.acknowledged_at IS NOT NULL
     AND (
       NEW.acknowledgement_idempotency_key
         IS DISTINCT FROM OLD.acknowledgement_idempotency_key
       OR NEW.acknowledgement_request_digest
         IS DISTINCT FROM OLD.acknowledgement_request_digest
       OR NEW.acknowledged_by_user_id
         IS DISTINCT FROM OLD.acknowledged_by_user_id
       OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
     ) THEN
    RAISE EXCEPTION 'Parking Pass arrival acknowledgement is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.state IN ('historical', 'cancelled')
     AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'terminal arrival version state cannot be reopened'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.supersedes_version_id IS NOT NULL THEN
    SELECT booking_id INTO superseded_booking_id
      FROM parking_pass_arrival_versions
     WHERE id = NEW.supersedes_version_id;
    IF superseded_booking_id IS DISTINCT FROM NEW.booking_id THEN
      RAISE EXCEPTION 'arrival version cannot supersede another booking'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_arrival_version_integrity
  ON parking_pass_arrival_versions;
CREATE TRIGGER trigger_guard_arrival_version_integrity
BEFORE INSERT OR UPDATE OR DELETE ON parking_pass_arrival_versions
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_arrival_version_integrity();

CREATE OR REPLACE FUNCTION mealscout_validate_purchase_allocations(
  target_purchase_id VARCHAR
)
RETURNS VOID AS $$
DECLARE
  aggregate RECORD;
  allocation RECORD;
BEGIN
  IF target_purchase_id IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO aggregate
    FROM parking_pass_purchases
   WHERE id = target_purchase_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT
      count(*)::INTEGER AS line_count,
      COALESCE(sum(host_price_cents), 0)::INTEGER AS host_cents,
      COALESCE(sum(platform_fee_cents), 0)::INTEGER AS fee_cents,
      COALESCE(sum(credit_applied_cents), 0)::INTEGER AS credit_cents,
      COALESCE(sum(total_cents), 0)::INTEGER AS cash_cents,
      count(*) FILTER (
        WHERE allocation_digest IS DISTINCT FROM aggregate.allocation_digest
      )::INTEGER AS wrong_digest_count,
      count(*) FILTER (
        WHERE truck_id IS DISTINCT FROM aggregate.truck_id
           OR host_id IS DISTINCT FROM aggregate.host_id
           OR settlement_topology IS DISTINCT FROM 'destination_charge'
      )::INTEGER AS wrong_owner_count
    INTO allocation
    FROM event_bookings
   WHERE purchase_id = target_purchase_id;

  IF allocation.line_count IS DISTINCT FROM aggregate.allocation_line_count
     OR allocation.host_cents IS DISTINCT FROM aggregate.host_amount_cents
     OR allocation.fee_cents IS DISTINCT FROM aggregate.platform_fee_cents
     OR allocation.credit_cents IS DISTINCT FROM aggregate.credit_applied_cents
     OR allocation.cash_cents IS DISTINCT FROM aggregate.charged_amount_cents
     OR allocation.wrong_digest_count <> 0
     OR allocation.wrong_owner_count <> 0 THEN
    RAISE EXCEPTION 'Parking Pass aggregate/allocation identity mismatch'
      USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mealscout_guard_purchase_allocation_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'parking_pass_purchases' THEN
    PERFORM mealscout_validate_purchase_allocations(COALESCE(NEW.id, OLD.id));
  ELSE
    IF TG_OP <> 'INSERT' THEN
      PERFORM mealscout_validate_purchase_allocations(OLD.purchase_id);
    END IF;
    IF TG_OP <> 'DELETE'
       AND (TG_OP = 'INSERT' OR NEW.purchase_id IS DISTINCT FROM OLD.purchase_id) THEN
      PERFORM mealscout_validate_purchase_allocations(NEW.purchase_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_purchase_allocation_totals_purchase
  ON parking_pass_purchases;
CREATE CONSTRAINT TRIGGER trigger_purchase_allocation_totals_purchase
AFTER INSERT OR UPDATE OF
  truck_id, host_id, host_amount_cents, platform_fee_cents,
  charged_amount_cents, credit_applied_cents, allocation_digest,
  allocation_line_count, settlement_topology
ON parking_pass_purchases
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_purchase_allocation_totals();

DROP TRIGGER IF EXISTS trigger_purchase_allocation_totals_booking
  ON event_bookings;
CREATE CONSTRAINT TRIGGER trigger_purchase_allocation_totals_booking
AFTER INSERT OR DELETE OR UPDATE OF
  purchase_id, truck_id, host_id, host_price_cents, platform_fee_cents,
  total_cents, credit_applied_cents, allocation_digest, settlement_topology
ON event_bookings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_purchase_allocation_totals();

-- Destination-charge settlement is provider-owned and must never be counted in
-- the historical platform-held payout ledger. Classify existing rows once and
-- fail closed on payout requests until their legacy funding is revalidated.
ALTER TABLE host_earnings_ledger
  ADD COLUMN IF NOT EXISTS purchase_id VARCHAR
    REFERENCES parking_pass_purchases(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS settlement_topology VARCHAR NOT NULL
    DEFAULT 'legacy_platform_hold',
  ADD COLUMN IF NOT EXISTS reconciliation_state VARCHAR NOT NULL
    DEFAULT 'eligible_legacy',
  ADD COLUMN IF NOT EXISTS quarantine_reason TEXT;

ALTER TABLE host_payout_requests
  ADD COLUMN IF NOT EXISTS funding_topology VARCHAR NOT NULL
    DEFAULT 'legacy_platform_hold',
  ADD COLUMN IF NOT EXISTS eligibility_state VARCHAR NOT NULL
    DEFAULT 'requires_revalidation',
  ADD COLUMN IF NOT EXISTS eligible_amount_snapshot_cents INTEGER,
  ADD COLUMN IF NOT EXISTS provider_transfer_id VARCHAR,
  ADD COLUMN IF NOT EXISTS quarantine_reason TEXT;

UPDATE host_earnings_ledger ledger
   SET purchase_id = booking.purchase_id,
       settlement_topology = 'destination_charge',
       reconciliation_state = 'quarantined_destination',
       quarantine_reason = COALESCE(
         ledger.quarantine_reason,
         'destination charge settles directly to Connect; excluded from legacy payout'
       )
  FROM event_bookings booking
 WHERE ledger.booking_id = booking.id
   AND booking.purchase_id IS NOT NULL
   AND (
     ledger.purchase_id IS DISTINCT FROM booking.purchase_id
     OR ledger.settlement_topology IS DISTINCT FROM 'destination_charge'
     OR ledger.reconciliation_state IS DISTINCT FROM 'quarantined_destination'
   );

UPDATE host_earnings_ledger ledger
   SET purchase_id = purchase.id,
       settlement_topology = 'destination_charge',
       reconciliation_state = 'quarantined_destination',
       quarantine_reason = COALESCE(
         ledger.quarantine_reason,
         'destination charge intent settles directly to Connect; excluded from legacy payout'
       )
  FROM parking_pass_purchases purchase
 WHERE ledger.stripe_payment_intent_id = purchase.stripe_payment_intent_id
   AND purchase.stripe_payment_intent_id IS NOT NULL
   AND ledger.reconciliation_state IS DISTINCT FROM 'quarantined_destination';

UPDATE host_payout_requests
   SET funding_topology = 'unclassified',
       eligibility_state = 'requires_revalidation',
       eligible_amount_snapshot_cents = NULL,
       quarantine_reason = COALESCE(
         quarantine_reason,
         'historical payout request requires eligible legacy-fund revalidation'
       )
 WHERE provider_transfer_id IS NULL
   AND status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS idx_host_earnings_reconciliation
  ON host_earnings_ledger (reconciliation_state, host_id);
CREATE INDEX IF NOT EXISTS idx_host_payout_eligibility
  ON host_payout_requests (eligibility_state, host_id);

CREATE OR REPLACE FUNCTION mealscout_guard_destination_legacy_ledger()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.purchase_id IS NOT NULL OR EXISTS (
    SELECT 1
      FROM event_bookings booking
     WHERE booking.id = NEW.booking_id
       AND booking.purchase_id IS NOT NULL
  ) OR EXISTS (
    SELECT 1
      FROM parking_pass_purchases purchase
     WHERE purchase.stripe_payment_intent_id = NEW.stripe_payment_intent_id
       AND NEW.stripe_payment_intent_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'destination settlement cannot enter legacy payout ledger'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.settlement_topology IS DISTINCT FROM 'legacy_platform_hold'
     OR NEW.reconciliation_state IS DISTINCT FROM 'eligible_legacy' THEN
    RAISE EXCEPTION 'new legacy payout ledger entry must be explicitly eligible'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_destination_legacy_ledger
  ON host_earnings_ledger;
CREATE TRIGGER trigger_guard_destination_legacy_ledger
BEFORE INSERT OR UPDATE OF
  purchase_id, booking_id, stripe_payment_intent_id,
  settlement_topology, reconciliation_state
ON host_earnings_ledger
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_destination_legacy_ledger();

CREATE OR REPLACE FUNCTION mealscout_guard_legacy_payout_eligibility()
RETURNS TRIGGER AS $$
DECLARE
  eligible_balance INTEGER;
  committed_balance INTEGER;
BEGIN
  IF NEW.status NOT IN (
    'approved', 'processing', 'paid', 'transferred_to_connect'
  ) THEN
    RETURN NEW;
  END IF;
  IF NEW.funding_topology IS DISTINCT FROM 'legacy_platform_hold'
     OR NEW.eligibility_state IS DISTINCT FROM 'eligible_legacy'
     OR NEW.eligible_amount_snapshot_cents IS NULL
     OR NEW.amount_cents > NEW.eligible_amount_snapshot_cents THEN
    RAISE EXCEPTION 'payout requires revalidated eligible legacy funds'
      USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(sum(amount_cents), 0)::INTEGER INTO eligible_balance
    FROM host_earnings_ledger
   WHERE host_id = NEW.host_id
     AND settlement_topology = 'legacy_platform_hold'
     AND reconciliation_state = 'eligible_legacy';
  SELECT COALESCE(sum(amount_cents), 0)::INTEGER INTO committed_balance
    FROM host_payout_requests
   WHERE host_id = NEW.host_id
     AND id IS DISTINCT FROM NEW.id
     AND status IN ('approved', 'paid')
     AND funding_topology = 'legacy_platform_hold'
     AND eligibility_state = 'eligible_legacy';
  IF NEW.amount_cents > eligible_balance - committed_balance THEN
    RAISE EXCEPTION 'payout exceeds currently eligible legacy funds'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_legacy_payout_eligibility
  ON host_payout_requests;
CREATE TRIGGER trigger_guard_legacy_payout_eligibility
BEFORE INSERT OR UPDATE OF
  amount_cents, status, funding_topology, eligibility_state,
  eligible_amount_snapshot_cents
ON host_payout_requests
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_legacy_payout_eligibility();

-- An older application may continue reading/reconciling historical bookings,
-- but it cannot create a new paid event-participation row without the purchase
-- aggregate and destination-settlement topology introduced above.
CREATE OR REPLACE FUNCTION mealscout_guard_paid_parking_pass_booking()
RETURNS TRIGGER AS $$
DECLARE
  payment_required BOOLEAN;
  aggregate RECORD;
BEGIN
  SELECT COALESCE(requires_payment, false)
    INTO payment_required
    FROM events
   WHERE id = NEW.event_id;

  IF payment_required AND NEW.purchase_id IS NULL THEN
    IF TG_OP = 'INSERT'
       OR (TG_OP = 'UPDATE'
           AND NEW.status = 'confirmed'
           AND OLD.status IS DISTINCT FROM 'confirmed') THEN
      RAISE EXCEPTION 'paid event booking requires canonical purchase aggregate'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.purchase_id IS NOT NULL THEN
    SELECT truck_id, host_id, settlement_topology
      INTO aggregate
      FROM parking_pass_purchases
     WHERE id = NEW.purchase_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parking Pass purchase aggregate not found'
        USING ERRCODE = '23503';
    END IF;
    IF aggregate.truck_id IS DISTINCT FROM NEW.truck_id
       OR aggregate.host_id IS DISTINCT FROM NEW.host_id
       OR aggregate.settlement_topology IS DISTINCT FROM 'destination_charge'
       OR NEW.settlement_topology IS DISTINCT FROM 'destination_charge' THEN
      RAISE EXCEPTION 'Parking Pass allocation does not match destination purchase authority'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_paid_parking_pass_booking ON event_bookings;
CREATE TRIGGER trigger_guard_paid_parking_pass_booking
BEFORE INSERT OR UPDATE OF purchase_id, event_id, truck_id, host_id, settlement_topology, status
ON event_bookings
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_paid_parking_pass_booking();

-- Granting ordering authority requires one current pending request at the exact
-- pre-update authority revision. Revocation remains available without a request.
CREATE OR REPLACE FUNCTION mealscout_guard_ordering_approval_request()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ordering_approved_at IS NOT NULL
     AND (
       NEW.ordering_approved_at IS DISTINCT FROM OLD.ordering_approved_at
       OR NEW.ordering_approved_by_user_id IS DISTINCT FROM OLD.ordering_approved_by_user_id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM ordering_review_requests request
        WHERE request.restaurant_id = NEW.id
          AND request.status = 'pending'
          AND request.submitted_authority_version = OLD.ordering_authority_version
          AND request.reviewer_user_id = NEW.ordering_approved_by_user_id
           AND request.requester_user_id IS DISTINCT FROM request.reviewer_user_id
           AND request.reviewed_at IS NOT NULL
           AND length(trim(coalesce(request.review_note, ''))) >= 10
          AND EXISTS (
            SELECT 1
              FROM users reviewer
             WHERE reviewer.id = request.reviewer_user_id
               AND reviewer.user_type IN ('staff', 'admin', 'duper_admin', 'super_admin')
               AND coalesce(reviewer.is_disabled, false) = false
          )
      ) THEN
    RAISE EXCEPTION 'ordering approval requires a current pending review request'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_ordering_approval_request ON restaurants;
CREATE TRIGGER trigger_guard_ordering_approval_request
BEFORE UPDATE OF ordering_approved_at, ordering_approved_by_user_id
ON restaurants
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_ordering_approval_request();

COMMENT ON TABLE parking_pass_purchases IS
  'Canonical one-PaymentIntent aggregate for new destination-charge Parking Pass purchases.';
COMMENT ON TABLE parking_pass_credit_ledger IS
  'Non-cash credits restricted to future Parking Pass platform-fee allocations.';
COMMENT ON TABLE parking_pass_arrival_versions IS
  'Protected append-only booked-party arrival truth; never an anonymous map projection.';

-- Event/series corrections and cancellations freeze their complete target set
-- before suppressing admission, public projection, ordering, or fulfillment.
-- These columns are intentionally understood by the runtime barrier as well as
-- by the saga so an older binary cannot reopen participation mid-mutation.
ALTER TABLE event_series
  ADD COLUMN IF NOT EXISTS participation_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_participation_mutation_id VARCHAR,
  ADD COLUMN IF NOT EXISTS participation_suppressed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS participation_suppression_reason TEXT;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS participation_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_participation_mutation_id VARCHAR,
  ADD COLUMN IF NOT EXISTS participation_suppressed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS participation_suppression_reason TEXT;

ALTER TABLE event_bookings
  ADD COLUMN IF NOT EXISTS event_participation_version INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_event_mutation_id VARCHAR,
  ADD COLUMN IF NOT EXISTS participation_visibility_state VARCHAR NOT NULL DEFAULT 'eligible';

CREATE TABLE IF NOT EXISTS event_participation_mutations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_kind VARCHAR NOT NULL CHECK (scope_kind IN ('event', 'series')),
  event_id VARCHAR REFERENCES events(id) ON DELETE RESTRICT,
  series_id VARCHAR REFERENCES event_series(id) ON DELETE RESTRICT,
  mutation_kind VARCHAR NOT NULL CHECK (mutation_kind IN ('correction', 'cancellation')),
  request_id VARCHAR NOT NULL,
  idempotency_key VARCHAR NOT NULL UNIQUE,
  request_digest VARCHAR NOT NULL,
  actor_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_type VARCHAR NOT NULL,
  authority_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  expected_participation_version INTEGER NOT NULL DEFAULT 0
    CHECK (expected_participation_version >= 0),
  target_event_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_booking_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_set_digest VARCHAR NOT NULL,
  expected_child_count INTEGER NOT NULL CHECK (expected_child_count > 0),
  provider_required_count INTEGER NOT NULL DEFAULT 0
    CHECK (provider_required_count >= 0),
  requested_changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared', 'suppressed', 'processing', 'action_required',
    'converged', 'failed'
  )),
  suppression_reason TEXT NOT NULL,
  converged_child_count INTEGER NOT NULL DEFAULT 0
    CHECK (converged_child_count >= 0),
  failure_code VARCHAR,
  failure_message TEXT,
  recovery_requested_at TIMESTAMP,
  recovery_claimed_at TIMESTAMP,
  recovery_claimed_by VARCHAR,
  recovery_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (recovery_attempt_count >= 0),
  last_recovery_actor_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  last_recovery_actor_type VARCHAR,
  last_recovery_reason TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT ck_event_participation_mutation_scope CHECK (
    (scope_kind = 'event' AND event_id IS NOT NULL AND series_id IS NULL)
    OR (scope_kind = 'series' AND series_id IS NOT NULL AND event_id IS NULL)
  )
);

ALTER TABLE event_participation_mutations
  ADD COLUMN IF NOT EXISTS recovery_requested_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS recovery_claimed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS recovery_claimed_by VARCHAR,
  ADD COLUMN IF NOT EXISTS recovery_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_recovery_actor_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_recovery_actor_type VARCHAR,
  ADD COLUMN IF NOT EXISTS last_recovery_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_participation_mutation_event_request
  ON event_participation_mutations (event_id, request_id)
  WHERE scope_kind = 'event';
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_participation_mutation_series_request
  ON event_participation_mutations (series_id, request_id)
  WHERE scope_kind = 'series';
CREATE INDEX IF NOT EXISTS idx_event_participation_mutation_recovery
  ON event_participation_mutations (
    status, recovery_requested_at, updated_at
  );
CREATE INDEX IF NOT EXISTS idx_event_participation_mutation_recovery_wake
  ON event_participation_mutations (
    recovery_requested_at, recovery_claimed_at, updated_at
  )
  WHERE status NOT IN ('converged', 'failed');
CREATE INDEX IF NOT EXISTS idx_event_participation_mutation_event
  ON event_participation_mutations (event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_event_participation_mutation_series
  ON event_participation_mutations (series_id, created_at);

CREATE TABLE IF NOT EXISTS event_participation_mutation_children (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  mutation_id VARCHAR NOT NULL
    REFERENCES event_participation_mutations(id) ON DELETE RESTRICT,
  event_id VARCHAR REFERENCES events(id) ON DELETE RESTRICT,
  booking_id VARCHAR REFERENCES event_bookings(id) ON DELETE RESTRICT,
  purchase_id VARCHAR REFERENCES parking_pass_purchases(id) ON DELETE RESTRICT,
  child_kind VARCHAR NOT NULL CHECK (child_kind IN (
    'series_apply', 'event_apply', 'booking_cancel', 'arrival_correct', 'notification',
    'free_participation_cancel', 'legacy_paid_action_required'
  )),
  action_key VARCHAR NOT NULL,
  idempotency_key VARCHAR NOT NULL UNIQUE,
  request_digest VARCHAR NOT NULL,
  target_participation_version INTEGER NOT NULL DEFAULT 0
    CHECK (target_participation_version >= 0),
  target_facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  remedy VARCHAR,
  provider_required BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared', 'processing', 'provider_confirmed', 'notification_pending',
    'converged', 'action_required', 'skipped'
  )),
  cancellation_operation_id VARCHAR
    REFERENCES parking_pass_cancellation_operations(id) ON DELETE RESTRICT,
  arrival_version_id VARCHAR
    REFERENCES parking_pass_arrival_versions(id) ON DELETE RESTRICT,
  notification_target_user_id VARCHAR REFERENCES users(id) ON DELETE RESTRICT,
  notification_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  notification_delivery_state VARCHAR NOT NULL DEFAULT 'prepared'
    CONSTRAINT ck_event_mutation_notification_delivery_state CHECK (
    notification_delivery_state IN (
      'prepared', 'submitted', 'retry_safe', 'ambiguous',
      'provider_confirmed', 'not_required'
    )
  ),
  notification_claim_id VARCHAR,
  notification_claimed_at TIMESTAMP,
  notification_submitted_at TIMESTAMP,
  notification_provider_message_id VARCHAR,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at TIMESTAMP,
  provider_status VARCHAR,
  failure_code VARCHAR,
  failure_message TEXT,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_event_participation_mutation_child_action
    UNIQUE (mutation_id, action_key)
);

ALTER TABLE event_participation_mutation_children
  ADD COLUMN IF NOT EXISTS notification_delivery_state VARCHAR NOT NULL DEFAULT 'prepared',
  ADD COLUMN IF NOT EXISTS notification_claim_id VARCHAR,
  ADD COLUMN IF NOT EXISTS notification_claimed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS notification_submitted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS notification_provider_message_id VARCHAR;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_event_mutation_notification_delivery_state'
  ) THEN
    ALTER TABLE event_participation_mutation_children
      ADD CONSTRAINT ck_event_mutation_notification_delivery_state
      CHECK (notification_delivery_state IN (
        'prepared', 'submitted', 'retry_safe', 'ambiguous',
        'provider_confirmed', 'not_required'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_event_participation_mutation_child_recovery
  ON event_participation_mutation_children (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_event_participation_mutation_child_booking
  ON event_participation_mutation_children (booking_id, created_at);

CREATE INDEX IF NOT EXISTS idx_event_series_active_mutation
  ON event_series (active_participation_mutation_id)
  WHERE active_participation_mutation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_active_mutation
  ON events (active_participation_mutation_id)
  WHERE active_participation_mutation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_active_event_mutation
  ON event_bookings (active_event_mutation_id)
  WHERE active_event_mutation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_participation_visibility
  ON event_bookings (participation_visibility_state, event_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_event_booking_participation_visibility'
  ) THEN
    ALTER TABLE event_bookings
      ADD CONSTRAINT ck_event_booking_participation_visibility
      CHECK (participation_visibility_state IN (
        'eligible', 'suppressed', 'action_required'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_event_series_active_participation_mutation'
  ) THEN
    ALTER TABLE event_series
      ADD CONSTRAINT fk_event_series_active_participation_mutation
      FOREIGN KEY (active_participation_mutation_id)
      REFERENCES event_participation_mutations(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_event_active_participation_mutation'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT fk_event_active_participation_mutation
      FOREIGN KEY (active_participation_mutation_id)
      REFERENCES event_participation_mutations(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_event_booking_active_event_mutation'
  ) THEN
    ALTER TABLE event_bookings
      ADD CONSTRAINT fk_event_booking_active_event_mutation
      FOREIGN KEY (active_event_mutation_id)
      REFERENCES event_participation_mutations(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION mealscout_guard_event_mutation_identity()
RETURNS TRIGGER AS $$
DECLARE
  sorted_events JSONB;
  sorted_bookings JSONB;
  event_count INTEGER;
  booking_count INTEGER;
  child_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'event participation mutation facts are append-only'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
    OR NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.series_id IS DISTINCT FROM OLD.series_id
    OR NEW.mutation_kind IS DISTINCT FROM OLD.mutation_kind
    OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
    OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
    OR NEW.actor_type IS DISTINCT FROM OLD.actor_type
    OR NEW.authority_snapshot IS DISTINCT FROM OLD.authority_snapshot
    OR NEW.expected_participation_version IS DISTINCT FROM OLD.expected_participation_version
    OR NEW.target_event_ids IS DISTINCT FROM OLD.target_event_ids
    OR NEW.target_booking_ids IS DISTINCT FROM OLD.target_booking_ids
    OR NEW.target_set_digest IS DISTINCT FROM OLD.target_set_digest
    OR NEW.expected_child_count IS DISTINCT FROM OLD.expected_child_count
    OR NEW.provider_required_count IS DISTINCT FROM OLD.provider_required_count
    OR NEW.requested_changes IS DISTINCT FROM OLD.requested_changes
    OR NEW.suppression_reason IS DISTINCT FROM OLD.suppression_reason
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'event participation mutation target and authority facts are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(NEW.target_event_ids) <> 'array'
     OR jsonb_typeof(NEW.target_booking_ids) <> 'array' THEN
    RAISE EXCEPTION 'event participation mutation targets must be arrays'
      USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb), count(*)
    INTO sorted_events, event_count
    FROM jsonb_array_elements_text(NEW.target_event_ids);
  SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb), count(*)
    INTO sorted_bookings, booking_count
    FROM jsonb_array_elements_text(NEW.target_booking_ids);
  IF sorted_events IS DISTINCT FROM NEW.target_event_ids
     OR sorted_bookings IS DISTINCT FROM NEW.target_booking_ids
     OR (SELECT count(DISTINCT value)
           FROM jsonb_array_elements_text(NEW.target_event_ids)) <> event_count
     OR (SELECT count(DISTINCT value)
           FROM jsonb_array_elements_text(NEW.target_booking_ids)) <> booking_count
  THEN
    RAISE EXCEPTION 'event participation mutation targets must be sorted and unique'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.scope_kind = 'event' AND (
    event_count <> 1 OR NEW.target_event_ids->>0 IS DISTINCT FROM NEW.event_id
  ) THEN
    RAISE EXCEPTION 'event mutation target set does not match its event'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.scope_kind = 'series' AND EXISTS (
    SELECT 1
      FROM jsonb_array_elements_text(NEW.target_event_ids) target(value)
      LEFT JOIN events event ON event.id = target.value
     WHERE event.id IS NULL OR event.series_id IS DISTINCT FROM NEW.series_id
  ) THEN
    RAISE EXCEPTION 'series mutation contains an event outside the frozen series'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements_text(NEW.target_booking_ids) target(value)
      LEFT JOIN event_bookings booking ON booking.id = target.value
     WHERE booking.id IS NULL
        OR NOT (NEW.target_event_ids ? booking.event_id)
  ) THEN
    RAISE EXCEPTION 'event mutation contains a booking outside the frozen event set'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> 'prepared' THEN
    SELECT count(*)::INTEGER INTO child_count
      FROM event_participation_mutation_children child
     WHERE child.mutation_id = NEW.id;
    IF child_count IS DISTINCT FROM NEW.expected_child_count THEN
      RAISE EXCEPTION 'event mutation child set is incomplete'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('converged', 'failed')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'terminal event mutation state cannot be reopened'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_event_mutation_identity
  ON event_participation_mutations;
CREATE TRIGGER trigger_guard_event_mutation_identity
BEFORE INSERT OR UPDATE OR DELETE ON event_participation_mutations
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_event_mutation_identity();

CREATE OR REPLACE FUNCTION mealscout_guard_event_mutation_child_identity()
RETURNS TRIGGER AS $$
DECLARE
  parent RECORD;
  booking RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'event mutation child set is append-only'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO parent
    FROM event_participation_mutations
   WHERE id = NEW.mutation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event mutation parent is missing' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'INSERT' AND parent.status <> 'prepared' THEN
    RAISE EXCEPTION 'event mutation child set is already frozen'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.mutation_id IS DISTINCT FROM OLD.mutation_id
    OR NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.booking_id IS DISTINCT FROM OLD.booking_id
    OR NEW.purchase_id IS DISTINCT FROM OLD.purchase_id
    OR NEW.child_kind IS DISTINCT FROM OLD.child_kind
    OR NEW.action_key IS DISTINCT FROM OLD.action_key
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
    OR NEW.target_participation_version IS DISTINCT FROM OLD.target_participation_version
    OR NEW.target_facts IS DISTINCT FROM OLD.target_facts
    OR NEW.remedy IS DISTINCT FROM OLD.remedy
    OR NEW.provider_required IS DISTINCT FROM OLD.provider_required
    OR NEW.notification_target_user_id IS DISTINCT FROM OLD.notification_target_user_id
    OR NEW.notification_payload IS DISTINCT FROM OLD.notification_payload
    OR (
      OLD.notification_provider_message_id IS NOT NULL
      AND NEW.notification_provider_message_id IS DISTINCT FROM OLD.notification_provider_message_id
    )
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'event mutation child identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.notification_delivery_state = 'provider_confirmed'
     AND NEW.notification_delivery_state IS DISTINCT FROM OLD.notification_delivery_state THEN
    RAISE EXCEPTION 'provider-confirmed notification delivery is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.event_id IS NOT NULL AND NOT (parent.target_event_ids ? NEW.event_id) THEN
    RAISE EXCEPTION 'event mutation child event is outside the frozen target set'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.child_kind = 'series_apply' AND (
    parent.scope_kind <> 'series' OR NEW.event_id IS NOT NULL OR NEW.booking_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'series apply child must target only its parent series'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.child_kind <> 'series_apply' AND NEW.event_id IS NULL THEN
    RAISE EXCEPTION 'event mutation child requires an event target'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.booking_id IS NOT NULL THEN
    SELECT event_id, purchase_id INTO booking
      FROM event_bookings WHERE id = NEW.booking_id;
    IF NOT FOUND
       OR booking.event_id IS DISTINCT FROM NEW.event_id
       OR booking.purchase_id IS DISTINCT FROM NEW.purchase_id
       OR NOT (parent.target_booking_ids ? NEW.booking_id) THEN
      RAISE EXCEPTION 'event mutation child booking identity mismatch'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.purchase_id IS NOT NULL THEN
    RAISE EXCEPTION 'event mutation purchase requires a booking target'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.child_kind IN (
    'booking_cancel', 'arrival_correct', 'free_participation_cancel',
    'legacy_paid_action_required', 'notification'
  ) AND NEW.booking_id IS NULL THEN
    RAISE EXCEPTION 'booking mutation child requires a booking target'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_event_mutation_child_identity
  ON event_participation_mutation_children;
CREATE TRIGGER trigger_guard_event_mutation_child_identity
BEFORE INSERT OR UPDATE OR DELETE ON event_participation_mutation_children
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_event_mutation_child_identity();

CREATE OR REPLACE FUNCTION mealscout_guard_event_mutation_barrier()
RETURNS TRIGGER AS $$
DECLARE
  mutation RECORD;
  event_row RECORD;
  row_json JSONB;
  old_json JSONB;
  row_id VARCHAR;
  active_mutation_id VARCHAR;
  booking_event_id VARCHAR;
  booking_status VARCHAR;
  old_booking_status VARCHAR;
  booking_visibility VARCHAR;
  booking_version INTEGER;
  series_active_mutation_id VARCHAR;
  material_supply_change BOOLEAN := false;
  has_live_participation BOOLEAN := false;
  proof_mutation_id VARCHAR;
  session_mutation_id VARCHAR;
BEGIN
  row_json := to_jsonb(NEW);
  old_json := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  row_id := row_json->>'id';
  active_mutation_id := CASE
    WHEN TG_TABLE_NAME = 'event_bookings' THEN row_json->>'active_event_mutation_id'
    ELSE row_json->>'active_participation_mutation_id'
  END;

  IF TG_TABLE_NAME = 'event_series' AND active_mutation_id IS NOT NULL THEN
    SELECT * INTO mutation FROM event_participation_mutations
     WHERE id = active_mutation_id;
    IF NOT FOUND OR mutation.scope_kind <> 'series'
       OR mutation.series_id IS DISTINCT FROM row_id
       OR mutation.status IN ('converged', 'failed') THEN
      RAISE EXCEPTION 'invalid active series participation mutation'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'events' AND active_mutation_id IS NOT NULL THEN
    SELECT * INTO mutation FROM event_participation_mutations
     WHERE id = active_mutation_id;
    IF NOT FOUND OR NOT (mutation.target_event_ids ? row_id)
       OR mutation.status IN ('converged', 'failed') THEN
      RAISE EXCEPTION 'invalid active event participation mutation'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'event_bookings' AND active_mutation_id IS NOT NULL THEN
    SELECT mutation_parent.*, child.id AS child_id INTO mutation
      FROM event_participation_mutations mutation_parent
      JOIN event_participation_mutation_children child
        ON child.mutation_id = mutation_parent.id
       AND child.booking_id = row_id
     WHERE mutation_parent.id = active_mutation_id
     LIMIT 1;
    IF NOT FOUND OR mutation.status IN ('converged', 'failed') THEN
      RAISE EXCEPTION 'invalid active booking participation mutation'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Material supply facts cannot be changed underneath a pending or confirmed
  -- participant. The durable saga first freezes an immutable target set and
  -- then supplies the exact parent id as a transaction-local proof while it
  -- applies the stored changes. An old/direct runtime has neither an active
  -- parent nor that proof and therefore cannot close, move, resize, reprice,
  -- reassociate, or re-authorize live supply behind the saga.
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'events' THEN
    material_supply_change :=
      old_json->'host_id' IS DISTINCT FROM row_json->'host_id'
      OR old_json->'coordinator_user_id' IS DISTINCT FROM row_json->'coordinator_user_id'
      OR old_json->'series_id' IS DISTINCT FROM row_json->'series_id'
      OR old_json->'event_type' IS DISTINCT FROM row_json->'event_type'
      OR old_json->'date' IS DISTINCT FROM row_json->'date'
      OR old_json->'start_time' IS DISTINCT FROM row_json->'start_time'
      OR old_json->'end_time' IS DISTINCT FROM row_json->'end_time'
      OR old_json->'max_trucks' IS DISTINCT FROM row_json->'max_trucks'
      OR old_json->'hard_cap_enabled' IS DISTINCT FROM row_json->'hard_cap_enabled'
      OR old_json->'status' IS DISTINCT FROM row_json->'status'
      OR old_json->'requires_payment' IS DISTINCT FROM row_json->'requires_payment'
      OR old_json->'host_price_cents' IS DISTINCT FROM row_json->'host_price_cents'
      OR old_json->'breakfast_price_cents' IS DISTINCT FROM row_json->'breakfast_price_cents'
      OR old_json->'lunch_price_cents' IS DISTINCT FROM row_json->'lunch_price_cents'
      OR old_json->'dinner_price_cents' IS DISTINCT FROM row_json->'dinner_price_cents'
      OR old_json->'daily_price_cents' IS DISTINCT FROM row_json->'daily_price_cents'
      OR old_json->'weekly_price_cents' IS DISTINCT FROM row_json->'weekly_price_cents'
      OR old_json->'monthly_price_cents' IS DISTINCT FROM row_json->'monthly_price_cents';
    IF material_supply_change THEN
      SELECT EXISTS (
        SELECT 1 FROM event_bookings booking
         WHERE booking.event_id = row_id
           AND booking.status IN ('pending', 'confirmed')
      ) INTO has_live_participation;
      IF has_live_participation THEN
        proof_mutation_id := coalesce(
          row_json->>'active_participation_mutation_id',
          old_json->>'active_participation_mutation_id'
        );
        session_mutation_id := current_setting(
          'mealscout.event_participation_mutation_id', true
        );
        IF proof_mutation_id IS NULL
           OR session_mutation_id IS DISTINCT FROM proof_mutation_id
           OR NOT EXISTS (
             SELECT 1
               FROM event_participation_mutations parent
               JOIN event_participation_mutation_children child
                 ON child.mutation_id = parent.id
                AND child.child_kind = 'event_apply'
                AND child.event_id = row_id
              WHERE parent.id = proof_mutation_id
                AND parent.target_event_ids ? row_id
                AND parent.status NOT IN ('converged', 'failed')
           ) THEN
          RAISE EXCEPTION 'material event supply change requires canonical participation saga proof'
            USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'event_series' THEN
    material_supply_change :=
      old_json->'host_id' IS DISTINCT FROM row_json->'host_id'
      OR old_json->'coordinator_user_id' IS DISTINCT FROM row_json->'coordinator_user_id'
      OR old_json->'series_type' IS DISTINCT FROM row_json->'series_type'
      OR old_json->'timezone' IS DISTINCT FROM row_json->'timezone'
      OR old_json->'recurrence_rule' IS DISTINCT FROM row_json->'recurrence_rule'
      OR old_json->'start_date' IS DISTINCT FROM row_json->'start_date'
      OR old_json->'end_date' IS DISTINCT FROM row_json->'end_date'
      OR old_json->'default_start_time' IS DISTINCT FROM row_json->'default_start_time'
      OR old_json->'default_end_time' IS DISTINCT FROM row_json->'default_end_time'
      OR old_json->'default_max_trucks' IS DISTINCT FROM row_json->'default_max_trucks'
      OR old_json->'default_hard_cap_enabled' IS DISTINCT FROM row_json->'default_hard_cap_enabled'
      OR old_json->'parking_pass_days_of_week' IS DISTINCT FROM row_json->'parking_pass_days_of_week'
      OR old_json->'default_host_price_cents' IS DISTINCT FROM row_json->'default_host_price_cents'
      OR old_json->'default_breakfast_price_cents' IS DISTINCT FROM row_json->'default_breakfast_price_cents'
      OR old_json->'default_lunch_price_cents' IS DISTINCT FROM row_json->'default_lunch_price_cents'
      OR old_json->'default_dinner_price_cents' IS DISTINCT FROM row_json->'default_dinner_price_cents'
      OR old_json->'default_daily_price_cents' IS DISTINCT FROM row_json->'default_daily_price_cents'
      OR old_json->'default_weekly_price_cents' IS DISTINCT FROM row_json->'default_weekly_price_cents'
      OR old_json->'default_monthly_price_cents' IS DISTINCT FROM row_json->'default_monthly_price_cents'
      OR old_json->'status' IS DISTINCT FROM row_json->'status'
      OR old_json->'published_at' IS DISTINCT FROM row_json->'published_at';
    IF material_supply_change THEN
      SELECT EXISTS (
        SELECT 1
          FROM events event
          JOIN event_bookings booking ON booking.event_id = event.id
         WHERE event.series_id = row_id
           AND booking.status IN ('pending', 'confirmed')
      ) INTO has_live_participation;
      IF has_live_participation THEN
        proof_mutation_id := coalesce(
          row_json->>'active_participation_mutation_id',
          old_json->>'active_participation_mutation_id'
        );
        session_mutation_id := current_setting(
          'mealscout.event_participation_mutation_id', true
        );
        IF proof_mutation_id IS NULL
           OR session_mutation_id IS DISTINCT FROM proof_mutation_id
           OR NOT EXISTS (
             SELECT 1
               FROM event_participation_mutations parent
               JOIN event_participation_mutation_children child
                 ON child.mutation_id = parent.id
                AND child.child_kind = 'series_apply'
              WHERE parent.id = proof_mutation_id
                AND parent.scope_kind = 'series'
                AND parent.series_id = row_id
                AND parent.status NOT IN ('converged', 'failed')
           ) THEN
          RAISE EXCEPTION 'material series supply change requires canonical participation saga proof'
            USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'events'
     AND row_json->>'series_id' IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR old_json->>'series_id' IS DISTINCT FROM row_json->>'series_id') THEN
    SELECT active_participation_mutation_id INTO series_active_mutation_id
      FROM event_series WHERE id = row_json->>'series_id';
    IF series_active_mutation_id IS NOT NULL THEN
      RAISE EXCEPTION 'event series is suppressed by an active participation mutation'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'event_bookings' THEN
    booking_event_id := row_json->>'event_id';
    booking_status := row_json->>'status';
    old_booking_status := old_json->>'status';
    booking_visibility := row_json->>'participation_visibility_state';
    booking_version := (row_json->>'event_participation_version')::INTEGER;
    SELECT event.active_participation_mutation_id,
           event.participation_version,
           series.active_participation_mutation_id AS series_active_mutation_id
      INTO event_row
      FROM events event
      LEFT JOIN event_series series ON series.id = event.series_id
     WHERE event.id = booking_event_id;
    IF TG_OP = 'INSERT' AND (
      event_row.active_participation_mutation_id IS NOT NULL
      OR event_row.series_active_mutation_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'event participation is suppressed by an active mutation'
        USING ERRCODE = '23514';
    END IF;
    IF booking_status = 'confirmed'
       AND (TG_OP = 'INSERT' OR old_booking_status IS DISTINCT FROM 'confirmed')
       AND (
         event_row.active_participation_mutation_id IS NOT NULL
         OR event_row.series_active_mutation_id IS NOT NULL
         OR active_mutation_id IS NOT NULL
         OR booking_visibility <> 'eligible'
         OR booking_version IS DISTINCT FROM event_row.participation_version
       ) THEN
      RAISE EXCEPTION 'confirmation is stale or suppressed by an event mutation'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_event_series_mutation_barrier ON event_series;
CREATE TRIGGER trigger_guard_event_series_mutation_barrier
BEFORE INSERT OR UPDATE
ON event_series
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_event_mutation_barrier();

DROP TRIGGER IF EXISTS trigger_guard_event_mutation_barrier ON events;
CREATE TRIGGER trigger_guard_event_mutation_barrier
BEFORE INSERT OR UPDATE
ON events
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_event_mutation_barrier();

DROP TRIGGER IF EXISTS trigger_guard_booking_event_mutation_barrier ON event_bookings;
CREATE TRIGGER trigger_guard_booking_event_mutation_barrier
BEFORE INSERT OR UPDATE OF
  event_id, status, event_participation_version, active_event_mutation_id,
  participation_visibility_state
ON event_bookings
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_event_mutation_barrier();

-- Purchased paid-line identities are immutable. Status and money transitions
-- require durable provider/cancellation evidence, including when an old binary
-- tries to finalize locally after this migration has been applied.
CREATE OR REPLACE FUNCTION mealscout_guard_purchased_paid_line_transition()
RETURNS TRIGGER AS $$
DECLARE
  event_row RECORD;
  purchase RECORD;
  has_create_binding BOOLEAN;
  has_cancellation_proof BOOLEAN;
  has_dispute_proof BOOLEAN;
  has_blackout BOOLEAN;
BEGIN
  IF NEW.purchase_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO purchase FROM parking_pass_purchases WHERE id = NEW.purchase_id;
  SELECT * INTO event_row FROM events WHERE id = NEW.event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchased event line has no event' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.purchase_id IS DISTINCT FROM OLD.purchase_id
    OR NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.truck_id IS DISTINCT FROM OLD.truck_id
    OR NEW.host_id IS DISTINCT FROM OLD.host_id
    OR NEW.allocation_ordinal IS DISTINCT FROM OLD.allocation_ordinal
    OR NEW.allocation_digest IS DISTINCT FROM OLD.allocation_digest
    OR NEW.host_price_cents IS DISTINCT FROM OLD.host_price_cents
    OR NEW.platform_fee_cents IS DISTINCT FROM OLD.platform_fee_cents
    OR NEW.credit_applied_cents IS DISTINCT FROM OLD.credit_applied_cents
    OR NEW.total_cents IS DISTINCT FROM OLD.total_cents
    OR NEW.settlement_topology IS DISTINCT FROM OLD.settlement_topology
  ) THEN
    RAISE EXCEPTION 'purchased paid-line financial identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    (OLD.status = 'confirmed' AND NEW.status = 'pending')
    OR (OLD.status IN ('cancelled', 'refunded')
        AND NEW.status IS DISTINCT FROM OLD.status)
  ) THEN
    RAISE EXCEPTION 'purchased paid-line terminal or confirmed state cannot be reopened'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'confirmed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed') THEN
    has_blackout := false;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'events' AND column_name = 'date'
    ) THEN
      EXECUTE $blackout$
        SELECT EXISTS (
          SELECT 1
            FROM events event_row
            JOIN event_series series ON series.id = event_row.series_id
            JOIN parking_pass_blackout_dates blackout
              ON blackout.series_id = series.id
             AND blackout.date = event_row.date
           WHERE event_row.id = $1
             AND series.series_type = 'parking_pass'
        )
      $blackout$ INTO has_blackout USING NEW.event_id;
    END IF;
    IF has_blackout THEN
      RAISE EXCEPTION 'blocked Parking Pass date cannot be confirmed'
        USING ERRCODE = '23514';
    END IF;
    SELECT EXISTS (
      SELECT 1
        FROM parking_pass_provider_operations operation
        JOIN parking_pass_provider_operation_steps bind_step
          ON bind_step.operation_id = operation.id
         AND bind_step.step_type = 'payment_intent_bind'
         AND bind_step.status = 'provider_confirmed'
       WHERE operation.purchase_id = NEW.purchase_id
         AND operation.operation_kind = 'payment_intent_create'
         AND operation.status = 'provider_confirmed'
         AND operation.provider_payment_intent_id = NEW.stripe_payment_intent_id
         AND operation.expected_amount_cents = purchase.charged_amount_cents
         AND operation.expected_currency = purchase.currency
         AND operation.expected_destination_account_id = purchase.stripe_destination_account_id
         AND operation.allocation_digest = purchase.allocation_digest
    ) INTO has_create_binding;
    IF NOT has_create_binding THEN
      RAISE EXCEPTION 'paid-line confirmation requires provider-bound purchase proof'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    (NEW.status IN ('cancelled', 'refunded') AND OLD.status IS DISTINCT FROM NEW.status)
    OR NEW.cash_refunded_cents IS DISTINCT FROM OLD.cash_refunded_cents
    OR NEW.host_transfer_reversed_cents IS DISTINCT FROM OLD.host_transfer_reversed_cents
    OR NEW.application_fee_refunded_cents IS DISTINCT FROM OLD.application_fee_refunded_cents
    OR NEW.restored_credit_cents IS DISTINCT FROM OLD.restored_credit_cents
    OR NEW.refund_amount_cents IS DISTINCT FROM OLD.refund_amount_cents
  ) THEN
    SELECT EXISTS (
      SELECT 1
        FROM parking_pass_cancellation_operations cancellation
       WHERE cancellation.purchase_id = NEW.purchase_id
         AND cancellation.booking_line_ids ? NEW.id
         AND (
           (cancellation.remedy = 'none'
             AND cancellation.status IN ('processing', 'no_remedy'))
           OR (cancellation.remedy = 'restricted_credit' AND EXISTS (
             SELECT 1 FROM parking_pass_credit_ledger credit
              WHERE credit.operation_id = cancellation.id
                AND credit.booking_id = NEW.id
                AND credit.state = 'posted'
           ))
           OR (cancellation.remedy = 'release' AND EXISTS (
             SELECT 1
               FROM parking_pass_provider_operations provider_operation
               JOIN parking_pass_provider_operation_steps cancel_step
                 ON cancel_step.operation_id = provider_operation.id
                AND cancel_step.step_type = 'payment_intent_cancel'
                AND cancel_step.status = 'provider_confirmed'
              WHERE provider_operation.cancellation_operation_id = cancellation.id
                AND provider_operation.purchase_id = NEW.purchase_id
                AND provider_operation.operation_kind = 'payment_intent_cancel'
                AND provider_operation.status = 'provider_confirmed'
                AND provider_operation.request_digest = cancellation.request_digest
                AND provider_operation.allocation_digest = cancellation.allocation_digest
                AND provider_operation.sorted_line_ids ? NEW.id
           ))
           OR (cancellation.remedy = 'cash_refund' AND EXISTS (
             SELECT 1
               FROM parking_pass_provider_operations provider_operation
              WHERE provider_operation.cancellation_operation_id = cancellation.id
                AND provider_operation.purchase_id = NEW.purchase_id
                AND provider_operation.operation_kind = 'selected_line_refund'
                AND provider_operation.status = 'provider_confirmed'
                AND provider_operation.request_digest = cancellation.request_digest
                AND provider_operation.allocation_digest = cancellation.allocation_digest
                AND provider_operation.sorted_line_ids ? NEW.id
                AND provider_operation.expected_amount_cents
                      = cancellation.expected_cash_refund_cents
                AND provider_operation.expected_host_amount_cents
                      = cancellation.expected_host_reversal_cents
                AND provider_operation.expected_application_fee_cents
                      = cancellation.expected_application_fee_refund_cents
                AND EXISTS (
                  SELECT 1 FROM parking_pass_provider_operation_steps cash_step
                   WHERE cash_step.operation_id = provider_operation.id
                     AND cash_step.step_type = 'cash_refund'
                     AND cash_step.status = 'provider_confirmed'
                     AND cash_step.expected_amount_cents
                           = cancellation.expected_cash_refund_cents
                     AND cash_step.provider_refund_id IS NOT NULL
                )
                AND EXISTS (
                  SELECT 1 FROM parking_pass_provider_operation_steps reversal_step
                   WHERE reversal_step.operation_id = provider_operation.id
                     AND reversal_step.step_type = 'transfer_reversal'
                     AND reversal_step.status = 'provider_confirmed'
                     AND reversal_step.expected_amount_cents
                           = cancellation.expected_cash_refund_cents
                     AND reversal_step.provider_transfer_reversal_id IS NOT NULL
                )
                AND (
                  cancellation.expected_application_fee_refund_cents = 0
                  OR EXISTS (
                    SELECT 1 FROM parking_pass_provider_operation_steps fee_step
                     WHERE fee_step.operation_id = provider_operation.id
                       AND fee_step.step_type = 'application_fee_refund'
                       AND fee_step.status = 'provider_confirmed'
                       AND fee_step.expected_amount_cents
                             = cancellation.expected_application_fee_refund_cents
                       AND fee_step.provider_application_fee_refund_id IS NOT NULL
                  )
                )
           ))
         )
    ) INTO has_cancellation_proof;
    IF NOT has_cancellation_proof
       AND NOT (
         purchase.status = 'payment_failed'
         AND purchase.provider_lifecycle_state = 'closed'
         AND NEW.stripe_payment_status = 'failed'
       ) THEN
      RAISE EXCEPTION 'paid-line cancellation/refund requires durable remedy proof'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.settlement_state IS DISTINCT FROM OLD.settlement_state
     AND NOT (
       NEW.settlement_state IN ('provider_confirmed', 'reversal_pending', 'action_required')
       AND (
         NEW.cash_refunded_cents IS DISTINCT FROM OLD.cash_refunded_cents
         OR NEW.host_transfer_reversed_cents IS DISTINCT FROM OLD.host_transfer_reversed_cents
         OR NEW.application_fee_refunded_cents IS DISTINCT FROM OLD.application_fee_refunded_cents
       )
     ) THEN
    SELECT EXISTS (
      SELECT 1 FROM parking_pass_provider_operations dispute_operation
       WHERE dispute_operation.purchase_id = NEW.purchase_id
         AND dispute_operation.operation_kind = 'dispute_reconcile'
         AND dispute_operation.provider_dispute_id IS NOT NULL
         AND dispute_operation.status IN ('processing', 'provider_confirmed')
    ) INTO has_dispute_proof;
    IF NOT has_dispute_proof
       AND NOT (OLD.settlement_state = 'unsettled'
                AND NEW.settlement_state = 'destination_settled') THEN
      RAISE EXCEPTION 'paid-line settlement transition requires provider proof'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_purchased_paid_line_transition
  ON event_bookings;
CREATE TRIGGER trigger_guard_purchased_paid_line_transition
BEFORE INSERT OR UPDATE OF
  purchase_id, event_id, truck_id, host_id, allocation_ordinal,
  allocation_digest, host_price_cents, platform_fee_cents, credit_applied_cents,
  total_cents, settlement_topology, status, stripe_payment_status,
  refund_amount_cents, cash_refunded_cents, host_transfer_reversed_cents,
  application_fee_refunded_cents, restored_credit_cents, settlement_state
ON event_bookings
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_purchased_paid_line_transition();

-- Historical platform-held payouts are separate from destination settlement
-- and get the same persist-before-provider and retention-safe recovery shape.
CREATE TABLE IF NOT EXISTS legacy_payout_provider_operations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_request_id VARCHAR NOT NULL
    REFERENCES host_payout_requests(id) ON DELETE RESTRICT,
  request_id VARCHAR NOT NULL,
  idempotency_key VARCHAR NOT NULL UNIQUE,
  request_digest VARCHAR NOT NULL,
  actor_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expected_host_id VARCHAR NOT NULL REFERENCES hosts(id) ON DELETE RESTRICT,
  expected_amount_cents INTEGER NOT NULL CHECK (expected_amount_cents > 0),
  expected_currency VARCHAR NOT NULL CHECK (expected_currency = 'usd'),
  expected_destination_account_id VARCHAR NOT NULL,
  expected_funding_topology VARCHAR NOT NULL
    CHECK (expected_funding_topology = 'legacy_platform_hold'),
  expected_eligible_amount_snapshot_cents INTEGER NOT NULL
    CHECK (expected_eligible_amount_snapshot_cents >= expected_amount_cents),
  status VARCHAR NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared', 'submitted', 'provider_confirmed',
    'action_required', 'quarantined'
  )),
  provider_transfer_id VARCHAR,
  provider_status VARCHAR,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  idempotency_expires_at TIMESTAMP NOT NULL,
  last_attempt_at TIMESTAMP,
  submitted_at TIMESTAMP,
  confirmed_at TIMESTAMP,
  provider_error_code VARCHAR,
  provider_error_message TEXT,
  recovery_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (recovery_attempt_count >= 0),
  last_recovery_actor_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  last_recovery_actor_type VARCHAR CHECK (
    last_recovery_actor_type IS NULL OR
    last_recovery_actor_type IN ('current_staff_takeover', 'system')
  ),
  last_recovery_reason TEXT,
  last_recovery_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_legacy_payout_provider_operation_request
    UNIQUE (payout_request_id, request_id)
);

ALTER TABLE legacy_payout_provider_operations
  ADD COLUMN IF NOT EXISTS recovery_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (recovery_attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS last_recovery_actor_user_id VARCHAR
    REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_recovery_actor_type VARCHAR CHECK (
    last_recovery_actor_type IS NULL OR
    last_recovery_actor_type IN ('current_staff_takeover', 'system')
  ),
  ADD COLUMN IF NOT EXISTS last_recovery_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_recovery_at TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS uq_legacy_payout_provider_operation_transfer
  ON legacy_payout_provider_operations (provider_transfer_id)
  WHERE provider_transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_legacy_payout_provider_operation_recovery
  ON legacy_payout_provider_operations (status, updated_at);

CREATE OR REPLACE FUNCTION mealscout_guard_legacy_payout_provider_operation()
RETURNS TRIGGER AS $$
DECLARE
  payout RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'legacy payout provider operations are append-only'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.payout_request_id IS DISTINCT FROM OLD.payout_request_id
    OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
    OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
    OR NEW.expected_host_id IS DISTINCT FROM OLD.expected_host_id
    OR NEW.expected_amount_cents IS DISTINCT FROM OLD.expected_amount_cents
    OR NEW.expected_currency IS DISTINCT FROM OLD.expected_currency
    OR NEW.expected_destination_account_id IS DISTINCT FROM OLD.expected_destination_account_id
    OR NEW.expected_funding_topology IS DISTINCT FROM OLD.expected_funding_topology
    OR NEW.expected_eligible_amount_snapshot_cents IS DISTINCT FROM OLD.expected_eligible_amount_snapshot_cents
    OR NEW.idempotency_expires_at IS DISTINCT FROM OLD.idempotency_expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.provider_transfer_id IS NOT NULL
        AND NEW.provider_transfer_id IS DISTINCT FROM OLD.provider_transfer_id)
  ) THEN
    RAISE EXCEPTION 'legacy payout provider financial identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO payout FROM host_payout_requests
   WHERE id = NEW.payout_request_id;
  IF NOT FOUND
     OR payout.host_id IS DISTINCT FROM NEW.expected_host_id
     OR payout.amount_cents IS DISTINCT FROM NEW.expected_amount_cents
     OR payout.funding_topology IS DISTINCT FROM NEW.expected_funding_topology
     OR payout.eligibility_state IS DISTINCT FROM 'eligible_legacy'
     OR payout.eligible_amount_snapshot_cents
          IS DISTINCT FROM NEW.expected_eligible_amount_snapshot_cents THEN
    RAISE EXCEPTION 'legacy payout operation does not match eligible request facts'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('provider_confirmed', 'quarantined')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'terminal legacy payout provider operation cannot be reopened'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'provider_confirmed'
     AND NEW.provider_transfer_id IS NULL THEN
    RAISE EXCEPTION 'legacy payout provider confirmation requires transfer identity'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_legacy_payout_provider_operation
  ON legacy_payout_provider_operations;
CREATE TRIGGER trigger_guard_legacy_payout_provider_operation
BEFORE INSERT OR UPDATE OR DELETE ON legacy_payout_provider_operations
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_legacy_payout_provider_operation();

CREATE OR REPLACE FUNCTION mealscout_guard_legacy_payout_provider_confirmation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM legacy_payout_provider_operations operation
     WHERE operation.payout_request_id = OLD.id
       AND operation.status <> 'quarantined'
  ) AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.host_id IS DISTINCT FROM OLD.host_id
    OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
    OR NEW.funding_topology IS DISTINCT FROM OLD.funding_topology
    OR NEW.eligibility_state IS DISTINCT FROM OLD.eligibility_state
    OR NEW.eligible_amount_snapshot_cents
         IS DISTINCT FROM OLD.eligible_amount_snapshot_cents
  ) THEN
    RAISE EXCEPTION 'payout request facts are immutable after provider operation preparation'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('paid', 'transferred_to_connect')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'provider-confirmed payout cannot be reopened'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.provider_transfer_id IS NOT NULL
     AND NEW.provider_transfer_id IS DISTINCT FROM OLD.provider_transfer_id THEN
    RAISE EXCEPTION 'payout provider transfer identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('paid', 'transferred_to_connect')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND NOT EXISTS (
       SELECT 1
         FROM legacy_payout_provider_operations operation
        WHERE operation.payout_request_id = NEW.id
          AND operation.status = 'provider_confirmed'
          AND operation.provider_transfer_id IS NOT NULL
          AND operation.provider_transfer_id = NEW.provider_transfer_id
          AND operation.expected_host_id = NEW.host_id
          AND operation.expected_amount_cents = NEW.amount_cents
          AND operation.expected_funding_topology = NEW.funding_topology
          AND operation.expected_eligible_amount_snapshot_cents
                = NEW.eligible_amount_snapshot_cents
     ) THEN
    RAISE EXCEPTION 'legacy payout completion requires exact provider operation proof'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_legacy_payout_provider_confirmation
  ON host_payout_requests;
CREATE TRIGGER trigger_guard_legacy_payout_provider_confirmation
BEFORE INSERT OR UPDATE OF
  status, provider_transfer_id, amount_cents, host_id, funding_topology,
  eligible_amount_snapshot_cents
ON host_payout_requests
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_legacy_payout_provider_confirmation();

COMMENT ON TABLE event_participation_mutations IS
  'Durable frozen-target event/series correction and cancellation saga.';
COMMENT ON TABLE event_participation_mutation_children IS
  'Immutable per-target remedies, corrections, and notification work for an event mutation.';
COMMENT ON TABLE legacy_payout_provider_operations IS
  'Persist-before-provider legacy platform-held payout transfer and recovery identity.';

-- Open-call publication is a persist-before-effects parent/fixed-child saga.
-- New occurrence rows remain private drafts until every frozen child exists;
-- the final event+series visibility transition is one guarded transaction.
ALTER TABLE event_series
  ADD COLUMN IF NOT EXISTS active_publication_operation_id VARCHAR,
  ADD COLUMN IF NOT EXISTS publication_suppressed_at TIMESTAMP;
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS publication_operation_id VARCHAR,
  ADD COLUMN IF NOT EXISTS publication_date_key VARCHAR,
  ADD COLUMN IF NOT EXISTS publication_payload_digest VARCHAR;

CREATE TABLE IF NOT EXISTS event_series_publication_operations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id VARCHAR NOT NULL REFERENCES event_series(id) ON DELETE RESTRICT,
  request_id VARCHAR NOT NULL,
  idempotency_key VARCHAR NOT NULL UNIQUE,
  request_digest VARCHAR NOT NULL,
  actor_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  authority_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  expected_participation_version INTEGER NOT NULL DEFAULT 0
    CHECK (expected_participation_version >= 0),
  target_date_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_set_digest VARCHAR NOT NULL,
  expected_child_count INTEGER NOT NULL CHECK (expected_child_count >= 0),
  status VARCHAR NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared', 'processing', 'finalizing', 'action_required', 'converged', 'failed'
  )),
  failure_code VARCHAR,
  failure_message TEXT,
  recovery_requested_at TIMESTAMP,
  recovery_claimed_at TIMESTAMP,
  recovery_claimed_by VARCHAR,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_event_series_publication_request UNIQUE (series_id, request_id),
  CONSTRAINT ck_event_series_publication_target_keys CHECK (
    jsonb_typeof(target_date_keys) = 'array'
    AND jsonb_array_length(target_date_keys) = expected_child_count
  )
);

CREATE TABLE IF NOT EXISTS event_series_publication_children (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id VARCHAR NOT NULL
    REFERENCES event_series_publication_operations(id) ON DELETE RESTRICT,
  series_id VARCHAR NOT NULL REFERENCES event_series(id) ON DELETE RESTRICT,
  expected_event_id VARCHAR NOT NULL,
  event_id VARCHAR REFERENCES events(id) ON DELETE RESTRICT,
  date_key VARCHAR NOT NULL CHECK (date_key ~ '^\d{4}-\d{2}-\d{2}$'),
  host_id VARCHAR NOT NULL REFERENCES hosts(id) ON DELETE RESTRICT,
  coordinator_user_id VARCHAR REFERENCES users(id) ON DELETE RESTRICT,
  name VARCHAR NOT NULL,
  description TEXT,
  start_time VARCHAR NOT NULL,
  end_time VARCHAR NOT NULL,
  max_trucks INTEGER NOT NULL CHECK (max_trucks > 0),
  hard_cap_enabled BOOLEAN NOT NULL,
  event_type VARCHAR NOT NULL,
  requires_payment BOOLEAN NOT NULL,
  payload_digest VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared', 'processing', 'converged', 'action_required'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  failure_code VARCHAR,
  failure_message TEXT,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_event_series_publication_child_date
    UNIQUE (operation_id, date_key),
  CONSTRAINT uq_event_series_occurrence_date UNIQUE (series_id, date_key),
  CONSTRAINT uq_event_series_publication_expected_event
    UNIQUE (expected_event_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_event_series_active_publication_operation'
  ) THEN
    ALTER TABLE event_series
      ADD CONSTRAINT fk_event_series_active_publication_operation
      FOREIGN KEY (active_publication_operation_id)
      REFERENCES event_series_publication_operations(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_event_publication_operation'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT fk_event_publication_operation
      FOREIGN KEY (publication_operation_id)
      REFERENCES event_series_publication_operations(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_event_series_active_publication
  ON event_series (active_publication_operation_id)
  WHERE active_publication_operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_series_publication_recovery
  ON event_series_publication_operations (
    status, recovery_requested_at, updated_at
  ) WHERE status NOT IN ('converged', 'failed');
CREATE INDEX IF NOT EXISTS idx_event_series_publication_child_recovery
  ON event_series_publication_children (status, updated_at)
  WHERE status <> 'converged';
CREATE INDEX IF NOT EXISTS idx_events_publication_operation
  ON events (publication_operation_id)
  WHERE publication_operation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION mealscout_guard_event_series_publication_operation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'event series publication operation is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.series_id IS DISTINCT FROM OLD.series_id
    OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
    OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
    OR NEW.authority_snapshot IS DISTINCT FROM OLD.authority_snapshot
    OR NEW.expected_participation_version IS DISTINCT FROM OLD.expected_participation_version
    OR NEW.target_date_keys IS DISTINCT FROM OLD.target_date_keys
    OR NEW.target_set_digest IS DISTINCT FROM OLD.target_set_digest
    OR NEW.expected_child_count IS DISTINCT FROM OLD.expected_child_count
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'event series publication scope is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('converged', 'failed')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'terminal event series publication cannot be reopened'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_event_series_publication_operation
  ON event_series_publication_operations;
CREATE TRIGGER trigger_guard_event_series_publication_operation
BEFORE INSERT OR UPDATE OR DELETE ON event_series_publication_operations
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_event_series_publication_operation();

CREATE OR REPLACE FUNCTION mealscout_publication_digest_part(input_value TEXT)
RETURNS TEXT AS $$
  SELECT CASE
    WHEN input_value IS NULL THEN '-1:'
    ELSE octet_length(convert_to(input_value, 'UTF8'))::text || ':' || input_value
  END
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION mealscout_publication_event_id(
  input_operation_id TEXT,
  input_date_key TEXT
)
RETURNS TEXT AS $$
  SELECT 'event-pub-' || substr(
    encode(
      sha256(convert_to(
        mealscout_publication_digest_part('event-series-publication-event-v1') ||
        mealscout_publication_digest_part(input_operation_id) ||
        mealscout_publication_digest_part(input_date_key),
        'UTF8'
      )),
      'hex'
    ),
    1,
    48
  )
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION mealscout_publication_payload_digest(
  input_operation_id TEXT,
  input_expected_event_id TEXT,
  input_host_id TEXT,
  input_coordinator_user_id TEXT,
  input_series_id TEXT,
  input_date_key TEXT,
  input_name TEXT,
  input_description TEXT,
  input_start_time TEXT,
  input_end_time TEXT,
  input_max_trucks INTEGER,
  input_hard_cap_enabled BOOLEAN,
  input_event_type TEXT,
  input_requires_payment BOOLEAN
)
RETURNS TEXT AS $$
  SELECT encode(
    sha256(convert_to(
      mealscout_publication_digest_part('event-series-publication-payload-v2') ||
      mealscout_publication_digest_part(input_operation_id) ||
      mealscout_publication_digest_part(input_expected_event_id) ||
      mealscout_publication_digest_part(input_host_id) ||
      mealscout_publication_digest_part(input_coordinator_user_id) ||
      mealscout_publication_digest_part(input_series_id) ||
      mealscout_publication_digest_part(input_date_key) ||
      mealscout_publication_digest_part(input_name) ||
      mealscout_publication_digest_part(input_description) ||
      mealscout_publication_digest_part(input_start_time) ||
      mealscout_publication_digest_part(input_end_time) ||
      mealscout_publication_digest_part(input_max_trucks::text) ||
      mealscout_publication_digest_part(input_hard_cap_enabled::text) ||
      mealscout_publication_digest_part(input_event_type) ||
      mealscout_publication_digest_part(input_requires_payment::text),
      'UTF8'
    )),
    'hex'
  )
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION mealscout_guard_event_series_publication_child()
RETURNS TRIGGER AS $$
DECLARE
  parent event_series_publication_operations%ROWTYPE;
  existing_count INTEGER;
  frozen_occurrence JSONB;
  frozen_occurrence_count INTEGER;
  expected_payload_digest TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'event series publication child is immutable'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO parent FROM event_series_publication_operations
   WHERE id = NEW.operation_id;
  IF NOT FOUND OR parent.series_id IS DISTINCT FROM NEW.series_id
     OR NOT (parent.target_date_keys @> to_jsonb(ARRAY[NEW.date_key])) THEN
    RAISE EXCEPTION 'publication child is outside frozen target scope'
      USING ERRCODE = '23514';
  END IF;
  SELECT count(*)::int INTO frozen_occurrence_count
    FROM jsonb_array_elements(
      COALESCE(parent.authority_snapshot -> 'occurrences', '[]'::jsonb)
    ) occurrence
   WHERE occurrence ->> 'dateKey' = NEW.date_key;
  IF frozen_occurrence_count <> 1 THEN
    RAISE EXCEPTION 'publication child does not have one frozen payload'
      USING ERRCODE = '23514';
  END IF;
  SELECT occurrence INTO frozen_occurrence
    FROM jsonb_array_elements(parent.authority_snapshot -> 'occurrences') occurrence
   WHERE occurrence ->> 'dateKey' = NEW.date_key;
  IF NEW.expected_event_id IS DISTINCT FROM
       mealscout_publication_event_id(NEW.operation_id, NEW.date_key)
     OR frozen_occurrence ->> 'hostId' IS DISTINCT FROM NEW.host_id
     OR NULLIF(frozen_occurrence ->> 'coordinatorUserId', '')
          IS DISTINCT FROM NEW.coordinator_user_id
     OR frozen_occurrence ->> 'seriesId' IS DISTINCT FROM NEW.series_id
     OR frozen_occurrence ->> 'name' IS DISTINCT FROM NEW.name
     OR frozen_occurrence ->> 'description' IS DISTINCT FROM NEW.description
     OR frozen_occurrence ->> 'startTime' IS DISTINCT FROM NEW.start_time
     OR frozen_occurrence ->> 'endTime' IS DISTINCT FROM NEW.end_time
     OR (frozen_occurrence ->> 'maxTrucks')::integer IS DISTINCT FROM NEW.max_trucks
     OR (frozen_occurrence ->> 'hardCapEnabled')::boolean
          IS DISTINCT FROM NEW.hard_cap_enabled
     OR frozen_occurrence ->> 'eventType' IS DISTINCT FROM NEW.event_type
     OR (frozen_occurrence ->> 'requiresPayment')::boolean
          IS DISTINCT FROM NEW.requires_payment THEN
    RAISE EXCEPTION 'publication child facts differ from frozen parent payload'
      USING ERRCODE = '23514';
  END IF;
  expected_payload_digest := mealscout_publication_payload_digest(
    NEW.operation_id,
    NEW.expected_event_id,
    NEW.host_id,
    NEW.coordinator_user_id,
    NEW.series_id,
    NEW.date_key,
    NEW.name,
    NEW.description,
    NEW.start_time,
    NEW.end_time,
    NEW.max_trucks,
    NEW.hard_cap_enabled,
    NEW.event_type,
    NEW.requires_payment
  );
  IF NEW.payload_digest IS DISTINCT FROM expected_payload_digest
     OR (NEW.event_id IS NOT NULL AND NEW.event_id IS DISTINCT FROM NEW.expected_event_id) THEN
    RAISE EXCEPTION 'publication child digest or event identity is invalid'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF parent.status <> 'prepared' THEN
      RAISE EXCEPTION 'publication child set is already frozen'
        USING ERRCODE = '23514';
    END IF;
    SELECT count(*)::int INTO existing_count
      FROM event_series_publication_children
     WHERE operation_id = NEW.operation_id;
    IF existing_count >= parent.expected_child_count THEN
      RAISE EXCEPTION 'publication child count exceeds frozen target set'
        USING ERRCODE = '23514';
    END IF;
  ELSIF (
    NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.series_id IS DISTINCT FROM OLD.series_id
    OR NEW.expected_event_id IS DISTINCT FROM OLD.expected_event_id
    OR NEW.date_key IS DISTINCT FROM OLD.date_key
    OR NEW.host_id IS DISTINCT FROM OLD.host_id
    OR NEW.coordinator_user_id IS DISTINCT FROM OLD.coordinator_user_id
    OR NEW.name IS DISTINCT FROM OLD.name
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.start_time IS DISTINCT FROM OLD.start_time
    OR NEW.end_time IS DISTINCT FROM OLD.end_time
    OR NEW.max_trucks IS DISTINCT FROM OLD.max_trucks
    OR NEW.hard_cap_enabled IS DISTINCT FROM OLD.hard_cap_enabled
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.requires_payment IS DISTINCT FROM OLD.requires_payment
    OR NEW.payload_digest IS DISTINCT FROM OLD.payload_digest
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.event_id IS NOT NULL AND NEW.event_id IS DISTINCT FROM OLD.event_id)
  ) THEN
    RAISE EXCEPTION 'publication child identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_event_series_publication_child
  ON event_series_publication_children;
CREATE TRIGGER trigger_guard_event_series_publication_child
BEFORE INSERT OR UPDATE OR DELETE ON event_series_publication_children
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_event_series_publication_child();

CREATE OR REPLACE FUNCTION mealscout_guard_publication_occurrence()
RETURNS TRIGGER AS $$
DECLARE
  child event_series_publication_children%ROWTYPE;
  proof TEXT;
  parent_status TEXT;
  actual_payload_digest TEXT;
BEGIN
  IF NEW.publication_operation_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO child FROM event_series_publication_children
   WHERE operation_id = NEW.publication_operation_id
     AND series_id = NEW.series_id
     AND expected_event_id = NEW.id
     AND date_key = NEW.publication_date_key
     AND payload_digest = NEW.publication_payload_digest;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'publication occurrence is outside frozen child scope'
      USING ERRCODE = '23514';
  END IF;
  actual_payload_digest := mealscout_publication_payload_digest(
    NEW.publication_operation_id,
    NEW.id,
    NEW.host_id,
    NEW.coordinator_user_id,
    NEW.series_id,
    NEW.publication_date_key,
    NEW.name,
    NEW.description,
    NEW.start_time,
    NEW.end_time,
    NEW.max_trucks,
    NEW.hard_cap_enabled,
    NEW.event_type,
    NEW.requires_payment
  );
  IF NEW.host_id IS DISTINCT FROM child.host_id
     OR NEW.coordinator_user_id IS DISTINCT FROM child.coordinator_user_id
     OR NEW.date IS DISTINCT FROM child.date_key::date::timestamp
     OR NEW.name IS DISTINCT FROM child.name
     OR NEW.description IS DISTINCT FROM child.description
     OR NEW.start_time IS DISTINCT FROM child.start_time
     OR NEW.end_time IS DISTINCT FROM child.end_time
     OR NEW.max_trucks IS DISTINCT FROM child.max_trucks
     OR NEW.hard_cap_enabled IS DISTINCT FROM child.hard_cap_enabled
     OR NEW.event_type IS DISTINCT FROM child.event_type
     OR NEW.requires_payment IS DISTINCT FROM child.requires_payment
     OR NEW.publication_payload_digest IS DISTINCT FROM actual_payload_digest THEN
    RAISE EXCEPTION 'publication occurrence facts differ from frozen child payload'
      USING ERRCODE = '23514';
  END IF;
  SELECT status INTO parent_status
    FROM event_series_publication_operations
   WHERE id = NEW.publication_operation_id;
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'publication occurrence must begin private'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status <> 'draft' THEN
    proof := current_setting('mealscout.event_series_publication_operation_id', true);
    IF proof IS DISTINCT FROM NEW.publication_operation_id
       OR parent_status IS DISTINCT FROM 'finalizing' THEN
      RAISE EXCEPTION 'publication occurrence visibility requires exact saga proof'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.publication_operation_id IS DISTINCT FROM OLD.publication_operation_id
    OR NEW.publication_date_key IS DISTINCT FROM OLD.publication_date_key
    OR NEW.publication_payload_digest IS DISTINCT FROM OLD.publication_payload_digest
  ) THEN
    RAISE EXCEPTION 'publication occurrence identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Legacy event notices get one durable identity per recipient. A provider call
-- that may have been accepted cannot be retried blindly after timeout.
CREATE TABLE IF NOT EXISTS event_notification_deliveries (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_kind VARCHAR NOT NULL,
  subject_id VARCHAR NOT NULL,
  recipient_key VARCHAR NOT NULL,
  recipient_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  recipient_email VARCHAR NOT NULL,
  payload_digest VARCHAR NOT NULL,
  idempotency_key VARCHAR NOT NULL UNIQUE,
  service_timezone VARCHAR NOT NULL,
  service_date_key VARCHAR NOT NULL
    CHECK (service_date_key ~ '^\d{4}-\d{2}-\d{2}$'),
  status VARCHAR NOT NULL DEFAULT 'prepared' CHECK (status IN (
    'prepared', 'submitted', 'retry_safe', 'ambiguous',
    'provider_confirmed', 'not_required'
  )),
  claim_token VARCHAR,
  claimed_at TIMESTAMP,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_status VARCHAR,
  provider_message_id VARCHAR,
  failure_message TEXT,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_event_notification_recipient UNIQUE (
    notification_kind, subject_id, recipient_key
  )
);

CREATE INDEX IF NOT EXISTS idx_event_notification_recovery
  ON event_notification_deliveries (status, claimed_at, updated_at)
  WHERE status IN ('submitted', 'retry_safe');

CREATE OR REPLACE FUNCTION mealscout_guard_event_notification_delivery()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'event notification delivery identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.notification_kind IS DISTINCT FROM OLD.notification_kind
    OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
    OR NEW.recipient_key IS DISTINCT FROM OLD.recipient_key
    OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email
    OR NEW.payload_digest IS DISTINCT FROM OLD.payload_digest
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.service_timezone IS DISTINCT FROM OLD.service_timezone
    OR NEW.service_date_key IS DISTINCT FROM OLD.service_date_key
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'event notification delivery scope is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('ambiguous', 'provider_confirmed', 'not_required')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'terminal event notification cannot be blindly reopened'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'provider_confirmed'
     AND NEW.provider_message_id IS NULL THEN
    RAISE EXCEPTION 'provider-confirmed notice requires provider identity'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_event_notification_delivery
  ON event_notification_deliveries;
CREATE TRIGGER trigger_guard_event_notification_delivery
BEFORE UPDATE OR DELETE ON event_notification_deliveries
FOR EACH ROW EXECUTE FUNCTION mealscout_guard_event_notification_delivery();

CREATE OR REPLACE FUNCTION mealscout_guard_parking_pass_blackout_write()
RETURNS TRIGGER AS $$
DECLARE
  proof TEXT;
  expected TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Parking Pass blackout identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  expected := concat(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.series_id ELSE NEW.series_id END,
    ':',
    to_char(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.date ELSE NEW.date END,
      'YYYY-MM-DD'
    )
  );
  proof := current_setting('mealscout.parking_pass_blackout_scope', true);
  IF proof IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Parking Pass blackout write requires canonical date lock proof'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('parking_pass_blackout_dates') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trigger_guard_parking_pass_blackout_write
      ON parking_pass_blackout_dates;
    CREATE TRIGGER trigger_guard_parking_pass_blackout_write
    BEFORE INSERT OR UPDATE OR DELETE ON parking_pass_blackout_dates
    FOR EACH ROW EXECUTE FUNCTION mealscout_guard_parking_pass_blackout_write();
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trigger_guard_publication_occurrence ON events;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM (VALUES
        ('status'), ('publication_operation_id'), ('publication_date_key'),
        ('publication_payload_digest'), ('series_id'), ('host_id'),
        ('coordinator_user_id'), ('name'), ('description'), ('date'),
        ('start_time'), ('end_time'), ('max_trucks'), ('hard_cap_enabled'),
        ('event_type'), ('requires_payment')
      ) AS required(column_name)
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns column_info
        WHERE column_info.table_schema = current_schema()
          AND column_info.table_name = 'events'
          AND column_info.column_name = required.column_name
     )
  ) THEN
    EXECUTE $trigger$
      CREATE TRIGGER trigger_guard_publication_occurrence
      BEFORE INSERT OR UPDATE OF
        status, publication_operation_id, publication_date_key,
        publication_payload_digest, series_id, host_id,
        coordinator_user_id, name, description, date, start_time, end_time,
        max_trucks, hard_cap_enabled, event_type, requires_payment
      ON events FOR EACH ROW
      EXECUTE FUNCTION mealscout_guard_publication_occurrence()
    $trigger$;
  END IF;
END $$;

COMMENT ON TABLE event_series_publication_operations IS
  'Frozen parent for resumable all-or-nothing open-call publication.';
COMMENT ON TABLE event_series_publication_children IS
  'Exact idempotent occurrence identities for one open-call publication.';

-- An older/direct writer cannot publish an open-call parent, alter a frozen
-- publication scope, or append a child outside the exact durable operation.
CREATE OR REPLACE FUNCTION mealscout_guard_event_series_publication_barrier()
RETURNS TRIGGER AS $$
DECLARE
  proof TEXT;
  operation_status TEXT;
BEGIN
  proof := current_setting(
    'mealscout.event_series_publication_operation_id', true
  );
  IF OLD.series_type IN ('event', 'open_call')
     AND OLD.status <> 'published' AND NEW.status = 'published' THEN
    IF OLD.active_publication_operation_id IS NULL
       OR proof IS DISTINCT FROM OLD.active_publication_operation_id THEN
      RAISE EXCEPTION 'open-call publication requires exact durable saga proof'
        USING ERRCODE = '23514';
    END IF;
    SELECT status INTO operation_status
      FROM event_series_publication_operations
     WHERE id = OLD.active_publication_operation_id;
    IF operation_status IS DISTINCT FROM 'finalizing' THEN
      RAISE EXCEPTION 'open-call publication is not ready to finalize'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD.active_publication_operation_id IS NOT NULL AND (
    NEW.host_id IS DISTINCT FROM OLD.host_id
    OR NEW.coordinator_user_id IS DISTINCT FROM OLD.coordinator_user_id
    OR NEW.name IS DISTINCT FROM OLD.name
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.timezone IS DISTINCT FROM OLD.timezone
    OR NEW.recurrence_rule IS DISTINCT FROM OLD.recurrence_rule
    OR NEW.start_date IS DISTINCT FROM OLD.start_date
    OR NEW.end_date IS DISTINCT FROM OLD.end_date
    OR NEW.default_start_time IS DISTINCT FROM OLD.default_start_time
    OR NEW.default_end_time IS DISTINCT FROM OLD.default_end_time
    OR NEW.default_max_trucks IS DISTINCT FROM OLD.default_max_trucks
    OR NEW.default_hard_cap_enabled IS DISTINCT FROM OLD.default_hard_cap_enabled
    OR NEW.series_type IS DISTINCT FROM OLD.series_type
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
  ) AND (
    proof IS DISTINCT FROM OLD.active_publication_operation_id
    OR NEW.status IS DISTINCT FROM 'published'
    OR NEW.active_publication_operation_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'frozen event series publication scope cannot be altered'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.active_publication_operation_id IS NOT NULL
     AND NEW.active_publication_operation_id IS NULL
     AND (
       proof IS DISTINCT FROM OLD.active_publication_operation_id
       OR NEW.status IS DISTINCT FROM 'published'
     ) THEN
    RAISE EXCEPTION 'publication barrier can only clear on exact convergence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guard_event_series_publication_barrier
  ON event_series;
CREATE TRIGGER trigger_guard_event_series_publication_barrier
BEFORE UPDATE OF
  host_id, coordinator_user_id, name, description, timezone,
  recurrence_rule, start_date, end_date, default_start_time,
  default_end_time, default_max_trucks, default_hard_cap_enabled,
  series_type, status, published_at, active_publication_operation_id
ON event_series FOR EACH ROW
EXECUTE FUNCTION mealscout_guard_event_series_publication_barrier();

CREATE OR REPLACE FUNCTION mealscout_guard_publication_occurrence()
RETURNS TRIGGER AS $$
DECLARE
  child event_series_publication_children%ROWTYPE;
  proof TEXT;
  parent_status TEXT;
  parent_series_type TEXT;
  active_operation_id TEXT;
  actual_payload_digest TEXT;
BEGIN
  IF NEW.series_id IS NOT NULL THEN
    SELECT series_type, active_publication_operation_id
      INTO parent_series_type, active_operation_id
      FROM event_series
     WHERE id = NEW.series_id;
  END IF;
  IF NEW.publication_operation_id IS NULL THEN
    IF TG_OP = 'INSERT'
       AND parent_series_type IN ('event', 'open_call') THEN
      RAISE EXCEPTION 'series occurrence insert requires frozen publication child'
        USING ERRCODE = '23514';
    END IF;
    IF active_operation_id IS NOT NULL THEN
      RAISE EXCEPTION 'series publication is suppressed by an active operation'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO child FROM event_series_publication_children
   WHERE operation_id = NEW.publication_operation_id
     AND series_id = NEW.series_id
     AND expected_event_id = NEW.id
     AND date_key = NEW.publication_date_key
     AND payload_digest = NEW.publication_payload_digest;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'publication occurrence is outside frozen child scope'
      USING ERRCODE = '23514';
  END IF;
  actual_payload_digest := mealscout_publication_payload_digest(
    NEW.publication_operation_id,
    NEW.id,
    NEW.host_id,
    NEW.coordinator_user_id,
    NEW.series_id,
    NEW.publication_date_key,
    NEW.name,
    NEW.description,
    NEW.start_time,
    NEW.end_time,
    NEW.max_trucks,
    NEW.hard_cap_enabled,
    NEW.event_type,
    NEW.requires_payment
  );
  IF NEW.host_id IS DISTINCT FROM child.host_id
     OR NEW.coordinator_user_id IS DISTINCT FROM child.coordinator_user_id
     OR NEW.date IS DISTINCT FROM child.date_key::date::timestamp
     OR NEW.name IS DISTINCT FROM child.name
     OR NEW.description IS DISTINCT FROM child.description
     OR NEW.start_time IS DISTINCT FROM child.start_time
     OR NEW.end_time IS DISTINCT FROM child.end_time
     OR NEW.max_trucks IS DISTINCT FROM child.max_trucks
     OR NEW.hard_cap_enabled IS DISTINCT FROM child.hard_cap_enabled
     OR NEW.event_type IS DISTINCT FROM child.event_type
     OR NEW.requires_payment IS DISTINCT FROM child.requires_payment
     OR NEW.publication_payload_digest IS DISTINCT FROM actual_payload_digest THEN
    RAISE EXCEPTION 'publication occurrence facts differ from frozen child payload'
      USING ERRCODE = '23514';
  END IF;
  IF active_operation_id IS DISTINCT FROM NEW.publication_operation_id THEN
    RAISE EXCEPTION 'publication occurrence does not match active parent barrier'
      USING ERRCODE = '23514';
  END IF;
  SELECT status INTO parent_status
    FROM event_series_publication_operations
   WHERE id = NEW.publication_operation_id;
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'publication occurrence must begin private'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status <> 'draft' THEN
    proof := current_setting('mealscout.event_series_publication_operation_id', true);
    IF proof IS DISTINCT FROM NEW.publication_operation_id
       OR parent_status IS DISTINCT FROM 'finalizing' THEN
      RAISE EXCEPTION 'publication occurrence visibility requires exact saga proof'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.publication_operation_id IS DISTINCT FROM OLD.publication_operation_id
    OR NEW.publication_date_key IS DISTINCT FROM OLD.publication_date_key
    OR NEW.publication_payload_digest IS DISTINCT FROM OLD.publication_payload_digest
    OR NEW.series_id IS DISTINCT FROM OLD.series_id
  ) THEN
    RAISE EXCEPTION 'publication occurrence identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
