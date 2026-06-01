# Database Migrations

## How to Run Migrations

1. Log in to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to SQL Editor
4. Copy and paste the SQL from the migration file
5. Click "Run" to execute

## Migration: add-is-unplanned.sql

**Purpose:** Add `is_unplanned` column to support filtering unplanned tasks from planned views.

**What it does:**
- Adds `is_unplanned` boolean column with default `false`
- Backfills existing rows (sets NULL to false)
- Creates an index for better query performance
- Verifies the migration completed successfully

**When to run:**
This migration should be run immediately after deploying the code changes that reference the `is_unplanned` column.

**Expected output:**
```
total_events | unplanned_count | planned_count | null_count
-------------|-----------------|---------------|------------
     10      |       0         |      10       |     0
```

All existing events should show as `planned_count` after the migration.
