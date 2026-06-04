const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');

// All routes in this file require authentication
router.use(authenticateUser);

/**
 * Helper: Check if a timer is stale (from a different Pacific day or >12 hours old)
 */
function isStaleTimer(startTime) {
  const start = new Date(startTime);
  const now = new Date();
  const hoursSince = (now - start) / (1000 * 60 * 60);

  // Check if different Pacific date
  const pacificOffset = -7 * 60 * 60 * 1000;
  const startPacific = new Date(start.getTime() + pacificOffset);
  const nowPacific = new Date(now.getTime() + pacificOffset);
  const differentDay = startPacific.toISOString().split('T')[0] !== nowPacific.toISOString().split('T')[0];

  return differentDay || hoursSince > 12;
}

/**
 * Shared helper: Get active timer for user
 * SINGLE SOURCE OF TRUTH - used by all endpoints
 */
async function getActiveTimerForUser(supabase, userId) {
  const { data: timer, error } = await supabase
    .from('active_timers')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[getActiveTimer] Database error:', error);
    throw error;
  }

  return timer; // Returns null if no active timer
}

/**
 * Helper: Calculate capped end time for stale timer
 */
async function calculateCappedEndTime(supabase, timer) {
  const startTime = new Date(timer.start_time);
  let endTime;

  if (timer.event_id) {
    // Try to get scheduled end_time
    const { data: eventData } = await supabase
      .from('events')
      .select('end_time')
      .eq('id', timer.event_id)
      .maybeSingle();

    if (eventData && eventData.end_time) {
      endTime = new Date(eventData.end_time);
      console.log('[calculateCappedEndTime] Using scheduled end time:', endTime.toISOString());
    } else {
      // Cap at +4 hours
      endTime = new Date(startTime.getTime() + 4 * 60 * 60 * 1000);
      console.log('[calculateCappedEndTime] No scheduled end time, capping at +4 hours');
    }
  } else {
    // Unplanned, cap at +4 hours
    endTime = new Date(startTime.getTime() + 4 * 60 * 60 * 1000);
    console.log('[calculateCappedEndTime] Unplanned task, capping at +4 hours');
  }

  return endTime;
}

/**
 * GET /api/timer/active
 * Get the currently active timer for the authenticated user
 * NOTE: Stale timers (>12h or different day) are FILTERED OUT and treated as non-existent
 */
