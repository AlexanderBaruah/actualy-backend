require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function debugTimerState() {
  console.log('=== ACTIVE TIMERS STATE ===\n');

  // Query all active_timers
  const { data: activeTimers, error: activeError } = await supabase
    .from('active_timers')
    .select('*')
    .order('created_at', { ascending: false });

  if (activeError) {
    console.error('Error fetching active_timers:', activeError);
  } else {
    console.log(`Found ${activeTimers.length} active timer(s):\n`);
    activeTimers.forEach(t => {
      console.log(`  ID: ${t.id}`);
      console.log(`  User ID: ${t.user_id}`);
      console.log(`  Event ID: ${t.event_id}`);
      console.log(`  Task: "${t.task_name}"`);
      console.log(`  Unplanned: ${t.is_unplanned}`);
      console.log(`  Start time: ${t.start_time}`);
      console.log(`  Last heartbeat: ${t.last_heartbeat}`);
      console.log(`  Created: ${t.created_at}`);
      console.log(`  Updated: ${t.updated_at}`);

      // Calculate time since last heartbeat
      const lastHeartbeat = new Date(t.last_heartbeat);
      const now = new Date();
      const minutesSinceHeartbeat = Math.floor((now - lastHeartbeat) / 60000);
      console.log(`  Minutes since last heartbeat: ${minutesSinceHeartbeat}`);

      // Calculate elapsed time
      const startTime = new Date(t.start_time);
      const elapsedSeconds = Math.floor((now - startTime) / 1000);
      console.log(`  Elapsed time: ${Math.floor(elapsedSeconds / 60)} minutes`);
      console.log('');
    });
  }

  // Get today's date range in Pacific Time
  const now = new Date();
  const pacificOffset = -7 * 60;
  const localTime = new Date(now.getTime() + (pacificOffset * 60 * 1000));
  const todayPacific = new Date(localTime.getFullYear(), localTime.getMonth(), localTime.getDate());
  const tomorrowPacific = new Date(todayPacific);
  tomorrowPacific.setDate(tomorrowPacific.getDate() + 1);
  const today = new Date(todayPacific.getTime() - (pacificOffset * 60 * 1000));
  const tomorrow = new Date(tomorrowPacific.getTime() - (pacificOffset * 60 * 1000));

  console.log('=== TODAY\'S SESSIONS ===\n');

  const { data: sessions, error: sessionsError } = await supabase
    .from('sessions')
    .select('*')
    .gte('created_at', today.toISOString())
    .lt('created_at', tomorrow.toISOString())
    .order('created_at', { ascending: false });

  if (sessionsError) {
    console.error('Error fetching sessions:', sessionsError);
  } else {
    console.log(`Found ${sessions.length} session(s) created today:\n`);
    sessions.forEach(s => {
      console.log(`  Session ID: ${s.id}`);
      console.log(`  Event ID: ${s.event_id}`);
      console.log(`  Start: ${s.actual_start_time}`);
      console.log(`  End: ${s.actual_end_time}`);
      console.log(`  Duration: ${s.duration_minutes} minutes`);
      console.log(`  Notes: "${s.notes || '(none)'}"`);
      console.log(`  Created: ${s.created_at}`);
      console.log('');
    });
  }

  // Analysis
  console.log('=== ANALYSIS ===');

  if (activeTimers && activeTimers.length > 0 && sessions && sessions.length > 0) {
    console.log('⚠️  WARNING: Found both active timers AND recent sessions.');
    console.log('This suggests /api/timer/stop may be saving sessions but NOT deleting active_timers rows.');
    console.log('\nCheck:');
    console.log('1. Did the last session correspond to an active timer?');
    console.log('2. Should the active_timers row have been deleted when that session was created?');
  } else if (activeTimers && activeTimers.length > 0) {
    console.log('✓ Active timer exists in database.');
    const timer = activeTimers[0];
    const minutesSinceHeartbeat = Math.floor((now - new Date(timer.last_heartbeat)) / 60000);

    if (minutesSinceHeartbeat > 5) {
      console.log(`⚠️  WARNING: Last heartbeat was ${minutesSinceHeartbeat} minutes ago (stale).`);
      console.log('This timer may be abandoned. Consider adding stale timer recovery.');
    } else {
      console.log('✓ Heartbeat is recent (within last 5 minutes).');
    }
  } else if (sessions && sessions.length > 0) {
    console.log('✓ No active timers (correct after stop).');
    console.log('✓ Recent sessions exist (timer was properly saved).');
  } else {
    console.log('No active timers and no recent sessions.');
  }
}

debugTimerState().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
