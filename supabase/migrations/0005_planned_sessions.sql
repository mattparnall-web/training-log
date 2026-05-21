-- Coach Claude — Planned session table.
-- Stores Claude's recommended session for a given date. One row per date so
-- regenerating overwrites the previous suggestion. The Dashboard reads the
-- saved plan if it exists (no re-spending the AI call); the user can tap
-- Regenerate to refresh.

create table if not exists public.planned_sessions (
  date        date primary key,
  day_id      text,
  day_name    text,
  summary     text,
  plan_text   text not null,
  model       text,
  created_at  timestamptz not null default now()
);

-- RLS off — matches the existing `sessions` table convention.
