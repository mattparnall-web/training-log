-- Coach Claude — User-editable weekly programme.
--
-- Until now the 7-day split (Mon Upper Push, Tue Upper Pull + Deads, ...)
-- has been hardcoded in src/tabs/_shared.jsx and duplicated in
-- src/WorkoutTracker.jsx. This column lets the user edit the programme in
-- the app — names, workout types, and macro buckets per day — without code
-- changes.
--
-- Shape (array of 7, Mon..Sun in that order):
-- [
--   {
--     "name":   "Upper Push",     -- display name (free text, athlete-editable)
--     "type":   "upper_push",     -- workout type (picks exercise templates)
--     "bucket": "lifting"         -- macro target bucket: rest | lifting | big
--   },
--   ...
-- ]
--
-- If this column is null (e.g. for users who upgrade), the app falls back to
-- the hardcoded DEFAULT_WEEKLY_SCHEDULE so nothing breaks.

alter table public.settings
  add column if not exists weekly_schedule jsonb;
