-- Add google_calendar_event_id column to events table to track synced events
ALTER TABLE events ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS synced_from_calendar BOOLEAN DEFAULT FALSE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_events_google_calendar_event_id ON events(google_calendar_event_id);

-- Add a table to store user Google Calendar tokens (optional - Supabase can handle this through providers)
-- We'll use Supabase's built-in OAuth token storage instead
