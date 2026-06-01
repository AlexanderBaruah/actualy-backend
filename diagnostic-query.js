const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kodxtnmprtlbsafxizrw.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function runDiagnostics() {
  console.log('=== DIAGNOSTIC QUERY FOR SYNCED GOOGLE CALENDAR EVENTS ===\n');

  // Query all events where synced_from_calendar = true (bypassing RLS by using anon client)
  // Note: This will only work if RLS allows reading without user context, otherwise will return empty
  const { data: allEvents, error: allError } = await supabase
    .from('events')
    .select('id, name, start_time, end_time, google_calendar_event_id, synced_from_calendar')
    .eq('synced_from_calendar', true)
    .order('start_time', { ascending: true });

  if (allError) {
    console.error('❌ Error querying synced events:', allError);
    console.log('\n⚠️  This is expected if Row Level Security (RLS) is enabled.');
    console.log('RLS requires authenticated user context, which this script does not provide.');
    console.log('The actual sync endpoint uses authenticated requests, so events may exist but not be visible here.\n');
    return;
  }

  console.log(`📊 Total synced events found: ${allEvents.length}\n`);

  if (allEvents.length === 0) {
    console.log('⚠️  No synced events found in database.');
    console.log('\nPossible reasons:');
    console.log('1. Sync has not been run yet');
    console.log('2. All synced events were deleted by reconciliation');
    console.log('3. RLS is blocking the query (this script uses anon key without user context)');
    console.log('4. Events were inserted but immediately deleted\n');
    return;
  }

  // Display all synced events
  const pacificOffset = -7 * 60; // Pacific Daylight Time offset in minutes

  allEvents.forEach((event, index) => {
    const startUTC = new Date(event.start_time);
    const endUTC = new Date(event.end_time);

    // Convert to Pacific Time
    const startPacific = new Date(startUTC.getTime() + (pacificOffset * 60 * 1000));
    const endPacific = new Date(endUTC.getTime() + (pacificOffset * 60 * 1000));

    const dateInPacific = startPacific.toISOString().split('T')[0];
    const startTime = startPacific.toISOString().split('T')[1].substring(0, 5);
    const endTime = endPacific.toISOString().split('T')[1].substring(0, 5);

    console.log(`${index + 1}. ${event.name}`);
    console.log(`   📅 Pacific Date: ${dateInPacific}`);
    console.log(`   ⏰ Pacific Time: ${startTime} - ${endTime}`);
    console.log(`   🔗 Google Calendar ID: ${event.google_calendar_event_id}`);
    console.log(`   🆔 DB ID: ${event.id}`);
    console.log(`   📝 Raw UTC start_time: ${event.start_time}`);
    console.log('');
  });

  // Pick the first event and test the by-date endpoint logic
  if (allEvents.length > 0) {
    const firstEvent = allEvents[0];
    const startUTC = new Date(firstEvent.start_time);
    const startPacific = new Date(startUTC.getTime() + (pacificOffset * 60 * 1000));
    const testDate = startPacific.toISOString().split('T')[0];

    console.log(`\n=== TESTING /api/events/by-date LOGIC FOR ${testDate} ===\n`);
    console.log(`Using first event: "${firstEvent.name}"\n`);

    // Replicate the FIXED by-date endpoint logic
    const [year, month, day] = testDate.split('-').map(Number);
    const dayStartPacific = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const dayEndPacific = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));

    // Convert Pacific midnight to UTC
    const startUTC_query = new Date(dayStartPacific.getTime() - (pacificOffset * 60 * 1000));
    const endUTC_query = new Date(dayEndPacific.getTime() - (pacificOffset * 60 * 1000));

    console.log('Query parameters (FIXED logic):');
    console.log(`  Target date (Pacific): ${testDate}`);
    console.log(`  Query range (UTC):`);
    console.log(`    start_time >= ${startUTC_query.toISOString()}`);
    console.log(`    start_time < ${endUTC_query.toISOString()}`);
    console.log('');

    // Query using the fixed logic
    const { data: queryResults, error: queryError } = await supabase
      .from('events')
      .select('*')
      .gte('start_time', startUTC_query.toISOString())
      .lt('start_time', endUTC_query.toISOString())
      .order('start_time', { ascending: true });

    if (queryError) {
      console.error('❌ Error querying by date:', queryError);
    } else {
      console.log(`✅ Query returned ${queryResults.length} events:`);
      queryResults.forEach(evt => {
        const evtStart = new Date(evt.start_time);
        const evtPacific = new Date(evtStart.getTime() + (pacificOffset * 60 * 1000));
        const evtTime = evtPacific.toISOString().split('T')[1].substring(0, 5);
        console.log(`  - ${evt.name} (${evtTime} Pacific)`);
      });

      if (queryResults.length === 0) {
        console.log('  ⚠️  No events found! This suggests the timezone fix may not be working correctly.');
      } else if (!queryResults.find(e => e.id === firstEvent.id)) {
        console.log(`  ⚠️  The test event "${firstEvent.name}" was NOT in the results!`);
        console.log('  This is unexpected since we queried for its date.');
      } else {
        console.log(`  ✅ The test event "${firstEvent.name}" WAS found in the results.`);
      }
    }
  }

  console.log('\n=== DIAGNOSTIC COMPLETE ===');
}

runDiagnostics().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
