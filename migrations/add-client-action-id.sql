-- Migration: Add client_action_id for idempotent timer starts
-- Purpose: Prevent duplicate timer creation from double-taps and race conditions
-- Run this in Supabase SQL Editor

-- Add client_action_id column (nullable for existing rows)
ALTER TABLE active_timers
ADD COLUMN IF NOT EXISTS client_action_id TEXT;

-- Create index for fast idempotency checks
CREATE INDEX IF NOT EXISTS idx_active_timers_client_action_id
  ON active_timers(client_action_id)
  WHERE client_action_id IS NOT NULL;

-- Verify column addition
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'active_timers'
  AND column_name = 'client_action_id';
