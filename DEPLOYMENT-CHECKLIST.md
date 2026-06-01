# Server-Side Timer Deployment Checklist

## ⚠️ CRITICAL: Database Migration Required

The app **WILL NOT WORK** until you run the database migration. Follow these steps immediately:

### Step 1: Run Database Migration

1. Log in to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your Actualy project
3. Click **SQL Editor** in the left sidebar
4. Click **New Query**
5. Copy the entire contents of `migrations/create-active-timers.sql`
6. Paste into the SQL editor
7. Click **Run** (or press Cmd+Enter)

**Expected output:**
```
status                          | row_count
-------------------------------|----------
active_timers table created    |     0
```

If you see this output, the migration succeeded! ✅

### Step 2: Verify Migration

Run this query in the SQL Editor to confirm the table exists:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name = 'active_timers';
```

You should see one row returned with `active_timers`.

### Step 3: Test the App

1. **Open the app:** https://actualy-backend.vercel.app
2. **Start a timer:**
   - Click "Start" on any planned event
   - OR click "Start unplanned task" and create a task
3. **Check browser console:**
   - Open DevTools (F12 or Cmd+Option+I)
   - Look for `[TIMER]` logs confirming server calls
4. **Test cross-device sync:**
   - Open the app on your phone
   - The active timer should appear within 5 seconds
5. **Test recovery:**
   - Refresh the page
   - The timer should persist with correct elapsed time
6. **Stop the timer:**
   - Click "Stop"
   - Check that the session was saved to History

## What Changed

### Backend
- **New table:** `active_timers` stores currently running timers
- **New API endpoints:**
  - `GET /api/timer/active` - fetch active timer
  - `POST /api/timer/start` - start timer
  - `POST /api/timer/stop` - stop timer and save session
  - `POST /api/timer/heartbeat` - update heartbeat
- **Server is now the source of truth** for active timers

### Frontend
- **Server-first recovery:** Fetches active timer from server on load
- **Polling:** Syncs timer state every 5 seconds (cross-device)
- **Heartbeat:** Updates server every 30 seconds while timer runs
- **Error handling:** Shows clear alerts if start/stop fails
- **Time accuracy:** Uses server timestamp, not accumulated intervals

### Benefits
✅ Timers persist across devices/tabs
✅ No data loss from browser sleep/background
✅ Accurate elapsed time calculations
✅ Cross-device timer visibility
✅ Clear error messages if something goes wrong

## Damage Control Report

**Lost timer status:**
- ❌ No data found in database for today's lost timer
- ❌ No recovery possible (timer never reached server)
- 📝 You will need to manually add the lost ~2h of work
- ✅ This fix prevents future data loss

To manually add lost time:
1. Go to History tab
2. Estimate the start/end time of lost work
3. Add a session manually (if there's a way to do this in the UI)
4. Or use the database directly to insert a session record

## Troubleshooting

### "Failed to start timer" error
- Check browser console for details
- Verify migration was run successfully
- Check Supabase logs for errors

### Timer not appearing on other devices
- Wait 5 seconds for polling to sync
- Check that both devices are logged in as the same user
- Check browser console for `[TIMER] Polling:` logs

### Timer disappeared after refresh
- Check browser console for `[TIMER] Recovering:` logs
- Verify `/api/timer/active` endpoint is working
- Check Supabase RLS policies are correct

### "Timer already active" when trying to start
- This is expected behavior (one timer at a time)
- Stop the existing timer first
- OR check `/api/timer/active` to see what timer is running

## Console Logs to Watch

All timer operations log with `[TIMER]` prefix:
- `[TIMER] Starting timer for event X`
- `[TIMER] Stopping timer, duration: X seconds`
- `[TIMER] Polling: server has active timer X, local is Y`
- `[TIMER] Recovering: found active timer on server`
- `[TIMER] Heartbeat sent successfully`

These logs help diagnose any issues.

## Verification Checklist

After migration, verify these behaviors:

- [ ] Start timer on laptop → works
- [ ] Open app on phone → timer appears within 5 seconds
- [ ] Refresh laptop → timer persists
- [ ] Close tab and reopen → timer persists
- [ ] Let browser sleep → timer shows correct time on wake
- [ ] Stop timer on phone → laptop clears within 5 seconds
- [ ] Try to start second timer → shows conflict error
- [ ] Check History → session was saved correctly
- [ ] Stats include tracked time → correct
- [ ] Unplanned tasks work → yes
- [ ] Planned tasks work → yes

All checks passing? You're good to go! 🎉

## Support

If you encounter issues:
1. Check the `[TIMER]` logs in browser console
2. Check Vercel logs: `npx vercel logs https://actualy-backend.vercel.app --limit 50`
3. Check Supabase logs in the dashboard
4. Verify the migration ran successfully
5. Check that RLS policies are enabled on `active_timers` table
