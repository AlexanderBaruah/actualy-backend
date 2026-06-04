const express = require('express');
const router = express.Router();
const { authenticateUser } = require('../middleware/auth');

// All routes in this file require authentication
router.use(authenticateUser);

/**
 * Helper: Check if a timer is stale (from a different day or >12 hours old)
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
 * Shared helper: Get active timer for user with consistent stale timer handling
 * This ensures all endpoints agree on what "active" means
 *
 * @param {Object} supabase - Supabase client
 * @param {String} userId - User ID
 * @param {Boolean} autoResolveStale - If true, automatically resolve stale timers
 * @returns {Object} { timer: activeTimer or null, wasStale: boolean, resolved: boolean }
 */
async function getActiveTimer(supabase, userId, autoResolveStale = false) {
  console.log('[getActiveTimer] Fetching for user:', userId, 'autoResolve:', autoResolveStale);

  const { data: timer, error } = await supabase
    .from('active_timers')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[getActiveTimer] Error:', error);
    throw error;
  }

  if (!timer) {
    console.log('[getActiveTimer] No active timer found');
    return { timer: null, wasStale: false, resolved: false };
  }

  // Check if stale
  const isStale = isStaleTimer(timer.start_time);
  console.log('[getActiveTimer] Timer found:', timer.id, 'isStale:', isStale);

  if (isStale && autoResolveStale) {
    // Auto-resolve stale timer
    console.log('[getActiveTimer] Auto-resolving stale timer:', timer.id);

    // Calculate stop time
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
        console.log('[getActiveTimer] Using scheduled end time:', endTime.toISOString());
      } else {
        // Cap at +4 hours
        endTime = new Date(startTime.getTime() + 4 * 60 * 60 * 1000);
        console.log('[getActiveTimer] Capping at +4 hours:', endTime.toISOString());
      }
    } else {
      // Unplanned, cap at +4 hours
      endTime = new Date(startTime.getTime() + 4 * 60 * 60 * 1000);
      console.log('[getActiveTimer] Unplanned, capping at +4 hours:', endTime.toISOString());
    }

    const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));
    const durationSeconds = Math.max(60, Math.round((endTime - startTime) / 1000));

    // Create session
    try {
      await supabase
        .from('sessions')
        .insert({
          user_id: userId,
          event_id: timer.event_id,
          actual_start_time: timer.start_time,
          actual_end_time: endTime.toISOString(),
          duration_minutes: durationMinutes,
          duration_seconds: durationSeconds,
          notes: 'Auto-resolved stale timer'
        });

      console.log('[getActiveTimer] Session created for stale timer');
    } catch (sessionError) {
      console.error('[getActiveTimer] Failed to create session:', sessionError);
    }

    // Delete active_timers row
    await supabase
      .from('active_timers')
      .delete()
      .eq('id', timer.id);

    console.log('[getActiveTimer] Stale timer resolved and deleted');
    return { timer: null, wasStale: true, resolved: true };
  }

  // Return active timer (not stale or not auto-resolving)
  return { timer: timer, wasStale: isStale, resolved: false };
}

/**
 * GET /api/timer/active
 * Get the currently active timer for the authenticated user
 * Returns null if no timer is active
 */
