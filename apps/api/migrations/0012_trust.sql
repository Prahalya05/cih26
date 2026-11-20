-- Job posts, applications and documents (routers/trust.py).
--
--   posting       an internship/job/apprenticeship posted by a teacher (only her school sees it) or an employer
--                 (every school sees it). Same shape as packages/kb/opportunities.json, so the readiness rule works.
--   application   a student's application. Holds only what she chose to send: a resume made from her record and the
--                 status of each document (never the document itself). The employer sees it; her school sees it.
--   student_doc   the status of each document kind for a student: uploaded (an AI looked), verified or rejected by a
--                 teacher. The photo itself is never stored on the server. For an income certificate the teacher
--                 writes down the yearly income she saw, used by the donor pay check.

create table posting (
  id           text primary key,
  account_id   text not null references account on delete cascade,
  role         text not null check (role in ('teacher', 'employer')),
  school_id    text references school,              -- teacher posts: that school only; employer posts: null (all)
  opportunity  jsonb not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index on posting (school_id) where active;
create index on posting (account_id);

create table application (
  id              text primary key,
  student_id      text not null references student on delete cascade,
  school_id       text references school,
  opportunity_id  text not null,
  posting_id      text references posting on delete set null,
  employer_id     text references account on delete set null,
  resume          jsonb not null,
  docs            jsonb not null default '{}',
  message         text,
  status          text not null default 'sent' check (status in ('sent', 'seen', 'shortlisted', 'not_selected', 'hired')),
  employer_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (student_id, opportunity_id)
);
create index on application (employer_id);

create table student_doc (
  student_id   text not null references student on delete cascade,
  kind         text not null,
  status       text not null check (status in ('uploaded', 'verified', 'rejected')),
  ai_note      jsonb,
  income_inr   int,
  checked_by   text,
  checked_at   timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (student_id, kind)
);

alter table application enable row level security;
alter table student_doc enable row level security;
create policy by_student on application for all to disha_api
  using (app_can_see_student(student_id)) with check (app_can_see_student(student_id));
create policy by_student on student_doc for all to disha_api
  using (app_can_see_student(student_id)) with check (app_can_see_student(student_id));

grant select, insert, update, delete on posting, application, student_doc to disha_api;
grant select on posting to disha_readonly;
