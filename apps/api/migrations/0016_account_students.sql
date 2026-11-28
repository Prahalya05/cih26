-- A student account can hold a few student profiles (for example a shared family phone, or starting again),
-- not just one. account.student_id stays as her first profile so older phones keep working.
-- The limit (STUDENT_PROFILES_MAX, default 3) is checked in app/auth.py.

create table account_student (
  account_id text not null references account on delete cascade,
  student_id text not null unique,             -- a profile belongs to one account only
  linked_at  timestamptz not null default now(),
  primary key (account_id, student_id)
);

insert into account_student (account_id, student_id)
select id, student_id from account where student_id is not null
on conflict do nothing;

grant select, insert, delete on account_student to disha_api;
