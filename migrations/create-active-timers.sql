-- Migration: Create active_timers table for server-side timer tracking
-- Purpose: Store currently running timers with cross-device sync
-- Run this in Supabase SQL Editor

-- Create active_timers table
CREATE TABLE IF NOT EXISTS active_timers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  task_name TEXT NOT NULL,
  is_unplanned BOOLEAN DEFAULT false,
  start_time TIMESTAMPTZ NOT NULL,
  last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE active_timers ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their own active timers
CREATE POLICY "Users can view own active timers"
  ON active_timers
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can insert their own active timers
CREATE POLICY "Users can insert own active timers"
  ON active_timers
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can update their own active timers
CREATE POLICY "Users can update own active timers"
  ON active_timers
  FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policy: Users can delete their own active timers
CREATE POLICY "Users can delete own active timers"
  ON active_timers
  FOR DELETE
  USING (auth.uid() = user_id);

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_active_timers_user_id ON active_timers(user_id);

-- Index for event lookups
CREATE INDEX IF NOT EXISTS idx_active_timers_event_id ON active_timers(event_id);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_active_timers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER update_active_timers_updated_at
  BEFORE UPDATE ON active_timers
  FOR EACH ROW
  EXECUTE FUNCTION update_active_timers_updated_at();

-- Constraint: One active timer per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_timers_one_per_user
  ON active_timers(user_id);

-- Verify table creation
SELECT
  'active_timers table created' AS status,
  COUNT(*) AS row_count
FROM active_timers;
