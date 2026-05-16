# Google Calendar Integration Setup

This guide explains how to enable Google Calendar sync in Actualy using OAuth incremental authorization.

## Prerequisites

- Supabase project with Google OAuth already configured
- Google Cloud Console project with Calendar API enabled
- The same Google OAuth credentials used for Supabase authentication

## Architecture Overview

This implementation uses **OAuth Incremental Authorization**, which means:
- Initial login uses Supabase OAuth (email, profile, openid scopes only)
- Calendar access is requested separately when the user clicks "Sync Calendar"
- The calendar scope is requested programmatically via a popup
- No changes to Supabase OAuth configuration are needed

## Steps

### 1. Enable Google Calendar API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (the same one used for Supabase OAuth)
3. Go to **APIs & Services** → **Library**
4. Search for "Google Calendar API"
5. Click **Enable**

### 2. Add OAuth Redirect URI

1. In Google Cloud Console, go to **APIs & Services** → **Credentials**
2. Click on your OAuth 2.0 Client ID
3. Under **Authorized redirect URIs**, add:
   - For local development: `http://localhost:3000/api/calendar/oauth-callback`
   - For production (Vercel): `https://your-app-domain.vercel.app/api/calendar/oauth-callback`
4. Click **Save**

### 3. Configure Environment Variables

Add your Google OAuth credentials to `.env`:

```bash
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
```

**Important:** Use the same Client ID and Secret that you configured in Supabase for Google OAuth.

For Vercel deployment, add these as environment variables in your Vercel project settings.

### 4. Update Database Schema

Run the SQL migration to add Google Calendar fields:

```sql
-- Run this in your Supabase SQL Editor
ALTER TABLE events ADD COLUMN IF NOT EXISTS google_calendar_event_id TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS synced_from_calendar BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_events_google_calendar_event_id ON events(google_calendar_event_id);
```

### 5. Test the Integration

1. Go to the "Today" tab in Actualy
2. Click "Sync Calendar" button
3. If not connected:
   - A popup will open asking for Google Calendar authorization
   - Sign in to Google (if needed) and grant Calendar access
   - The popup will close automatically after authorization
4. Click "Sync Calendar" again (or confirm when prompted)
5. Today's Google Calendar events should now appear in Actualy with a calendar icon

## How It Works

### OAuth Incremental Authorization Flow

1. **User clicks "Sync Calendar"**: Frontend tries to sync with existing token
2. **No token exists**: Backend returns `needsAuth: true` error
3. **Frontend requests OAuth URL**: Calls `GET /api/calendar/oauth-url`
4. **Backend generates OAuth URL**: Creates URL with calendar scope and user_id in state
5. **Popup opens**: User authorizes Google Calendar access
6. **Google redirects to callback**: `GET /api/calendar/oauth-callback?code=...&state=user_id`
7. **Backend exchanges code for token**: Stores access_token and refresh_token in memory (Map)
8. **User syncs again**: Frontend calls `POST /api/calendar/sync` with the new token

### Features

- **One-way sync**: Events are synced FROM Google Calendar TO Actualy
- **Today only**: Only today's events are synced
- **No duplicates**: Already synced events (by google_calendar_event_id) are not imported again
- **Manual sync**: Click "Sync Calendar" button to import events
- **Separate authorization**: Calendar access is requested separately from initial login
- **Visual indicator**: Synced events display a calendar icon

### Token Storage

**Current Implementation (Development):**
- Tokens stored in memory using a Map (user_id → tokens)
- Tokens are lost on server restart

**Production Recommendation:**
- Store tokens in Supabase database (create a `calendar_tokens` table)
- Or use encrypted session storage
- Implement token refresh logic using refresh_token

## Troubleshooting

**Error: "Google Calendar not connected"**
- Click "Sync Calendar" and authorize when the popup opens
- Make sure popups are not blocked by your browser
- Check that Calendar API is enabled in Google Cloud Console
- Verify OAuth redirect URI is added in Google Cloud Console

**Popup blocked**
- Allow popups for the Actualy domain in your browser settings
- Try clicking "Sync Calendar" again after allowing popups

**No events syncing**
- Check that you have events in your primary Google Calendar for today
- All-day events are skipped (only timed events are synced)
- Make sure the Calendar API is enabled in Google Cloud Console
- Check server logs for detailed error messages

**Token expired errors**
- Click "Sync Calendar" again to re-authorize
- The OAuth flow will request a new token

**"Invalid Client" error**
- Verify GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set correctly
- Ensure you're using the same credentials as configured in Supabase
- Check that the OAuth redirect URI matches exactly
