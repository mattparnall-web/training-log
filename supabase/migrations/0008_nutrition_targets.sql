-- Coach Claude — Nutrition Targets per day-type bucket.
-- Matt's nutrition strategy varies macros by training intensity:
--   * Rest      — protein floor, lowest carbs (~240g), 65-80g fat, ~2200 cal
--     Wed (recovery), Fri (flexible)
--   * Lifting   — protein floor, mid carbs (~305g),    65-80g fat, ~2500-2650 cal
--     Mon (upper push), Tue (upper pull), Sat (Olympic + MetCon)
--   * Big       — protein floor, high carbs (~470g+),  65-80g fat, ~3200+ cal
--     Thu (lower / squat), Sun (Zone 2 cardio)
-- Protein is fixed across all days (150g floor); the lever is carbs (and total cal).
--
-- Stored as a single jsonb column on `settings` so we don't need to migrate
-- schema again if the bucket model changes (e.g. add an "endurance" bucket later).

alter table public.settings add column if not exists nutrition_targets jsonb;

-- Seed sensible defaults if not already set.
update public.settings
set nutrition_targets = jsonb_build_object(
  'rest',    jsonb_build_object('calories', 2200, 'protein_g', 150, 'fat_g', 70, 'carbs_g', 240),
  'lifting', jsonb_build_object('calories', 2575, 'protein_g', 150, 'fat_g', 72, 'carbs_g', 305),
  'big',     jsonb_build_object('calories', 3200, 'protein_g', 150, 'fat_g', 75, 'carbs_g', 470)
)
where id = 1 and nutrition_targets is null;
