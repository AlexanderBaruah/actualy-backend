# Google Calendar Integration Setup

This guide explains how to enable Google Calendar sync in Actualy.

## Prerequisites

- Supabase project with Google OAuth already configured
- Google Cloud Console project with Calendar API enabled

## Steps

### 1. Enable Google Calendar API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (the same one used for Supabase OAuth)
3. Go to **APIs & Services** → **Library**
4. Search for "Google Calendar API"
5. Click **Enable**

### 2. Update Supabase OAuth Scopes

1. Go to your Supabase dashboard
2. Navigate to **Authentication** → **Providers**
3. Click on **Google**
4. In the **Scopes** field, add the Calendar scope:
   ```
   https://www.googleapis.com/auth/calendar.readonly
   ```
   Your final scopes should include:
   ```
   email profile openid https://www.googleapis.com/auth/calendar.readonly
   ```
5. Click **Save**

### 3. Update Database Schema

Run the SQL migration to add Google Calendar fields:

```sql
-- Run this in your Supabase SQL Editor
ALTER TABLE events ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS synced_from_calendar BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_events_google_calendar_event_id ON events(google_calendar_event_id);
```

### 4. Test the Integration

1. Sign out of Actualy
2. Sign in again with Google (this will request Calendar permissions)
3. Grant Calendar access when prompted
4. Go to the "Today" tab
5. Click "Sync Calendar"
6. Today's Google Calendar events should now appear in Actualy with a calendar icon

## How It Works

- **One-way sync**: Events are synced FROM Google Calendar TO Actualy
- **Today only**: Only today's events are synced
- **No duplicates**: Already synced events are not imported again
- **Manual sync**: Click "Sync Calendar" button to import events
- **Provider token**: Uses Supabase's stored OAuth tokens to access Google Calendar

## Troubleshooting

**Error: "Google Calendar not connected"**
- Sign out and sign in again
- Make sure to grant Calendar permission when prompted
- Check that the Calendar scope is added in Supabase

**No events syncing**
- Check that you have events in your primary Google Calendar for today
- All-day events are skipped (only timed events are synced)
- Make sure the Calendar API is enabled in Google Cloud Console

**Token expired errors**
- Supabase automatically refreshes tokens
- If issues persist, sign out and sign in again
