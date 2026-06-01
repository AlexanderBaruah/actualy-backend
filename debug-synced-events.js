const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kodxtnmprtlbsafxizrw.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function debugSyncedEvents() {
  console.log('=== QUERYING ALL EVENTS ===\n');

  // First, query ALL events to see what's in the database
  const { data: allEvents, error: allError } = await supabase
    .from('events')
    .select('*')
    .order('start_time', { ascending: true });

  if (allError) {
    console.error('Error querying all events:', allError);
    return;
  }

  console.log(`Total events in database: ${allEvents.length}\n`);

  allEvents.forEach((evt, i) => {
    console.log(`${i + 1}. ${evt.name}`);
    console.log(`   synced_from_calendar: ${evt.synced_from_calendar}`);
    console.log(`   google_calendar_event_id: ${evt.google_calendar_event_id || 'null'}`);
    console.log(`   start_time: ${evt.start_time}`);
    console.log('');
  });

  console.log('\n=== QUERYING SYNCED GOOGLE CALENDAR EVENTS ===\n');

  // Query all synced events
  const { data: events, error } = await supabase
    .from('events')
    .select('*')
    .eq('synced_from_calendar', true)
    .order('start_time', { ascending: true });

  if (error) {
    console.error('Error querying events:', error);
    return;
  }

  console.log(`Found ${events.length} synced events:\n`);

  // Convert each event to Pacific Time and show details
  const pacificOffset = -7 * 60; // Pacific Daylight Time offset in minutes

  events.forEach((event, index) => {
    const startUTC = new Date(event.start_time);

    // Convert to Pacific Time
    const startPacific = new Date(startUTC.getTime() + (pacificOffset * 60 * 1000));
    const dateInPacific = startPacific.toISOString().split('T')[0];

    console.log(`${index + 1}. ${event.name}`);
    console.log(`   Raw start_time (UTC): ${event.start_time}`);
    console.log(`   Pacific Time: ${startPacific.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}`);
    console.log(`   Date in Pacific: ${dateInPacific}`);
    console.log(`   ID: ${event.id}`);
    console.log('');
  });

  // Test the by-date endpoint logic for the first event's date
  if (events.length > 0) {
    const firstEvent = events[0];
    const startUTC = new Date(firstEvent.start_time);
    const startPacific = new Date(startUTC.getTime() + (pacificOffset * 60 * 1000));
    const testDate = startPacific.toISOString().split('T')[0];

    console.log(`\n=== TESTING GET /api/events/by-date LOGIC FOR ${testDate} ===\n`);

    // Replicate the by-date endpoint logic
    const targetDate = new Date(testDate + 'T12:00:00');
    const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Convert to UTC for database query
    const startUTC_query = new Date(dayStart.getTime() - (pacificOffset * 60 * 1000));
    const endUTC_query = new Date(dayEnd.getTime() - (pacificOffset * 60 * 1000));

    console.log(`Query parameters:`);
    console.log(`  Target date (Pacific): ${testDate}`);
    console.log(`  Day start (Pacific): ${dayStart.toISOString()}`);
    console.log(`  Day end (Pacific): ${dayEnd.toISOString()}`);
    console.log(`  Query range (UTC):`);
    console.log(`    start_time >= ${startUTC_query.toISOString()}`);
    console.log(`    start_time < ${endUTC_query.toISOString()}`);
    console.log('');

    // Query using the same logic as the endpoint
    const { data: queryResults, error: queryError } = await supabase
      .from('events')
      .select('*')
      .gte('start_time', startUTC_query.toISOString())
      .lt('start_time', endUTC_query.toISOString())
      .order('start_time', { ascending: true });

    if (queryError) {
      console.error('Error querying by date:', queryError);
    } else {
      console.log(`Query returned ${queryResults.length} events:`);
      queryResults.forEach(evt => {
        console.log(`  - ${evt.name} (start_time: ${evt.start_time})`);
      });
    }
  }
}

debugSyncedEvents().then(() => {
  console.log('\n=== DEBUG COMPLETE ===');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
