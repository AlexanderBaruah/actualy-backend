const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { authenticateUser } = require('../middleware/auth');

// All routes in this file require authentication
router.use(authenticateUser);

/**
 * POST /api/calendar/sync
 * Sync today's events from Google Calendar
 * Requires user to have Google Calendar scope enabled in Supabase Auth
 */
router.post('/sync', async (req, res) => {
  try {
    // Get the user's provider token from Supabase
    const { data: { session }, error: sessionError } = await req.supabase.auth.getSession();

    if (sessionError || !session) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if user has Google provider token
    const providerToken = session.provider_token;
    const providerRefreshToken = session.provider_refresh_token;

    if (!providerToken) {
      return res.status(400).json({
        error: 'Google Calendar not connected',
        message: 'Please connect your Google Calendar first'
      });
    }

    // Set up Google Calendar API client
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: providerToken,
      refresh_token: providerRefreshToken
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Fetch today's events from Google Calendar
    const calendarResponse = await calendar.events.list({
      calendarId: 'primary',
      timeMin: today.toISOString(),
      timeMax: tomorrow.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const googleEvents = calendarResponse.data.items || [];
    const syncedEvents = [];

    // Import each Google Calendar event
    for (const gEvent of googleEvents) {
      // Skip all-day events or events without start/end times
      if (!gEvent.start?.dateTime || !gEvent.end?.dateTime) {
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
        // Event already synced, skip
        continue;
      }

      // Create event in Actualy
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

      if (!insertError && newEvent) {
        syncedEvents.push(newEvent);
      }
    }

    res.json({
      success: true,
      synced: syncedEvents.length,
      events: syncedEvents
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
