const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');

// All routes in this file require authentication
router.use(authenticateUser);

/**
 * GET /api/events/today
 * Get all events for the current day for the authenticated user
 */
router.get('/today', async (req, res) => {
  try {
    // Get today's date range in Pacific Time (UTC-7/UTC-8)
    const now = new Date();
    const pacificOffset = -7 * 60; // Pacific Daylight Time offset in minutes
    const localTime = new Date(now.getTime() + (pacificOffset * 60 * 1000));

    // Get start of today in Pacific Time
    const todayPacific = new Date(localTime.getFullYear(), localTime.getMonth(), localTime.getDate());
    const tomorrowPacific = new Date(todayPacific);
    tomorrowPacific.setDate(tomorrowPacific.getDate() + 1);

    // Convert back to UTC for the database query
    const today = new Date(todayPacific.getTime() - (pacificOffset * 60 * 1000));
    const tomorrow = new Date(tomorrowPacific.getTime() - (pacificOffset * 60 * 1000));

    const { data, error } = await req.supabase
      .from('events')
      .select('*')
      .gte('start_time', today.toISOString())
      .lt('start_time', tomorrow.toISOString())
      .or('is_unplanned.eq.false,is_unplanned.is.null')
      .order('start_time', { ascending: true });

    if (error) {
      console.error('Error fetching events:', error);
      return res.status(500).json({ error: 'Failed to fetch events' });
    }

    res.json({ events: data });
  } catch (error) {
    console.error('Error in /today:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/events
 * Create a new event
 * Body: { name, start_time, end_time, color }
 */
router.post('/', async (req, res) => {
  try {
    const { name, start_time, end_time, color, is_unplanned } = req.body;

    // Validate required fields
    if (!name || !start_time || !end_time) {
      return res.status(400).json({ error: 'Missing required fields: name, start_time, end_time' });
    }

    const { is_recurring, repeat_until } = req.body;

    // If not recurring, create single event
    if (!is_recurring || !repeat_until) {
      const { data, error } = await req.supabase
        .from('events')
        .insert({
          user_id: req.user.id,
          name,
          start_time,
          end_time,
          color: color || '#3b82f6',
          is_unplanned: is_unplanned || false
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating event:', error);
        return res.status(500).json({ error: 'Failed to create event', details: error.message });
      }

      return res.status(201).json({ event: data });
    }

    // Create recurring events
    const { randomUUID } = require('crypto');
    const recurrenceGroupId = randomUUID();

    const startDate = new Date(start_time);
    const endDate = new Date(end_time);
    const repeatUntilDate = new Date(repeat_until);

    // Calculate duration in milliseconds
    const duration = endDate.getTime() - startDate.getTime();

    // Generate weekly occurrences
    const eventsToCreate = [];
    let currentDate = new Date(startDate);

    while (currentDate <= repeatUntilDate) {
      const eventStart = new Date(currentDate);
      const eventEnd = new Date(currentDate.getTime() + duration);

      eventsToCreate.push({
        user_id: req.user.id,
        name,
        start_time: eventStart.toISOString(),
        end_time: eventEnd.toISOString(),
        color: color || '#3b82f6',
        recurrence_group_id: recurrenceGroupId
      });

      // Move to next week
      currentDate.setDate(currentDate.getDate() + 7);
    }

    // Bulk insert all recurring events
    const { data, error } = await req.supabase
      .from('events')
      .insert(eventsToCreate)
      .select();

    if (error) {
      console.error('Error creating recurring events:', error);
      return res.status(500).json({ error: 'Failed to create recurring events' });
    }

    res.status(201).json({
      events: data,
      recurrence_group_id: recurrenceGroupId,
      count: data.length
    });
  } catch (error) {
    console.error('Error in POST /events:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PATCH /api/events/:id
 * Update an event by ID
 * Body: { name, start_time, end_time, color }
 */
router.patch('/:id', async (req, res) => {
  try {
    const eventId = req.params.id;
    const { name, start_time, end_time, color } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (start_time !== undefined) updateData.start_time = start_time;
    if (end_time !== undefined) updateData.end_time = end_time;
    if (color !== undefined) updateData.color = color;

    const { data, error } = await req.supabase
      .from('events')
      .update(updateData)
      .eq('id', eventId)
      .select()
      .single();

    if (error) {
      console.error('Error updating event:', error);
      return res.status(500).json({ error: 'Failed to update event' });
    }

    res.json({ event: data });
  } catch (error) {
    console.error('Error in PATCH /events/:id:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * DELETE /api/events/:id
 * Delete an event by ID (with recurring support)
 * Query params: delete_mode ('single' | 'future') - for recurring events
 */
router.delete('/:id', async (req, res) => {
  try {
    const eventId = req.params.id;
    const deleteMode = req.query.delete_mode || 'single';

    // Get the event to check if it's part of a recurring series
    const { data: event, error: fetchError } = await req.supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (fetchError || !event) {
      console.error('Error fetching event:', fetchError);
      return res.status(404).json({ error: 'Event not found' });
    }

    // If not part of recurring series or delete_mode is 'single', just delete this event
    if (!event.recurrence_group_id || deleteMode === 'single') {
      const { error } = await req.supabase
        .from('events')
        .delete()
        .eq('id', eventId);

      if (error) {
        console.error('Error deleting event:', error);
        return res.status(500).json({ error: 'Failed to delete event' });
      }

      return res.json({ message: 'Event deleted successfully', deleted: 1 });
    }

    // Delete this event and all future occurrences in the series
    const { error } = await req.supabase
      .from('events')
      .delete()
      .eq('recurrence_group_id', event.recurrence_group_id)
      .gte('start_time', event.start_time);

    if (error) {
      console.error('Error deleting recurring events:', error);
      return res.status(500).json({ error: 'Failed to delete recurring events' });
    }

    res.json({ message: 'Recurring events deleted successfully', deleted: 'multiple' });
  } catch (error) {
    console.error('Error in DELETE /events/:id:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/events/by-date
 * Get events for a specific date
 * Query params: date (YYYY-MM-DD format)
 * IMPORTANT: This route must come before /:id to avoid matching "by-date" as an ID
 */
router.get('/by-date', async (req, res) => {
  try {
    const dateParam = req.query.date;

    if (!dateParam) {
      return res.status(400).json({ error: 'Missing required parameter: date (YYYY-MM-DD)' });
    }

    // Parse the date and get day boundaries in Pacific Time (UTC-7)
    const pacificOffset = -7 * 60; // Pacific Daylight Time offset in minutes

    // Parse YYYY-MM-DD and create start of day in Pacific Time
    // Strategy: Parse as UTC, then subtract Pacific offset to get the equivalent Pacific midnight in UTC
    const [year, month, day] = dateParam.split('-').map(Number);
    const dayStartPacific = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const dayEndPacific = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));

    // Convert Pacific midnight to UTC (Pacific is UTC-7, so Pacific midnight = UTC 07:00)
    const startUTC = new Date(dayStartPacific.getTime() - (pacificOffset * 60 * 1000));
    const endUTC = new Date(dayEndPacific.getTime() - (pacificOffset * 60 * 1000));

    const { data, error } = await req.supabase
      .from('events')
      .select('*')
      .gte('start_time', startUTC.toISOString())
      .lt('start_time', endUTC.toISOString())
      .or('is_unplanned.eq.false,is_unplanned.is.null')
      .order('start_time', { ascending: true });

    if (error) {
      console.error('Error fetching events by date:', error);
      return res.status(500).json({ error: 'Failed to fetch events' });
    }

    res.json({ events: data });
  } catch (error) {
    console.error('Error in GET /events/by-date:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/events/range
 * Get events for a date range (for history view)
 * Query params: days (default 30) - number of days to fetch
 * IMPORTANT: This route must come before /:id to avoid matching "range" as an ID
 */
router.get('/range', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    // Get date range
    const endDate = new Date();
    endDate.setUTCHours(23, 59, 59, 999);

    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);
    startDate.setUTCHours(0, 0, 0, 0);

    // Fetch events
    const { data: events, error: eventsError } = await req.supabase
      .from('events')
      .select('*')
      .gte('start_time', startDate.toISOString())
      .lte('start_time', endDate.toISOString())
      .order('start_time', { ascending: false });

    if (eventsError) {
      console.error('Error fetching events:', eventsError);
      return res.status(500).json({ error: 'Failed to fetch events' });
    }

    // Fetch sessions for the same period
    const { data: sessions, error: sessionsError } = await req.supabase
      .from('sessions')
      .select('*')
      .gte('actual_start_time', startDate.toISOString())
      .lte('actual_start_time', endDate.toISOString())
      .order('actual_start_time', { ascending: false });

    if (sessionsError) {
      console.error('Error fetching sessions:', sessionsError);
      return res.status(500).json({ error: 'Failed to fetch sessions' });
    }

    res.json({ events, sessions });
  } catch (error) {
    console.error('Error in GET /events/range:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/events/:id
 * Get a single event by ID
 * IMPORTANT: This route must come AFTER all specific routes (/by-date, /range, etc.)
 * to avoid matching specific route names as IDs
 */
router.get('/:id', async (req, res) => {
  try {
    const eventId = req.params.id;

    const { data, error } = await req.supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (error || !data) {
      console.error('Error fetching event:', error);
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ event: data });
  } catch (error) {
    console.error('Error in GET /events/:id:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
