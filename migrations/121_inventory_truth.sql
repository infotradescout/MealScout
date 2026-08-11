-- Migration 119 establishes the owner-versus-sold-out availability marker.
-- This claim makes inventory restoration exactly once per cancelled order.
ALTER TABLE pickup_orders
  ADD COLUMN IF NOT EXISTS inventory_restored_at TIMESTAMP;
