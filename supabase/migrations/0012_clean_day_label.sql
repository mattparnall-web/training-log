-- Coach Claude — user-editable "clean day" label for the Drinks calendar.
--
-- Previously hardcoded ("WEAK TO STRONG" → "GOOD CALL"). Matt wants to
-- decide what shows on his alcohol-free days without a code change.
-- Stored as a plain string; the Drinks tab splits on spaces to stack
-- each word on its own line inside the tiny calendar cell.

alter table public.settings add column if not exists clean_day_label text;
