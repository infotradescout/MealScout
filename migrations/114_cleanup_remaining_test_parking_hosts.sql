-- Remove the three remaining hosts whose names, addresses, inventory, and
-- account identities prove they are test fixtures. Owner user accounts are
-- intentionally retained, including the super-admin account.
DO $$
DECLARE
  target_ids varchar[] := ARRAY[
    'e8b250d0-2f7c-408b-8f1a-229fc87af6a0',
    '3e0dde93-cf8d-440a-9a3c-50b31073975d',
    'ecfea009-4ac2-416b-92bb-608145b19e27'
  ]::varchar[];
  retained_ids varchar[] := ARRAY[
    '6c8795d9-5856-4f18-8db4-706d6aa5c453', -- real Altura Perdido
    '94ceabcf-6a0a-42f8-b849-b203f5b5fc1c', -- The Grid Arcade
    'a5d30bff-1318-4d7a-8ee2-96190bbf378f', -- The Spot Tavern
    '03371aca-2439-4a58-8269-4599e57279f4'  -- The Unique Boutique
  ]::varchar[];
  target_count integer;
  identity_count integer;
  retained_count integer;
  series_count integer;
  event_count integer;
  protected_reference_count integer;
  deleted_count integer;
BEGIN
  SELECT count(*)::integer
    INTO target_count
    FROM hosts
   WHERE id = ANY (target_ids);

  SELECT count(*)::integer
    INTO retained_count
    FROM hosts
   WHERE id = ANY (retained_ids);

  IF retained_count <> 4 THEN
    RAISE EXCEPTION 'Remaining test-host cleanup stopped: expected all 4 retained real hosts, found %', retained_count;
  END IF;

  IF target_count = 0 THEN
    RAISE NOTICE 'Remaining test-host cleanup already applied; all 4 retained real hosts are present.';
    RETURN;
  END IF;

  IF target_count <> 3 THEN
    RAISE EXCEPTION 'Remaining test-host cleanup stopped: expected 3 target hosts or none, found %', target_count;
  END IF;

  SELECT count(*)::integer
    INTO identity_count
    FROM hosts h
    JOIN users u ON u.id = h.user_id
   WHERE (
          h.id = 'e8b250d0-2f7c-408b-8f1a-229fc87af6a0'
          AND h.business_name = 'Test Host 1776139421969'
          AND h.address = '100 Test Way'
          AND h.city = 'Austin'
          AND h.state = 'TX'
          AND lower(u.email) = 'deleted+3e150a4d-5bab-4057-8183-bc9ec6d26b5b@mealscout.invalid'
        )
      OR (
          h.id = '3e0dde93-cf8d-440a-9a3c-50b31073975d'
          AND h.business_name = 'Test Host 1776139608501'
          AND h.address = '100 Test Way'
          AND h.city = 'Austin'
          AND h.state = 'TX'
          AND lower(u.email) = 'deleted+6214e5e0-29dc-419b-8e84-24499804ee64@mealscout.invalid'
        )
      OR (
          h.id = 'ecfea009-4ac2-416b-92bb-608145b19e27'
          AND h.business_name = 'Test Host 1777645966762'
          AND h.address = '100 Congress Ave'
          AND h.city = 'Austin'
          AND h.state = 'TX'
          AND lower(u.email) = 'info.mealscout@gmail.com'
        );

  IF identity_count <> 3 THEN
    RAISE EXCEPTION 'Remaining test-host cleanup stopped: only % of 3 target identities still match the approved audit', identity_count;
  END IF;

  SELECT count(*)::integer
    INTO series_count
    FROM event_series
   WHERE host_id = ANY (target_ids)
     AND series_type = 'parking_pass'
     AND status = 'published'
     AND default_host_price_cents = 4500;

  IF series_count <> 3
     OR (SELECT count(*) FROM event_series WHERE host_id = ANY (target_ids)) <> 3
     OR (SELECT count(DISTINCT host_id) FROM event_series WHERE host_id = ANY (target_ids)) <> 3 THEN
    RAISE EXCEPTION 'Remaining test-host cleanup stopped: expected one published $45 Parking Pass series for each target, found % matching', series_count;
  END IF;

  SELECT count(*)::integer
    INTO event_count
    FROM events
   WHERE host_id = ANY (target_ids)
     AND event_type = 'parking_pass'
     AND status = 'open';

  IF event_count <> 2
     OR (SELECT count(*) FROM events WHERE host_id = ANY (target_ids)) <> 2
     OR (SELECT count(*) FROM events WHERE host_id = 'e8b250d0-2f7c-408b-8f1a-229fc87af6a0') <> 2 THEN
    RAISE EXCEPTION 'Remaining test-host cleanup stopped: expected exactly 2 open test Parking Pass events, found % matching', event_count;
  END IF;

  WITH target_events AS (
    SELECT id FROM events WHERE host_id = ANY (target_ids)
  ), target_series AS (
    SELECT id FROM event_series WHERE host_id = ANY (target_ids)
  )
  SELECT sum(reference_count)::integer
    INTO protected_reference_count
    FROM (
      SELECT count(*) AS reference_count FROM event_bookings WHERE host_id = ANY (target_ids)
      UNION ALL SELECT count(*) FROM host_reviews WHERE host_id = ANY (target_ids)
      UNION ALL SELECT count(*) FROM host_earnings_ledger WHERE host_id = ANY (target_ids)
      UNION ALL SELECT count(*) FROM host_payout_requests WHERE host_id = ANY (target_ids)
      UNION ALL SELECT count(*) FROM claims WHERE host_id = ANY (target_ids)
      UNION ALL SELECT count(*) FROM truck_parking_reports WHERE host_id = ANY (target_ids)
      UNION ALL SELECT count(*) FROM host_location_claims WHERE host_id = ANY (target_ids)
      UNION ALL SELECT count(*) FROM business_photos WHERE host_id = ANY (target_ids)
      UNION ALL SELECT count(*) FROM job_postings WHERE host_id = ANY (target_ids)
      UNION ALL SELECT count(*) FROM job_applications WHERE host_id = ANY (target_ids)
      UNION ALL SELECT count(*) FROM parking_pass_blackout_dates WHERE series_id IN (SELECT id FROM target_series)
      UNION ALL SELECT count(*) FROM event_interests WHERE event_id IN (SELECT id FROM target_events)
      UNION ALL SELECT count(*) FROM event_bookings WHERE event_id IN (SELECT id FROM target_events)
      UNION ALL SELECT count(*) FROM claims WHERE event_id IN (SELECT id FROM target_events)
    ) protected_references;

  IF protected_reference_count <> 0 THEN
    RAISE EXCEPTION 'Remaining test-host cleanup stopped: found % protected or user-generated references', protected_reference_count;
  END IF;

  DELETE FROM hosts
   WHERE id = ANY (target_ids);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count <> 3 THEN
    RAISE EXCEPTION 'Remaining test-host cleanup stopped: expected to delete 3 hosts, deleted %', deleted_count;
  END IF;

  IF EXISTS (SELECT 1 FROM hosts WHERE id = ANY (target_ids)) THEN
    RAISE EXCEPTION 'Remaining test-host cleanup stopped: one or more target hosts remain';
  END IF;

  IF (SELECT count(*) FROM hosts WHERE id = ANY (retained_ids)) <> 4 THEN
    RAISE EXCEPTION 'Remaining test-host cleanup stopped: a retained real host changed during cleanup';
  END IF;

  RAISE NOTICE 'Removed 3 remaining test hosts and their fixture inventory; retained every owner user and all 4 real incomplete hosts.';
END
$$;
