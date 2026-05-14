const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');

// All routes in this file require authentication
router.use(authenticateUser);

/**
 * POST /api/sessions
 * Create a new session (save actual time tracking)
 * Body: { event_id (optional), actual_start_time, duration_seconds, notes (optional) }
 */
router.post('/', async (req, res) => {
  try {
    const { event_id, actual_start_time, duration_seconds, notes } = req.body;

    // Validate required fields
    if (!actual_start_time || duration_seconds === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: actual_start_time, duration_seconds'
      });
    }

    const { data, error } = await req.supabase
      .from('sessions')
      .insert({
        user_id: req.user.id,
        event_id: event_id || null,
        actual_start_time,
        duration_seconds,
        notes: notes || null
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating session:', error);
      return res.status(500).json({ error: 'Failed to create session' });
    }

    res.status(201).json({ session: data });
  } catch (error) {
    console.error('Error in POST /sessions:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * PATCH /api/sessions/:id/notes
 * Update notes for an existing session
 * Body: { notes }
 */
router.patch('/:id/notes', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { notes } = req.body;

    if (notes === undefined) {
      return res.status(400).json({ error: 'Missing required field: notes' });
    }

    const { data, error } = await req.supabase
      .from('sessions')
      .update({ notes })
      .eq('id', sessionId)
      .select()
      .single();

    if (error) {
      console.error('Error updating session notes:', error);
      return res.status(500).json({ error: 'Failed to update notes' });
    }

    if (!data) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session: data });
  } catch (error) {
    console.error('Error in PATCH /sessions/:id/notes:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/sessions/today
 * Get all sessions for today for the authenticated user
 */
router.get('/today', async (req, res) => {
  try {
    // Get start and end of today in UTC
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    const { data, error } = await req.supabase
      .from('sessions')
      .select('*')
      .gte('actual_start_time', today.toISOString())
      .lt('actual_start_time', tomorrow.toISOString())
      .order('actual_start_time', { ascending: true });

    if (error) {
      console.error('Error fetching sessions:', error);
      return res.status(500).json({ error: 'Failed to fetch sessions' });
    }

    res.json({ sessions: data });
  } catch (error) {
    console.error('Error in GET /sessions/today:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
