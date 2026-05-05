-- Business verification must be backed by approved, current commercial insurance
-- proof. Earlier admin/import flows could mark profiles verified without that
-- proof, so this reconciles existing rows to the proof-backed model.

UPDATE restaurants AS r
SET
  is_verified = false,
  updated_at = now()
WHERE coalesce(r.is_verified, false) = true
  AND NOT EXISTS (
    SELECT 1
    FROM business_insurance_verifications AS biv
    WHERE biv.entity_id = r.id
      AND biv.entity_type = CASE
        WHEN coalesce(r.is_food_truck, false)
          OR lower(coalesce(r.business_type, '')) = 'food_truck'
          THEN 'food_truck'
        WHEN lower(coalesce(r.business_type, '')) = 'caterer'
          THEN 'caterer'
        WHEN lower(coalesce(r.business_type, '')) = 'private_chef'
          THEN 'private_chef'
        ELSE 'restaurant'
      END
      AND biv.status = 'approved'
      AND coalesce(biv.attested_commercial_coverage, false) = true
      AND coalesce(biv.attested_jurisdiction_compliance, false) = true
      AND biv.expires_at > now()
      AND coalesce(array_length(biv.documents, 1), 0) > 0
  );

UPDATE hosts AS h
SET
  is_verified = false,
  updated_at = now()
WHERE coalesce(h.is_verified, false) = true
  AND NOT EXISTS (
    SELECT 1
    FROM business_insurance_verifications AS biv
    WHERE biv.entity_id = h.id
      AND biv.entity_type = 'host'
      AND biv.status = 'approved'
      AND coalesce(biv.attested_commercial_coverage, false) = true
      AND coalesce(biv.attested_jurisdiction_compliance, false) = true
      AND biv.expires_at > now()
      AND coalesce(array_length(biv.documents, 1), 0) > 0
  );
