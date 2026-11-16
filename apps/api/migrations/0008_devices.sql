-- Who may call the API. A phone registers once with a join code and gets a device token; every request that
-- reads or writes student data then sends that token and only sees its own school (row-level security, 0003).
--   join_code   made by an admin with scripts/add_join_code.py. A 'student' code is the class code students type;
--               a 'teacher' code is secret and makes the phone a teacher's phone (allowed to rate and see the cohort).
--   device      one row per registered phone. Only a hash of its token is kept.
-- Neither table has row-level security: the API reads them only for its own checks and never returns them.

create table join_code (
  code text primary key,
  school_id text not null references school,
  role text not null check (role in ('student', 'teacher')),
  class_code text not null,               -- the facilitator code on the class's student records
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index on join_code (school_id);

create table device (
  id text primary key,                    -- the device_id the phone made for itself
  school_id text not null references school,
  role text not null check (role in ('student', 'teacher')),
  token_hash text not null unique,        -- sha256 of the token; the token itself is never stored
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

grant select on join_code to disha_api;
grant select, insert, update on device to disha_api;

-- /v1 legacy documents get a school too, so the old sync and cohort endpoints can be limited by school.
-- Rows stored before this migration have none; the first school to sync them takes them.
alter table legacy_student_doc add column school_id text references school;
create index on legacy_student_doc (school_id, facilitator_code);
