const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { authenticateUser } = require('../middleware/auth');

// OAuth2 client for incremental authorization
// Note: This redirect URI must match exactly what's configured in Google Cloud Console
const redirectUri = 'https://actualy-backend.vercel.app/api/calendar/oauth-callback';

console.log('[Calendar] OAuth2 Client Configuration:');
console.log('[Calendar] - CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Missing');
console.log('[Calendar] - CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Missing');
console.log('[Calendar] - VERCEL_URL:', process.env.VERCEL_URL || 'Not set (using localhost)');
console.log('[Calendar] - Redirect URI:', redirectUri);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  redirectUri
);

// Store tokens temporarily (in production, use a database)
// Map of user_id -> { access_token, refresh_token, expiry_date }
const userCalendarTokens = new Map();

/**
 * GET /api/calendar/oauth-url
 * Generate Google OAuth URL for calendar scope
 * Returns the URL that the frontend should open for incremental authorization
 */
router.get('/oauth-url', authenticateUser, async (req, res) => {
  try {
    console.log('[Calendar] Generating OAuth URL for user:', req.user.id);

    // Generate OAuth URL with calendar scope
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.readonly'],
      state: req.user.id, // Pass user_id in state to identify user in callback
      prompt: 'consent', // Force consent screen to get refresh token
      include_granted_scopes: true, // Incremental authorization
    });

    console.log('[Calendar] Generated OAuth URL:', authUrl);
    console.log('[Calendar] Redirect URI in use:', redirectUri);

    // Return both URL and redirect URI for debugging
    res.json({
      url: authUrl,
      redirect_uri: redirectUri, // For debugging - shows exact redirect URI being used
      vercel_url: process.env.VERCEL_URL || 'not set'
    });
  } catch (error) {
    console.error('[Calendar] Error generating OAuth URL:', error);
    res.status(500).json({ error: 'Failed to generate OAuth URL' });
  }
});

/**
 * GET /api/calendar/oauth-callback
 * Handle OAuth callback from Google
 * Exchanges authorization code for access token
 */