router.get('/active', async (req, res) => {
  try {
    console.log('[GET /active] User:', req.user.id);

    const timer = await getActiveTimerForUser(req.supabase, req.user.id);

    if (!timer) {
      return res.json({ activeTimer: null });
    }

    // Check if timer is stale
    const isStale = isStaleTimer(timer.start_time);

    if (isStale) {
      console.log('[GET /active] Timer is STALE, treating as non-existent:', {
        id: timer.id,
        task: timer.task_name,
        start_time: timer.start_time
      });
      return res.json({ activeTimer: null });
    }

    // Calculate elapsed time using server timestamp math
    const startTime = new Date(timer.start_time);
    const now = new Date();
    const elapsedSeconds = Math.floor((now - startTime) / 1000);

    console.log('[GET /active] Active timer:', {
      id: timer.id,
      task: timer.task_name,
      elapsed: elapsedSeconds,
      isStale
    });

    res.json({
      activeTimer: {
        id: timer.id,
        eventId: timer.event_id,
        taskName: timer.task_name,
        isUnplanned: timer.is_unplanned,
        startTime: timer.start_time,
        elapsedSeconds: elapsedSeconds,
        isStale: isStale,
        lastHeartbeat: timer.last_heartbeat
      }
    });
  } catch (error) {
    console.error('[GET /active] Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/timer/start
 * Start a new timer (idempotent with clientActionId)
 * Body: { eventId?, taskName, isUnplanned?, clientActionId }
 */
router.post('/start', async (req, res) => {
  try {
    const { eventId, taskName, isUnplanned, clientActionId } = req.body;

    if (!taskName) {
      return res.status(400).json({ error: 'taskName is required' });
    }

    if (!clientActionId) {
      return res.status(400).json({ error: 'clientActionId is required for idempotency' });
    }

    console.log('[POST /start] Request:', {
      user: req.user.id,
      eventId,
      taskName,
      isUnplanned: isUnplanned || false,
      clientActionId
    });

    // IDEMPOTENCY CHECK: Look for existing timer with this clientActionId
    const { data: existingByActionId } = await req.supabase
      .from('active_timers')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('client_action_id', clientActionId)
      .maybeSingle();

    if (existingByActionId) {
      console.log('[POST /start] IDEMPOTENT: Returning existing timer for clientActionId:', clientActionId);
      const elapsedSeconds = Math.floor((Date.now() - new Date(existingByActionId.start_time)) / 1000);
      return res.status(200).json({
        activeTimer: {
          id: existingByActionId.id,
          eventId: existingByActionId.event_id,
          taskName: existingByActionId.task_name,
          isUnplanned: existingByActionId.is_unplanned,
          startTime: existingByActionId.start_time,
          elapsedSeconds: elapsedSeconds
        },
        idempotent: true
      });
    }

    // Check for existing active timer (from getActiveTimerForUser - SINGLE SOURCE OF TRUTH)
    const existing = await getActiveTimerForUser(req.supabase, req.user.id);

    if (existing) {
      const isStale = isStaleTimer(existing.start_time);
      const elapsedHours = (Date.now() - new Date(existing.start_time)) / (1000 * 60 * 60);

      console.log('[POST /start] Active timer exists:', {
        id: existing.id,
        task: existing.task_name,
        isStale,
        elapsedHours: elapsedHours.toFixed(2)
      });

      // If timer is stale, DELETE it before creating new one
      if (isStale) {
        console.log('[POST /start] Timer is STALE, deleting it before creating new timer');
        const { error: deleteError } = await req.supabase
          .from('active_timers')
          .delete()
          .eq('id', existing.id);

        if (deleteError) {
          console.error('[POST /start] Error deleting stale timer:', deleteError);
          return res.status(500).json({ error: 'Failed to remove stale timer' });
        }
        console.log('[POST /start] Stale timer deleted, proceeding to create new timer');
        // Fall through to create new timer
      } else {
        // Non-stale timer exists - check if same or different event

        // Same event - return existing timer (recovery)
        if (existing.event_id === eventId) {
          console.log('[POST /start] Same event - returning existing timer');
          const elapsedSeconds = Math.floor((Date.now() - new Date(existing.start_time)) / 1000);
          return res.status(409).json({
            error: 'Timer already active',
            sameEvent: true,
            activeTimer: {
              id: existing.id,
              eventId: existing.event_id,
              taskName: existing.task_name,
              isUnplanned: existing.is_unplanned,
              startTime: existing.start_time,
              elapsedSeconds: elapsedSeconds,
              isStale: false
            }
          });
        }

        // Different event - return conflict for user decision
        console.log('[POST /start] Different event - returning conflict');
        const elapsedSeconds = Math.floor((Date.now() - new Date(existing.start_time)) / 1000);
        return res.status(409).json({
          error: 'Timer already active',
          conflict: true,
          activeTimer: {
            id: existing.id,
            eventId: existing.event_id,
            taskName: existing.task_name,
            isUnplanned: existing.is_unplanned,
            startTime: existing.start_time,
            elapsedSeconds: elapsedSeconds,
            isStale: false,
            elapsedHours: elapsedHours
          }
        });
      }
    }

    // No active timer - create new one
    const startTime = new Date().toISOString();
    const { data, error } = await req.supabase
      .from('active_timers')
      .insert({
        user_id: req.user.id,
        event_id: eventId || null,
        task_name: taskName,
        is_unplanned: isUnplanned || false,
        start_time: startTime,
        last_heartbeat: startTime,
        client_action_id: clientActionId
      })
      .select()
      .single();

    if (error) {
      console.error('[POST /start] Error creating timer:', error);
      return res.status(500).json({ error: 'Failed to start timer', details: error.message });
    }

    console.log('[POST /start] Timer started:', data.id);

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
    console.error('[POST /start] Error:', error);
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

    console.log('[POST /stop] User:', req.user.id);

    const activeTimer = await getActiveTimerForUser(req.supabase, req.user.id);

    if (!activeTimer) {
      console.log('[POST /stop] No active timer found');
      return res.status(404).json({ error: 'No active timer found' });
    }

    const startTime = new Date(activeTimer.start_time);
    const endTime = new Date();
    const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));
    const durationSeconds = Math.max(60, Math.round((endTime - startTime) / 1000));

    console.log('[POST /stop] Stopping timer:', {
      id: activeTimer.id,
      task: activeTimer.task_name,
      duration: durationMinutes
    });

    // Create session
    const { data: session, error: sessionError } = await req.supabase
      .from('sessions')
      .insert({
        user_id: req.user.id,
        event_id: activeTimer.event_id,
        actual_start_time: activeTimer.start_time,
        actual_end_time: endTime.toISOString(),
        duration_minutes: durationMinutes,
        duration_seconds: durationSeconds,
        notes: notes || null
      })
      .select()
      .single();

    if (sessionError) {
      console.error('[POST /stop] Error creating session:', sessionError);
      return res.status(500).json({ error: 'Failed to save session', details: sessionError.message });
    }

    console.log('[POST /stop] Session created:', session.id);

    // Delete active timer
    const { error: deleteError } = await req.supabase
      .from('active_timers')
      .delete()
      .eq('id', activeTimer.id);

    if (deleteError) {
      console.error('[POST /stop] Error deleting active timer:', deleteError);
      // Session was saved, so don't fail the request
    } else {
      console.log('[POST /stop] Active timer deleted');
    }

    res.json({
      session: {
        id: session.id,
        eventId: session.event_id,
        startTime: session.actual_start_time,
        endTime: session.actual_end_time,
        durationMinutes: session.duration_minutes,
        notes: session.notes
      }
    });
  } catch (error) {
    console.error('[POST /stop] Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/timer/stop-stale-and-start
 * Stop a stale timer with capped duration and start a new timer atomically
 * Body: { oldTimerId, capOption: 'discard' | 'save_capped', newEventId, newTaskName, newIsUnplanned, clientActionId }
 */
router.post('/stop-stale-and-start', async (req, res) => {
  try {
    const { oldTimerId, capOption, newEventId, newTaskName, newIsUnplanned, clientActionId } = req.body;

    console.log('[POST /stop-stale-and-start] Request:', {
      user: req.user.id,
      oldTimerId,
      capOption,
      newEventId,
      newTaskName,
      newIsUnplanned,
      clientActionId
    });

    if (!oldTimerId || !capOption || !newTaskName || !clientActionId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (capOption !== 'discard' && capOption !== 'save_capped') {
      return res.status(400).json({ error: 'capOption must be "discard" or "save_capped"' });
    }

    // Get the old timer
    const oldTimer = await getActiveTimerForUser(req.supabase, req.user.id);

    if (!oldTimer) {
      return res.status(404).json({ error: 'No active timer found' });
    }

    if (oldTimer.id !== oldTimerId) {
      return res.status(400).json({ error: 'Timer ID mismatch' });
    }

    console.log('[POST /stop-stale-and-start] Old timer:', {
      id: oldTimer.id,
      task: oldTimer.task_name,
      isStale: isStaleTimer(oldTimer.start_time)
    });

    // Handle old timer based on capOption
    if (capOption === 'save_capped') {
      const startTime = new Date(oldTimer.start_time);
      const endTime = await calculateCappedEndTime(req.supabase, oldTimer);
      const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));
      const durationSeconds = Math.max(60, Math.round((endTime - startTime) / 1000));

      console.log('[POST /stop-stale-and-start] Saving capped session:', {
        duration: durationMinutes
      });

      // Create capped session
      const { error: sessionError } = await req.supabase
        .from('sessions')
        .insert({
          user_id: req.user.id,
          event_id: oldTimer.event_id,
          actual_start_time: oldTimer.start_time,
          actual_end_time: endTime.toISOString(),
          duration_minutes: durationMinutes,
          duration_seconds: durationSeconds,
          notes: 'Stale timer - capped duration'
        });

      if (sessionError) {
        console.error('[POST /stop-stale-and-start] Error saving session:', sessionError);
        return res.status(500).json({ error: 'Failed to save session' });
      }

      console.log('[POST /stop-stale-and-start] Capped session saved');
    } else {
      console.log('[POST /stop-stale-and-start] Discarding old timer without saving session');
    }

    // Delete old timer
    await req.supabase
      .from('active_timers')
      .delete()
      .eq('id', oldTimer.id);

    console.log('[POST /stop-stale-and-start] Old timer deleted');

    // Start new timer
    const newStartTime = new Date().toISOString();
    const { data: newTimer, error: newTimerError } = await req.supabase
      .from('active_timers')
      .insert({
        user_id: req.user.id,
        event_id: newEventId || null,
        task_name: newTaskName,
        is_unplanned: newIsUnplanned || false,
        start_time: newStartTime,
        last_heartbeat: newStartTime,
        client_action_id: clientActionId
      })
      .select()
      .single();

    if (newTimerError) {
      console.error('[POST /stop-stale-and-start] Error starting new timer:', newTimerError);
      return res.status(500).json({ error: 'Failed to start new timer' });
    }

    console.log('[POST /stop-stale-and-start] New timer started:', newTimer.id);

    res.json({
      activeTimer: {
        id: newTimer.id,
        eventId: newTimer.event_id,
        taskName: newTimer.task_name,
        isUnplanned: newTimer.is_unplanned,
        startTime: newTimer.start_time,
        elapsedSeconds: 0
      }
    });
  } catch (error) {
    console.error('[POST /stop-stale-and-start] Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/timer/stop-and-start
 * Stop current timer and start a new one atomically
 * Body: { oldTimerId, newEventId, newTaskName, newIsUnplanned, clientActionId }
 */
router.post('/stop-and-start', async (req, res) => {
  try {
    const { oldTimerId, newEventId, newTaskName, newIsUnplanned, clientActionId } = req.body;

    console.log('[POST /stop-and-start] Request:', {
      user: req.user.id,
      oldTimerId,
      newEventId,
      newTaskName,
      newIsUnplanned,
      clientActionId
    });

    if (!oldTimerId || !newTaskName || !clientActionId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get the old timer
    const oldTimer = await getActiveTimerForUser(req.supabase, req.user.id);

    if (!oldTimer) {
      return res.status(404).json({ error: 'No active timer found' });
    }

    if (oldTimer.id !== oldTimerId) {
      return res.status(400).json({ error: 'Timer ID mismatch' });
    }

    // Stop old timer at current time
    const startTime = new Date(oldTimer.start_time);
    const endTime = new Date();
    const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));
    const durationSeconds = Math.max(60, Math.round((endTime - startTime) / 1000));

    console.log('[POST /stop-and-start] Stopping old timer:', {
      id: oldTimer.id,
      duration: durationMinutes
    });

    // Create session for old timer
    const { error: sessionError } = await req.supabase
      .from('sessions')
      .insert({
        user_id: req.user.id,
        event_id: oldTimer.event_id,
        actual_start_time: oldTimer.start_time,
        actual_end_time: endTime.toISOString(),
        duration_minutes: durationMinutes,
        duration_seconds: durationSeconds,
        notes: null
      });

    if (sessionError) {
      console.error('[POST /stop-and-start] Error creating session:', sessionError);
      return res.status(500).json({ error: 'Failed to save session' });
    }

    console.log('[POST /stop-and-start] Old session saved');

    // Delete old timer
    await req.supabase
      .from('active_timers')
      .delete()
      .eq('id', oldTimer.id);

    console.log('[POST /stop-and-start] Old timer deleted');

    // Start new timer
    const newStartTime = new Date().toISOString();
    const { data: newTimer, error: newTimerError } = await req.supabase
      .from('active_timers')
      .insert({
        user_id: req.user.id,
        event_id: newEventId || null,
        task_name: newTaskName,
        is_unplanned: newIsUnplanned || false,
        start_time: newStartTime,
        last_heartbeat: newStartTime,
        client_action_id: clientActionId
      })
      .select()
      .single();

    if (newTimerError) {
      console.error('[POST /stop-and-start] Error starting new timer:', newTimerError);
      return res.status(500).json({ error: 'Failed to start new timer' });
    }

    console.log('[POST /stop-and-start] New timer started:', newTimer.id);

    res.json({
      activeTimer: {
        id: newTimer.id,
        eventId: newTimer.event_id,
        taskName: newTimer.task_name,
        isUnplanned: newTimer.is_unplanned,
        startTime: newTimer.start_time,
        elapsedSeconds: 0
      }
    });
  } catch (error) {
    console.error('[POST /stop-and-start] Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/timer/heartbeat
 * Update last_heartbeat timestamp to indicate the timer is still active
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
      console.error('[POST /heartbeat] Error:', error);
      return res.status(500).json({ error: 'Failed to update heartbeat' });
    }

    if (!data) {
      return res.status(404).json({ error: 'No active timer found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[POST /heartbeat] Error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
