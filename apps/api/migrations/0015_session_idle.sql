-- A signed-in phone that has not reached the server for a long time (SESSION_IDLE_DAYS, default 30) must sign in
-- again with a new one-time code (app/auth.py). last_seen_at is refreshed at most once an hour per phone.
-- Phones registered with a class code only (no account) are not affected.
-- Existing phones start counting from today, so nobody is signed out by this migration itself.
alter table device add column last_seen_at timestamptz not null default now();