router.get('/oauth-callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      return res.status(400).send('Authorization code missing');
    }

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    // Store tokens for the user (state contains user_id)
    const userId = state;
    userCalendarTokens.set(userId, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    });

    // Redirect to success page with message
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Calendar Connected</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: #f5f5f5;
            }
            .message {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              text-align: center;
              max-width: 400px;
            }
            h1 { color: #4285f4; margin-bottom: 16px; }
            p { color: #666; margin-bottom: 24px; }
            button {
              background: #4285f4;
              color: white;
              border: none;
              padding: 12px 24px;
              border-radius: 6px;
              font-size: 16px;
              cursor: pointer;
            }
            button:hover { background: #3367d6; }
          </style>
        </head>
        <body>
          <div class="message">
            <h1>✓ Calendar Connected!</h1>
            <p>Your Google Calendar has been successfully connected. You can now sync your events.</p>
            <button onclick="window.close()">Close Window</button>
          </div>
          <script>
            // Try to close the popup automatically after 3 seconds
            setTimeout(() => {
              window.close();
            }, 3000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Connection Failed</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: #f5f5f5;
            }
            .message {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              text-align: center;
              max-width: 400px;
            }
            h1 { color: #d32f2f; margin-bottom: 16px; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="message">
            <h1>✗ Connection Failed</h1>
            <p>Failed to connect your Google Calendar. Please try again.</p>
          </div>
        </body>
      </html>
    `);
  }
});

/**
 * POST /api/calendar/sync
 * Sync today's events from Google Calendar
 * Uses calendar-specific OAuth token from incremental authorization
 */
router.post('/sync', authenticateUser, async (req, res) => {
  try {
    // Check if user has calendar token from incremental authorization
    const userTokens = userCalendarTokens.get(req.user.id);

    if (!userTokens) {
      return res.status(400).json({
        error: 'Google Calendar not connected',
        message: 'Please connect your Google Calendar first',
        needsAuth: true
      });
    }

    // Set up Google Calendar API client with user's calendar token
    const calendarClient = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    calendarClient.setCredentials({
      access_token: userTokens.access_token,
      refresh_token: userTokens.refresh_token,
      expiry_date: userTokens.expiry_date
    });

    const calendar = google.calendar({ version: 'v3', auth: calendarClient });

    // Get today's date range in Pacific Time (UTC-7/UTC-8)
    // Convert current UTC time to Pacific Time, then get start/end of day
    const now = new Date();
    const pacificOffset = -7 * 60; // Pacific Daylight Time offset in minutes
    const localTime = new Date(now.getTime() + (pacificOffset * 60 * 1000));

    // Get start of today in Pacific Time
    const todayPacific = new Date(localTime.getFullYear(), localTime.getMonth(), localTime.getDate());
    const tomorrowPacific = new Date(todayPacific);
    tomorrowPacific.setDate(tomorrowPacific.getDate() + 1);

    // Convert back to UTC for the API query
    const today = new Date(todayPacific.getTime() - (pacificOffset * 60 * 1000));
    const tomorrow = new Date(tomorrowPacific.getTime() - (pacificOffset * 60 * 1000));

    console.log('[Calendar] Fetching events from', today.toISOString(), 'to', tomorrow.toISOString());
    console.log('[Calendar] Pacific Time date:', todayPacific.toDateString());

    // Fetch today's events from Google Calendar
    const calendarResponse = await calendar.events.list({
      calendarId: 'primary',
      timeMin: today.toISOString(),
      timeMax: tomorrow.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const googleEvents = calendarResponse.data.items || [];
    console.log('[Calendar] Found', googleEvents.length, 'total events from Google Calendar');

    const syncedEvents = [];
    const skippedEvents = [];

    // Import each Google Calendar event
    for (const gEvent of googleEvents) {
      console.log('[Calendar] Processing event:', gEvent.summary, {
        start: gEvent.start,
        end: gEvent.end,
        id: gEvent.id
      });

      // Skip all-day events or events without start/end times
      if (!gEvent.start?.dateTime || !gEvent.end?.dateTime) {
        console.log('[Calendar] Skipping event (no dateTime):', gEvent.summary);
        skippedEvents.push({ name: gEvent.summary, reason: 'no dateTime' });
        continue;
      }

      // Check if this event was already synced
      const { data: existing } = await req.supabase
        .from('events')
        .select('id')
        .eq('google_calendar_event_id', gEvent.id)
        .eq('user_id', req.user.id)
        .single();

      if (existing) {
        console.log('[Calendar] Event already synced, skipping:', gEvent.summary);
        skippedEvents.push({ name: gEvent.summary, reason: 'already synced' });
        continue;
      }

      // Create event in Actualy
      console.log('[Calendar] Inserting new event:', gEvent.summary);
      const { data: newEvent, error: insertError } = await req.supabase
        .from('events')
        .insert({
          user_id: req.user.id,
          name: gEvent.summary || 'Untitled Event',
          start_time: gEvent.start.dateTime,
          end_time: gEvent.end.dateTime,
          color: '#4285f4', // Google blue
          google_calendar_event_id: gEvent.id,
          synced_from_calendar: true
        })
        .select()
        .single();

      if (insertError) {
        console.error('[Calendar] Error inserting event:', gEvent.summary, insertError);
        skippedEvents.push({ name: gEvent.summary, reason: `insert error: ${insertError.message}` });
      } else if (newEvent) {
        console.log('[Calendar] Successfully synced event:', gEvent.summary);
        syncedEvents.push(newEvent);
      }
    }

    console.log('[Calendar] Sync complete. Synced:', syncedEvents.length, 'Skipped:', skippedEvents.length);
    console.log('[Calendar] Skipped events:', skippedEvents);

    res.json({
      success: true,
      synced: syncedEvents.length,
      events: syncedEvents,
      skipped: skippedEvents.length,
      skippedDetails: skippedEvents
    });

  } catch (error) {
    console.error('Error syncing Google Calendar:', error);

    // Handle specific Google API errors
    if (error.code === 401 || error.code === 403) {
      return res.status(401).json({
        error: 'Google Calendar authorization failed',
        message: 'Please reconnect your Google Calendar'
      });
    }

    res.status(500).json({
      error: 'Failed to sync calendar',
      message: error.message
    });
  }
});

module.exports = router;
