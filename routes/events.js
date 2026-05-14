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
    // Get start and end of today in UTC
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const { data, error } = await req.supabase
      .from('events')
      .select('*')
      .gte('start_time', today.toISOString())
      .lt('start_time', tomorrow.toISOString())
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
    const { name, start_time, end_time, color } = req.body;

    // Validate required fields
    if (!name || !start_time || !end_time) {
      return res.status(400).json({ error: 'Missing required fields: name, start_time, end_time' });
    }

    const { data, error } = await req.supabase
      .from('events')
      .insert({
        user_id: req.user.id,
        name,
        start_time,
        end_time,
        color: color || '#3b82f6'
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating event:', error);
      return res.status(500).json({ error: 'Failed to create event' });
    }

    res.status(201).json({ event: data });
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
 * Delete an event by ID
 */
router.delete('/:id', async (req, res) => {
  try {
    const eventId = req.params.id;

    const { error } = await req.supabase
      .from('events')
      .delete()
      .eq('id', eventId);

    if (error) {
      console.error('Error deleting event:', error);
      return res.status(500).json({ error: 'Failed to delete event' });
    }

    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Error in DELETE /events/:id:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/events/range
 * Get events for a date range (for history view)
 * Query params: days (default 30) - number of days to fetch
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

module.exports = router;
