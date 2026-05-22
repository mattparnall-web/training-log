-- Coach Claude — Supplements / recovery actions log.
-- Quick-tap one row per item: protein shake, vitamins, omega 3, collagen,
-- creatine, ice bath, sauna, etc. No macros — the value is the consistency.

create table if not exists public.supps_entries (
  id            bigserial primary key,
  consumed_at   timestamptz not null default now(),
  supp_type     text not null,        -- 'protein' | 'vitamins' | 'omega3' | 'collagen' | 'creatine' | 'ice_bath' | 'sauna'
  display_label text,                  -- pretty label e.g. 'Protein shake'
  notes         text
);

create index if not exists supps_entries_consumed_at_idx
  on public.supps_entries (consumed_at desc);

-- RLS off — matches existing convention.
