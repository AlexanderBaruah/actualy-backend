require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function debugUnplanned() {
  console.log('=== UNPLANNED EVENTS ===');
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('*')
    .eq('is_unplanned', true)
    .order('created_at', { ascending: false })
    .limit(10);

  if (eventsError) {
    console.error('Error fetching unplanned events:', eventsError);
  } else {
    console.log(`Found ${events.length} unplanned events:`);
    events.forEach(e => {
      console.log(`  ID: ${e.id}`);
      console.log(`  Name: "${e.name}"`);
      console.log(`  Start: ${e.start_time}`);
      console.log(`  End: ${e.end_time}`);
      console.log(`  is_unplanned: ${e.is_unplanned}`);
      console.log(`  Color: ${e.color}`);
      console.log(`  Created: ${e.created_at}`);
      console.log('');
    });
  }

  console.log('=== SESSIONS FOR UNPLANNED EVENTS ===');
  if (events && events.length > 0) {
    const eventIds = events.map(e => e.id);
    const { data: sessions, error: sessionsError } = await supabase
      .from('sessions')
      .select('*')
      .in('event_id', eventIds)
      .order('created_at', { ascending: false });

    if (sessionsError) {
      console.error('Error fetching sessions:', sessionsError);
    } else {
      console.log(`Found ${sessions.length} sessions for unplanned events:`);
      sessions.forEach(s => {
        console.log(`  Session ID: ${s.id}`);
        console.log(`  Event ID: ${s.event_id}`);
        console.log(`  Actual Start: ${s.actual_start_time}`);
        console.log(`  Actual End: ${s.actual_end_time}`);
        console.log(`  Duration: ${s.duration_minutes} mins`);
        console.log(`  Notes: "${s.notes || ''}"`);
        console.log('');
      });
    }
  }

  console.log('=== SESSIONS TABLE SCHEMA ===');
  const { data: schemaData, error: schemaError } = await supabase
    .from('sessions')
    .select('*')
    .limit(1);

  if (!schemaError && schemaData && schemaData.length > 0) {
    console.log('Sessions table columns:', Object.keys(schemaData[0]).join(', '));
  }
}

debugUnplanned().then(() => process.exit(0));
