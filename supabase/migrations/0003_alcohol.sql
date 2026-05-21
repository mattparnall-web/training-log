-- Coach Claude — Alcohol entries log.
-- One row per drink (or per multi-drink quick log). Used by the Alcohol tab,
-- the Dashboard ("yesterday's drinks"), and the coaching loop.

create table if not exists public.alcohol_entries (
  id            bigserial primary key,
  consumed_at   timestamptz not null default now(),
  drink_type    text not null,        -- 'beer' | 'wine' | 'spirit' | 'cocktail' | 'other'
  portion       text not null,        -- short label e.g. 'pint', 'medium_glass', 'double'
  display_label text,                  -- pretty label e.g. 'Pint of beer'
  units         numeric(5,2) not null, -- UK alcohol units
  calories      integer not null,
  notes         text
);

-- Indexes for the common queries (today's entries, this-week totals).
create index if not exists alcohol_entries_consumed_at_idx
  on public.alcohol_entries (consumed_at desc);

-- RLS off — matches the existing `sessions` table convention.
