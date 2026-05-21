-- Coach Claude — Food entries log.
-- One row per logged meal/snack/drink. The Food tab inserts; the Dashboard
-- + coaching loop read today's running totals + yesterday's intake.

create table if not exists public.food_entries (
  id            bigserial primary key,
  consumed_at   timestamptz not null default now(),
  source        text not null,           -- 'photo' | 'text' | 'manual'
  name          text not null,           -- e.g. "Chicken with rice and broccoli"
  calories      integer,
  protein_g     numeric(6,1),
  carbs_g       numeric(6,1),
  fat_g         numeric(6,1),
  ai_confidence text,                    -- 'low' | 'medium' | 'high' | null
  ai_notes      text,                    -- Claude's caveats
  notes         text                     -- user notes
);

create index if not exists food_entries_consumed_at_idx
  on public.food_entries (consumed_at desc);

-- RLS off — matches existing `sessions` table convention.
