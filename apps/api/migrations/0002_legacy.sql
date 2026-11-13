-- Keeps /v1/sync working (whole student documents + teacher actions) until the app moves to /v2 events.
-- Drop these tables once no phone is on the old version.

create table legacy_student_doc (
  id text primary key,
  facilitator_code text,
  doc jsonb not null,
  updated_at bigint not null
);
create index on legacy_student_doc (facilitator_code);

create table legacy_action (
  id text primary key,
  student_id text not null,
  kind text not null,
  payload jsonb not null,
  by text,
  created_at bigint not null
);
create index on legacy_action (student_id);
