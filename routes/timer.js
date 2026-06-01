const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');

// All routes in this file require authentication
router.use(authenticateUser);

/**
 * GET /api/timer/active
 * Get the currently active timer for the authenticated user
 * Returns null if no timer is active
 */
router.get('/active', async (req, res) => {
  try {
    console.log('[GET /api/timer/active] Fetching active timer for user:', req.user.id);

    const { data, error } = await req.supabase
      .from('active_timers')
      .select('*')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (error) {
      console.error('[GET /api/timer/active] Error fetching active timer:', error);
      return res.status(500).json({ error: 'Failed to fetch active timer', details: error.message });
    }

    if (!data) {
      console.log('[GET /api/timer/active] No active timer found');
      return res.json({ activeTimer: null });
    }

    // Calculate elapsed time from server timestamp
    const startTime = new Date(data.start_time);
    const now = new Date();
    const elapsedSeconds = Math.floor((now - startTime) / 1000);

    console.log('[GET /api/timer/active] Active timer found:', {
      id: data.id,
      task: data.task_name,
      elapsed: elapsedSeconds,
      isUnplanned: data.is_unplanned
    });

    res.json({
      activeTimer: {
        id: data.id,
        eventId: data.event_id,
        taskName: data.task_name,
        isUnplanned: data.is_unplanned,
        startTime: data.start_time,
        elapsedSeconds: elapsedSeconds,
        lastHeartbeat: data.last_heartbeat
      }
    });
  } catch (error) {
    console.error('[GET /api/timer/active] Server error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/timer/start
 * Start a new timer (or fail if one is already active)
 * Body: { eventId?, taskName, isUnplanned? }
 */
router.post('/start', async (req, res) => {
  try {
    const { eventId, taskName, isUnplanned } = req.body;

    if (!taskName) {
      return res.status(400).json({ error: 'taskName is required' });
    }

    console.log('[POST /api/timer/start] Starting timer:', {
      user: req.user.id,
      eventId,
      taskName,
      isUnplanned: isUnplanned || false
    });

    // Check if there's already an active timer
    const { data: existing, error: checkError } = await req.supabase
      .from('active_timers')
      .select('*')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (checkError) {
      console.error('[POST /api/timer/start] Error checking for existing timer:', checkError);
      return res.status(500).json({ error: 'Failed to check for existing timer', details: checkError.message });
    }

    if (existing) {
      console.log('[POST /api/timer/start] Timer already active:', existing.id);
      return res.status(409).json({
        error: 'Timer already active',
        activeTimer: {
          id: existing.id,
          eventId: existing.event_id,
          taskName: existing.task_name,
          isUnplanned: existing.is_unplanned,
          startTime: existing.start_time
        }
      });
    }

    // Create new active timer
    const startTime = new Date().toISOString();
    const { data, error } = await req.supabase
      .from('active_timers')
      .insert({
        user_id: req.user.id,
        event_id: eventId || null,
        task_name: taskName,
        is_unplanned: isUnplanned || false,
        start_time: startTime,
        last_heartbeat: startTime
      })
      .select()
      .single();

    if (error) {
      console.error('[POST /api/timer/start] Error creating active timer:', error);
      return res.status(500).json({ error: 'Failed to start timer', details: error.message });
    }

    console.log('[POST /api/timer/start] Timer started successfully:', data.id);

    // Also save to localStorage as backup (frontend will handle this)
    res.status(201).json({
      activeTimer: {
        id: data.id,
        eventId: data.event_id,
        taskName: data.task_name,
        isUnplanned: data.is_unplanned,
        startTime: data.start_time,
        elapsedSeconds: 0
      }
    });
  } catch (error) {
    console.error('[POST /api/timer/start] Server error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/timer/stop
 * Stop the active timer and save the session
 * Body: { notes? }
 */
router.post('/stop', async (req, res) => {
  try {
    const { notes } = req.body;

    console.log('[POST /api/timer/stop] Stopping timer for user:', req.user.id);

    // Get the active timer
    const { data: activeTimer, error: fetchError } = await req.supabase
      .from('active_timers')
      .select('*')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (fetchError) {
      console.error('[POST /api/timer/stop] Error fetching active timer:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch active timer', details: fetchError.message });
    }

    if (!activeTimer) {
      console.log('[POST /api/timer/stop] No active timer found');
      return res.status(404).json({ error: 'No active timer found' });
    }

    const startTime = new Date(activeTimer.start_time);
    const endTime = new Date();
    const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));

    console.log('[POST /api/timer/stop] Timer details:', {
      timerId: activeTimer.id,
      eventId: activeTimer.event_id,
      task: activeTimer.task_name,
      duration: durationMinutes,
      isUnplanned: activeTimer.is_unplanned
    });

    // Create session record
    const { data: session, error: sessionError } = await req.supabase
      .from('sessions')
      .insert({
        user_id: req.user.id,
        event_id: activeTimer.event_id,
        actual_start_time: activeTimer.start_time,
        actual_end_time: endTime.toISOString(),
        duration_minutes: durationMinutes,
        notes: notes || null
      })
      .select()
      .single();

    if (sessionError) {
      console.error('[POST /api/timer/stop] Error creating session:', sessionError);
      return res.status(500).json({ error: 'Failed to save session', details: sessionError.message });
    }

    console.log('[POST /api/timer/stop] Session created:', session.id);

    // Delete the active timer
    const { error: deleteError } = await req.supabase
      .from('active_timers')
      .delete()
      .eq('id', activeTimer.id);

    if (deleteError) {
      console.error('[POST /api/timer/stop] Error deleting active timer:', deleteError);
      // Session was saved, so don't fail the request
      console.warn('[POST /api/timer/stop] Session saved but failed to clear active timer');
    } else {
      console.log('[POST /api/timer/stop] Active timer cleared');
    }

    res.json({
      session: {
        id: session.id,
        eventId: session.event_id,
        startTime: session.actual_start_time,
        endTime: session.actual_end_time,
        durationMinutes: session.duration_minutes,
        notes: session.notes
      },
      message: 'Timer stopped and session saved'
    });
  } catch (error) {
    console.error('[POST /api/timer/stop] Server error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/timer/heartbeat
 * Update last_heartbeat timestamp to indicate the timer is still active
 * Used for detecting abandoned timers
 */
router.post('/heartbeat', async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from('active_timers')
      .update({ last_heartbeat: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .select()
      .maybeSingle();

    if (error) {
      console.error('[POST /api/timer/heartbeat] Error updating heartbeat:', error);
      return res.status(500).json({ error: 'Failed to update heartbeat' });
    }

    if (!data) {
      return res.status(404).json({ error: 'No active timer found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[POST /api/timer/heartbeat] Server error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
