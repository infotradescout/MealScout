-- Remove only the Parking Pass host rows explicitly approved as blank, smoke,
-- test, or duplicate inventory. The owner user accounts are intentionally kept.
--
-- This migration is a single atomic statement. Any changed identity, retained
-- host, protected reference, or inventory count aborts the whole cleanup.
DO $$
DECLARE
  target_ids varchar[] := ARRAY[
    '19b8b768-4e56-4891-a8b8-9c3388c45234',
    '20278f19-d0a9-4e36-930f-eb9d97a7d652',
    '0e90a132-eefa-4c2b-bdd6-4b8a38108571',
    '6e7b504f-b493-4e78-8073-9e5774aa1aa8',
    '604474de-54ae-4876-aed4-2856c7a827e7',
    '737c2bf8-7bda-4d3a-9253-aa74a551d8d9',
    '504e1de3-97e2-4e00-a51c-5877a4b97a68',
    '310209c9-e937-4328-8a74-97eac0bdac0e',
    '3d285a5e-c0f5-4146-b2f9-3bcf6cd2d350',
    '01444441-fea5-4ab4-b3cc-f8c59290c8f7',
    '6993894a-8d38-4711-b219-2e4f332a7546'
  ]::varchar[];
  smoke_ids varchar[] := ARRAY[
    '20278f19-d0a9-4e36-930f-eb9d97a7d652',
    '0e90a132-eefa-4c2b-bdd6-4b8a38108571',
    '6e7b504f-b493-4e78-8073-9e5774aa1aa8',
    '604474de-54ae-4876-aed4-2856c7a827e7',
    '737c2bf8-7bda-4d3a-9253-aa74a551d8d9',
    '504e1de3-97e2-4e00-a51c-5877a4b97a68',
    '310209c9-e937-4328-8a74-97eac0bdac0e',
    '3d285a5e-c0f5-4146-b2f9-3bcf6cd2d350'
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
   WHERE (id = '6c8795d9-5856-4f18-8db4-706d6aa5c453' AND business_name = 'Altura Perdido')
      OR (id = '94ceabcf-6a0a-42f8-b849-b203f5b5fc1c' AND business_name = 'The Grid Arcade')
      OR (id = 'a5d30bff-1318-4d7a-8ee2-96190bbf378f' AND business_name = 'The Spot Tavern')
      OR (id = '03371aca-2439-4a58-8269-4599e57279f4' AND business_name = 'The Unique Boutique');

  IF target_count = 0 AND retained_count = 0 THEN
    RAISE NOTICE 'Host cleanup not applicable on a fresh database.';
    RETURN;
  END IF;

  IF retained_count <> 4 THEN
    RAISE EXCEPTION 'Host cleanup stopped: expected all 4 retained real hosts, found %', retained_count;
  END IF;

  IF target_count = 0 THEN
    RAISE NOTICE 'Host cleanup already applied; all 4 retained real hosts are present.';
    RETURN;
  END IF;

  IF target_count <> 11 THEN
    RAISE EXCEPTION 'Host cleanup stopped: expected 11 target hosts or none, found %', target_count;
  END IF;

  SELECT count(*)::integer
    INTO identity_count
    FROM hosts h
    JOIN users u ON u.id = h.user_id
   WHERE (
          h.id = '19b8b768-4e56-4891-a8b8-9c3388c45234'
          AND h.business_name = 'Address'
          AND h.address = ''
          AND lower(u.email) = 'threedtea@gmail.com'
        )
      OR (
          h.id = ANY (smoke_ids)
          AND h.business_name = 'Smoke Host Site'
          AND h.address = '200 Provisioning Way, Test City, FL'
          AND lower(u.email) LIKE 'deleted+%@mealscout.invalid'
        )
      OR (
          h.id = '01444441-fea5-4ab4-b3cc-f8c59290c8f7'
          AND h.business_name = 'Test'
          AND h.address = '123 main street'
          AND lower(u.email) = 'deleted+ea243a1b-b331-4d34-bff4-c7a96bb1eadd@mealscout.invalid'
        )
      OR (
          h.id = '6993894a-8d38-4711-b219-2e4f332a7546'
          AND h.business_name = 'Altura Perdido'
          AND h.address = '13450 Perdido Key Dr'
          AND lower(u.email) = 'info.mealscout@gmail.com'
        );

  IF identity_count <> 11 THEN
    RAISE EXCEPTION 'Host cleanup stopped: only % of 11 target identities still match the approved audit', identity_count;
  END IF;

  SELECT count(*)::integer
    INTO series_count
    FROM event_series
   WHERE host_id = ANY (target_ids)
     AND series_type = 'parking_pass'
     AND status = 'draft';

  IF series_count <> 11 OR (
    SELECT count(*) FROM event_series WHERE host_id = ANY (target_ids)
  ) <> 11 THEN
    RAISE EXCEPTION 'Host cleanup stopped: expected exactly 11 draft Parking Pass series, found % matching', series_count;
  END IF;

  SELECT count(*)::integer
    INTO event_count
    FROM events
   WHERE host_id = ANY (target_ids);

  IF event_count <> 33
     OR (SELECT count(*) FROM events WHERE host_id = '01444441-fea5-4ab4-b3cc-f8c59290c8f7') <> 31
     OR (SELECT count(*) FROM events WHERE host_id = '6993894a-8d38-4711-b219-2e4f332a7546') <> 2 THEN
    RAISE EXCEPTION 'Host cleanup stopped: expected 31 Test events and 2 duplicate-Altura events, found % total', event_count;
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
    RAISE EXCEPTION 'Host cleanup stopped: found % protected or user-generated references', protected_reference_count;
  END IF;

  DELETE FROM hosts
   WHERE id = ANY (target_ids);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count <> 11 THEN
    RAISE EXCEPTION 'Host cleanup stopped: expected to delete 11 hosts, deleted %', deleted_count;
  END IF;

  IF EXISTS (SELECT 1 FROM hosts WHERE id = ANY (target_ids)) THEN
    RAISE EXCEPTION 'Host cleanup stopped: one or more approved target hosts remain';
  END IF;

  IF (SELECT count(*) FROM hosts WHERE id = ANY (retained_ids)) <> 4 THEN
    RAISE EXCEPTION 'Host cleanup stopped: a retained real host changed during cleanup';
  END IF;

  RAISE NOTICE 'Removed 11 approved junk hosts and their test inventory; retained all owner users and 4 real incomplete hosts.';
END
$$;