router.get('/active', async (req, res) => {
  try {
    console.log('[GET /api/timer/active] Fetching active timer for user:', req.user.id);

    const { timer, wasStale, resolved } = await getActiveTimer(req.supabase, req.user.id, false);

    if (!timer) {
      console.log('[GET /api/timer/active] No active timer found', wasStale ? '(was stale)' : '');
      return res.json({ activeTimer: null });
    }

    // Calculate elapsed time
    const startTime = new Date(timer.start_time);
    const now = new Date();
    const elapsedSeconds = Math.floor((now - startTime) / 1000);

    console.log('[GET /api/timer/active] Active timer found:', {
      id: timer.id,
      task: timer.task_name,
      elapsed: elapsedSeconds,
      isUnplanned: timer.is_unplanned
    });

    res.json({
      activeTimer: {
        id: timer.id,
        eventId: timer.event_id,
        taskName: timer.task_name,
        isUnplanned: timer.is_unplanned,
        startTime: timer.start_time,
        elapsedSeconds: elapsedSeconds,
        lastHeartbeat: timer.last_heartbeat
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

    // Use shared helper with auto-resolve for stale timers
    const { timer: existing, wasStale, resolved } = await getActiveTimer(req.supabase, req.user.id, true);

    if (resolved) {
      console.log('[POST /api/timer/start] Stale timer was auto-resolved, proceeding with start');
      // Continue to create new timer below
    } else if (existing) {
      console.log('[POST /api/timer/start] Timer already active:', existing.id);

      // Same event - return existing timer (recovery)
      if (existing.event_id === eventId) {
        console.log('[POST /api/timer/start] Same event, returning existing timer');
        const startTime = new Date(existing.start_time);
        const now = new Date();
        const elapsedHours = (now - startTime) / (1000 * 60 * 60);

        return res.status(409).json({
          error: 'Timer already active',
          activeTimer: {
            id: existing.id,
            eventId: existing.event_id,
            taskName: existing.task_name,
            isUnplanned: existing.is_unplanned,
            startTime: existing.start_time,
            elapsedHours: elapsedHours,
            isStale: wasStale
          }
        });
      }

      // Different event - return 409 for conflict resolution
      const startTime = new Date(existing.start_time);
      const now = new Date();
      const elapsedHours = (now - startTime) / (1000 * 60 * 60);

      console.log('[POST /api/timer/start] Different event conflict:', {
        existing: existing.event_id,
        requested: eventId,
        elapsedHours: elapsedHours.toFixed(2),
        isStale: wasStale
      });

      return res.status(409).json({
        error: 'Timer already active',
        activeTimer: {
          id: existing.id,
          eventId: existing.event_id,
          taskName: existing.task_name,
          isUnplanned: existing.is_unplanned,
          startTime: existing.start_time,
          elapsedHours: elapsedHours,
          isStale: wasStale
        }
      });
    }

    // No active timer or stale timer resolved - create new timer
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

    const { timer: activeTimer, wasStale } = await getActiveTimer(req.supabase, req.user.id, false);

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

/**
 * POST /api/timer/stop-and-start
 * Stop an old timer and start a new one atomically
 * Body: { oldTimerId, newEventId, newTaskName, newIsUnplanned, stopTime? }
 */
router.post('/stop-and-start', async (req, res) => {
  try {
    const { oldTimerId, newEventId, newTaskName, newIsUnplanned, stopTime } = req.body;

    console.log('[STOP-AND-START] Request received:', {
      user: req.user.id,
      oldTimerId,
      newEventId,
      newTaskName,
      newIsUnplanned,
      stopTime
    });

    if (!oldTimerId || !newTaskName) {
      console.log('[STOP-AND-START] Missing required fields');
      return res.status(400).json({ error: 'oldTimerId and newTaskName are required' });
    }

    // Step 1: Get the old active timer
    console.log('[STOP-AND-START] Step 1: Fetching old active timer');
    const { timer: oldTimer, wasStale } = await getActiveTimer(req.supabase, req.user.id, false);

    if (!oldTimer) {
      console.log('[STOP-AND-START] No active timer found');
      return res.status(404).json({ error: 'No active timer found' });
    }

    if (oldTimer.id !== oldTimerId) {
      console.log('[STOP-AND-START] Timer ID mismatch:', { expected: oldTimerId, actual: oldTimer.id });
      return res.status(400).json({ error: 'Timer ID mismatch. Please refresh and try again.' });
    }

    // Step 2: Calculate stop time for old timer
    const startTime = new Date(oldTimer.start_time);
    let endTime;

    if (stopTime) {
      // Use provided stop time
      endTime = new Date(stopTime);
      console.log('[STOP-AND-START] Using provided stop time:', endTime.toISOString());
    } else if (isStaleTimer(oldTimer.start_time)) {
      // Stale timer - try to get scheduled end time or cap at +4 hours
      console.log('[STOP-AND-START] Old timer is stale, determining cap time');

      if (oldTimer.event_id) {
        // Try to get scheduled end_time from events table
        console.log('[STOP-AND-START] Fetching scheduled end time for event:', oldTimer.event_id);
        const { data: eventData, error: eventError } = await req.supabase
          .from('events')
          .select('end_time')
          .eq('id', oldTimer.event_id)
          .maybeSingle();

        if (eventError) {
          console.error('[STOP-AND-START] Error fetching event end time:', eventError);
        }

        if (eventData && eventData.end_time) {
          const scheduledEndTime = new Date(eventData.end_time);
          console.log('[STOP-AND-START] Using scheduled end time:', scheduledEndTime.toISOString());
          endTime = scheduledEndTime;
        } else {
          // No scheduled end time, cap at +4 hours
          endTime = new Date(startTime.getTime() + 4 * 60 * 60 * 1000);
          console.log('[STOP-AND-START] No scheduled end time, capping at +4 hours:', endTime.toISOString());
        }
      } else {
        // Unplanned task, cap at +4 hours
        endTime = new Date(startTime.getTime() + 4 * 60 * 60 * 1000);
        console.log('[STOP-AND-START] Unplanned task, capping at +4 hours:', endTime.toISOString());
      }
    } else {
      // Timer from today, stop at current time
      endTime = new Date();
      console.log('[STOP-AND-START] Timer from today, stopping at current time:', endTime.toISOString());
    }

    const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));
    const durationSeconds = Math.max(60, Math.round((endTime - startTime) / 1000));

    console.log('[STOP-AND-START] Old timer duration:', {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMinutes,
      durationSeconds
    });

    // Step 3: Create session for old timer
    console.log('[STOP-AND-START] Step 3: Creating session for old timer');
    const { data: session, error: sessionError } = await req.supabase
      .from('sessions')
      .insert({
        user_id: req.user.id,
        event_id: oldTimer.event_id,
        actual_start_time: oldTimer.start_time,
        actual_end_time: endTime.toISOString(),
        duration_minutes: durationMinutes,
        duration_seconds: durationSeconds,
        notes: null
      })
      .select()
      .single();

    if (sessionError) {
      console.error('[STOP-AND-START] Error creating session:', sessionError);
      return res.status(500).json({ error: 'Failed to save session', details: sessionError.message });
    }

    console.log('[STOP-AND-START] Session created:', session.id);

    // Step 4: Delete old active timer
    console.log('[STOP-AND-START] Step 4: Deleting old active timer');
    const { error: deleteError } = await req.supabase
      .from('active_timers')
      .delete()
      .eq('id', oldTimer.id);

    if (deleteError) {
      console.error('[STOP-AND-START] Error deleting old timer:', deleteError);
      // Continue anyway - session was saved
    }

    // Step 5: Create new active timer
    console.log('[STOP-AND-START] Step 5: Creating new active timer');
    const newStartTime = new Date().toISOString();
    const { data: newTimer, error: newTimerError } = await req.supabase
      .from('active_timers')
      .insert({
        user_id: req.user.id,
        event_id: newEventId || null,
        task_name: newTaskName,
        is_unplanned: newIsUnplanned || false,
        start_time: newStartTime,
        last_heartbeat: newStartTime
      })
      .select()
      .single();

    if (newTimerError) {
      console.error('[STOP-AND-START] Error creating new timer:', newTimerError);
      return res.status(500).json({ error: 'Failed to start new timer', details: newTimerError.message });
    }

    console.log('[STOP-AND-START] New timer started:', newTimer.id);
    console.log('[STOP-AND-START] SUCCESS: Stopped old timer and started new timer');

    res.json({
      activeTimer: {
        id: newTimer.id,
        eventId: newTimer.event_id,
        taskName: newTimer.task_name,
        isUnplanned: newTimer.is_unplanned,
        startTime: newTimer.start_time,
        elapsedSeconds: 0
      },
      oldSession: {
        id: session.id,
        durationMinutes: session.duration_minutes
      }
    });
  } catch (error) {
    console.error('[STOP-AND-START] Server error:', error);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

module.exports = router;
