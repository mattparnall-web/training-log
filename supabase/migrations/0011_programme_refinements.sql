-- Coach Claude — Programme refinements.
--
-- Where standing programme_context (on settings) is the long-form strategy
-- Matt maintains himself, `programme_refinements` is the running list of
-- shorter-lived overrides / constraints / insights that come out of ad-hoc
-- Claude chat sessions. Claude chat POSTs to /api/refinements when it agrees
-- on something worth persisting (e.g. "neck flared this week — no overhead,
-- bench or pull-ups; substitute Z2 + arms + legs"), and the tracker's own
-- planner reads them into every "Plan today's session" call.
--
-- Fields:
--   note       — free-text refinement. May include markdown / prose.
--   source     — where it came from (e.g. claude_chat, manual, coach_review)
--   active     — soft-delete flag. false = ignored by the coach prompt.
--   expires_at — optional. If set and in the past, the coach ignores it even
--                when active. Lets Claude chat pass "expires end of week" for
--                temporary things without needing manual cleanup.
--   created_at — for ordering + display.

create table if not exists public.programme_refinements (
  id          bigserial primary key,
  note        text not null,
  source      text default 'claude_chat',
  active      boolean not null default true,
  expires_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- Coach prompt fetches active + non-expired, most recent first.
create index if not exists programme_refinements_active_created_idx
  on public.programme_refinements (active, created_at desc);
