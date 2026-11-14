-- One-time links that let a buyer confirm a paid job without an account (Step 9.1).
create table confirm_token (
  token text primary key,                          -- random, shown only inside the link
  event_id text not null references evidence_event on delete cascade,
  student_id text not null references student on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index on confirm_token (event_id);

grant select, insert, update, delete on confirm_token to disha_api;
alter table confirm_token enable row level security;
create policy by_student on confirm_token for all to disha_api
  using (app_can_see_student(student_id)) with check (app_can_see_student(student_id));
