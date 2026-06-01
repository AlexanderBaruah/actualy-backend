-- Add is_unplanned column to events table
-- This migration should be run in Supabase SQL Editor

-- Step 1: Add the column with default false
ALTER TABLE events
ADD COLUMN IF NOT EXISTS is_unplanned BOOLEAN DEFAULT false;

-- Step 2: Backfill existing rows (set NULL to false)
UPDATE events
SET is_unplanned = false
WHERE is_unplanned IS NULL;

-- Step 3: Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_events_is_unplanned
ON events(is_unplanned);

-- Verify the migration
SELECT
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE is_unplanned = true) as unplanned_count,
  COUNT(*) FILTER (WHERE is_unplanned = false) as planned_count,
  COUNT(*) FILTER (WHERE is_unplanned IS NULL) as null_count
FROM events;
