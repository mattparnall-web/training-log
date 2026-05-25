-- Coach Claude — Programme context (editable strategy notes) + session reviews
-- (post-session AI feedback that loops back into future planning).
--
-- Why this exists:
--   * Matt has long-form context about his programme (goals, history, blocks,
--     constraints) that he developed in earlier Claude chats. We want the
--     coach to read this on every plan/review call, so it stays consistent.
--   * After each logged session, Matt wants the coach to give him a written
--     review (what went well, what to adjust). Reviews get persisted so the
--     next session's planner can read them and adapt the programme accordingly.

-- 1. Programme context — free-text strategy/programme summary on the singleton
--    settings row. Read by the coach planner and reviewer. Editable in Settings.
alter table public.settings add column if not exists programme_context text;

-- 2. Session reviews — one row per logged session. session_id is the primary
--    key (matches sessions.id as text). We don't add an explicit foreign key
--    constraint because the sessions table predates these migrations and we
--    don't want to risk a schema-cache miss; the app enforces the link.
create table if not exists public.session_reviews (
  session_id   text primary key,
  date         date,
  day_id       text,
  day_name     text,
  summary      text,
  review_text  text not null,  -- Claude's full structured review (raw JSON or text)
  model        text,
  created_at   timestamptz not null default now()
);

-- RLS off — matches the existing personal-use convention for this app's tables.
-- (No alter to enable RLS; the publishable key reads/writes directly.)

-- Useful index for the planner that fetches the most recent N reviews.
create index if not exists session_reviews_date_idx
  on public.session_reviews (date desc);
