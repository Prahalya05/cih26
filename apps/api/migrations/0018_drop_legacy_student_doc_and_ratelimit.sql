-- Drop legacy_student_doc (v2 student + encrypted student_private replace it) and add Postgres rate_limit table.
drop table if exists legacy_student_doc;

create table if not exists rate_limit (
  key text not null,
  hit_at timestamptz not null default now()
);
create index if not exists rate_limit_key_hit_idx on rate_limit (key, hit_at);
grant select, insert, delete on rate_limit to disha_api;
