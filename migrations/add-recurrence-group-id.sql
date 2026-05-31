-- Add recurrence_group_id column to events table for recurring events support
-- Events that are part of a recurring series will share the same recurrence_group_id

ALTER TABLE events
ADD COLUMN IF NOT EXISTS recurrence_group_id UUID;

-- Add index for faster lookups of recurring event series
CREATE INDEX IF NOT EXISTS idx_events_recurrence_group_id
ON events(recurrence_group_id)
WHERE recurrence_group_id IS NOT NULL;

-- Add comment
COMMENT ON COLUMN events.recurrence_group_id IS 'UUID shared by all events in a recurring series';
