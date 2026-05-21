-- Coach Claude — Settings table.
-- Single row (id = 1) holding the user's goals + key lifts list. Read by the
-- Settings tab and the Dashboard / coaching loop downstream.

create table if not exists public.settings (
  id                            integer primary key default 1,
  daily_calorie_target          integer,
  daily_protein_target_g        integer,
  weekly_alcohol_units_target   integer,
  key_lifts                     jsonb default '[]'::jsonb,
  -- key_lifts shape: [ { "name": "Back Squat", "target_kg": 120 }, ... ]
  updated_at                    timestamptz not null default now(),
  constraint singleton_row check (id = 1)
);

-- RLS off — matches the existing `sessions` table convention for this personal-use app.
-- The publishable key on the client can read/write directly.

-- Seed an empty row so the app always has something to load.
insert into public.settings (id) values (1) on conflict (id) do nothing;
