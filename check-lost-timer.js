require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function checkLostTimer() {
  console.log('=== CHECKING FOR LOST TIMER DATA ===\n');

  // Get today's date range in Pacific Time
  const now = new Date();
  const pacificOffset = -7 * 60;
  const localTime = new Date(now.getTime() + (pacificOffset * 60 * 1000));
  const todayPacific = new Date(localTime.getFullYear(), localTime.getMonth(), localTime.getDate());
  const tomorrowPacific = new Date(todayPacific);
  tomorrowPacific.setDate(tomorrowPacific.getDate() + 1);
  const today = new Date(todayPacific.getTime() - (pacificOffset * 60 * 1000));
  const tomorrow = new Date(tomorrowPacific.getTime() - (pacificOffset * 60 * 1000));

  console.log(`Searching for activity today (${today.toISOString().split('T')[0]})\n`);

  // Check recent events created today
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('*')
    .gte('created_at', today.toISOString())
    .lt('created_at', tomorrow.toISOString())
    .order('created_at', { ascending: false });

  if (eventsError) {
    console.error('Error fetching events:', eventsError);
  } else {
    console.log(`Found ${events.length} events created today:\n`);
    events.forEach(e => {
      console.log(`  Event: "${e.name}"`);
      console.log(`  ID: ${e.id}`);
      console.log(`  Start: ${e.start_time}`);
      console.log(`  End: ${e.end_time}`);
      console.log(`  Unplanned: ${e.is_unplanned || false}`);
      console.log(`  Created: ${e.created_at}`);
      console.log('');
    });
  }

  // Check recent sessions created today
  const { data: sessions, error: sessionsError } = await supabase
    .from('sessions')
    .select('*')
    .gte('created_at', today.toISOString())
    .lt('created_at', tomorrow.toISOString())
    .order('created_at', { ascending: false });

  if (sessionsError) {
    console.error('Error fetching sessions:', sessionsError);
  } else {
    console.log(`Found ${sessions.length} sessions created today:\n`);
    sessions.forEach(s => {
      console.log(`  Session ID: ${s.id}`);
      console.log(`  Event ID: ${s.event_id}`);
      console.log(`  Start: ${s.actual_start_time}`);
      console.log(`  End: ${s.actual_end_time}`);
      console.log(`  Duration: ${s.duration_minutes} mins`);
      console.log(`  Notes: "${s.notes || '(none)'}"`);
      console.log(`  Created: ${s.created_at}`);
      console.log('');
    });
  }

  // Check for incomplete sessions (no end time or 0 duration)
  const { data: incompleteSessions, error: incompleteError } = await supabase
    .from('sessions')
    .select('*')
    .gte('created_at', today.toISOString())
    .or('actual_end_time.is.null,duration_minutes.eq.0')
    .order('created_at', { ascending: false });

  if (!incompleteError && incompleteSessions && incompleteSessions.length > 0) {
    console.log(`\n=== INCOMPLETE SESSIONS (POTENTIAL RECOVERY) ===\n`);
    incompleteSessions.forEach(s => {
      console.log(`  Session ID: ${s.id}`);
      console.log(`  Event ID: ${s.event_id}`);
      console.log(`  Start: ${s.actual_start_time}`);
      console.log(`  End: ${s.actual_end_time || '(NULL - INCOMPLETE)'}`);
      console.log(`  Duration: ${s.duration_minutes} mins`);
      console.log(`  Created: ${s.created_at}`);
      console.log('');
    });
  } else {
    console.log('\nNo incomplete sessions found.\n');
  }

  // Summary
  console.log('=== SUMMARY ===');
  console.log(`Total events created today: ${events?.length || 0}`);
  console.log(`Total sessions created today: ${sessions?.length || 0}`);
  console.log(`Incomplete sessions: ${incompleteSessions?.length || 0}`);

  if ((events?.length || 0) === 0 && (sessions?.length || 0) === 0) {
    console.log('\n⚠️  NO DATA FOUND for today.');
    console.log('The lost timer did not create any server-side records.');
    console.log('You will need to manually add the lost session.');
  } else {
    console.log('\n✅ Data found above. Review for potential recovery.');
  }
}

checkLostTimer().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
