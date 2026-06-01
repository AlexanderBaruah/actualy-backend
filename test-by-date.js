const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kodxtnmprtlbsafxizrw.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testByDate() {
  console.log('=== QUERYING SYNCED EVENTS ===\n');

  // Query synced events
  const { data: events, error } = await supabase
    .from('events')
    .select('id, name, start_time, end_time, google_calendar_event_id, synced_from_calendar')
    .eq('synced_from_calendar', true)
    .order('start_time', { ascending: true });

  if (error) {
    console.error('❌ Error:', error);
    console.log('Note: This may fail due to RLS. The actual authenticated endpoint should work.\n');
    return;
  }

  console.log(`📊 Found ${events.length} synced events\n`);

  if (events.length === 0) {
    console.log('No events found (likely RLS blocking)');
    return;
  }

  const pacificOffset = -7 * 60; // Pacific Daylight Time offset in minutes

  // Display all events
  events.forEach((event, i) => {
    const startUTC = new Date(event.start_time);
    const startPacific = new Date(startUTC.getTime() + (pacificOffset * 60 * 1000));
    const dateInPacific = startPacific.toISOString().split('T')[0];
    const timeStr = startPacific.toISOString().split('T')[1].substring(0, 5);

    console.log(`${i + 1}. ${event.name}`);
    console.log(`   📅 Pacific Date: ${dateInPacific}`);
    console.log(`   ⏰ Pacific Time: ${timeStr}`);
    console.log(`   🕐 Raw UTC: ${event.start_time}`);
    console.log('');
  });

  // Test by-date logic with first event
  if (events.length > 0) {
    const testEvent = events[0];
    const startUTC = new Date(testEvent.start_time);
    const startPacific = new Date(startUTC.getTime() + (pacificOffset * 60 * 1000));
    const testDate = startPacific.toISOString().split('T')[0];

    console.log(`\n=== TESTING /api/events/by-date FOR ${testDate} ===`);
    console.log(`Test event: "${testEvent.name}"\n`);

    // Replicate the FIXED by-date endpoint logic
    const [year, month, day] = testDate.split('-').map(Number);
    const dayStartPacific = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const dayEndPacific = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));

    // Convert Pacific midnight to UTC
    const startUTC_query = new Date(dayStartPacific.getTime() - (pacificOffset * 60 * 1000));
    const endUTC_query = new Date(dayEndPacific.getTime() - (pacificOffset * 60 * 1000));

    console.log('Query range (FIXED logic):');
    console.log(`  start_time >= ${startUTC_query.toISOString()}`);
    console.log(`  start_time < ${endUTC_query.toISOString()}`);
    console.log('');

    // Query
    const { data: results, error: queryError } = await supabase
      .from('events')
      .select('*')
      .gte('start_time', startUTC_query.toISOString())
      .lt('start_time', endUTC_query.toISOString())
      .order('start_time', { ascending: true });

    if (queryError) {
      console.error('❌ Query error:', queryError);
    } else {
      console.log(`✅ Query returned ${results.length} events:`);
      results.forEach(evt => {
        const evtStart = new Date(evt.start_time);
        const evtPacific = new Date(evtStart.getTime() + (pacificOffset * 60 * 1000));
        const evtTime = evtPacific.toISOString().split('T')[1].substring(0, 5);
        console.log(`  - ${evt.name} (${evtTime} Pacific)`);
      });

      const foundTestEvent = results.find(e => e.id === testEvent.id);
      if (!foundTestEvent) {
        console.log(`\n❌ Test event "${testEvent.name}" NOT found in results!`);
      } else {
        console.log(`\n✅ Test event "${testEvent.name}" found in results!`);
      }
    }
  }

  console.log('\n=== TEST COMPLETE ===');
}

testByDate().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
