-- Row-level security. The API works as role disha_api and, for each request, sets app.school_ids:
--   '*'              trusted server work (a student's own phone syncing, background jobs)
--   'sch_a,sch_b'    a facilitator or teacher: only students in those schools
-- An unset value sees nothing.

do $$ begin
  if not exists (select from pg_roles where rolname = 'disha_api') then create role disha_api nologin; end if;
  if not exists (select from pg_roles where rolname = 'disha_readonly') then create role disha_readonly nologin; end if;
end $$;

grant disha_api to current_user;
grant usage on schema public to disha_api, disha_readonly;
grant select, insert, update, delete on all tables in schema public to disha_api;
grant usage, select on all sequences in schema public to disha_api;
grant select on all tables in schema public to disha_readonly;
revoke all on student_private from disha_readonly;

create function app_can_see_school(sid text) returns boolean language sql stable as $$
  select coalesce(current_setting('app.school_ids', true), '') = '*'
      or sid = any(string_to_array(coalesce(current_setting('app.school_ids', true), ''), ','))
$$;

-- security definer so the lookup in student is not itself filtered twice
create function app_can_see_student(stid text) returns boolean language sql stable security definer
set search_path = public as $$
  select coalesce(current_setting('app.school_ids', true), '') = '*'
      or exists (select 1 from student s where s.id = stid and app_can_see_school(s.school_id))
$$;

alter table student enable row level security;
alter table student_private enable row level security;
alter table consent enable row level security;
alter table evidence_event enable row level security;
alter table skill_state enable row level security;
alter table aptitude_state enable row level security;
alter table interest_state enable row level security;
alter table outcome enable row level security;

create policy by_school on student for all to disha_api
  using (app_can_see_school(school_id)) with check (app_can_see_school(school_id));
create policy by_student on student_private for all to disha_api
  using (app_can_see_student(student_id)) with check (app_can_see_student(student_id));
create policy by_student on consent for all to disha_api
  using (app_can_see_student(student_id)) with check (app_can_see_student(student_id));
create policy by_student on evidence_event for all to disha_api
  using (app_can_see_student(student_id)) with check (app_can_see_student(student_id));
create policy by_student on skill_state for all to disha_api
  using (app_can_see_student(student_id)) with check (app_can_see_student(student_id));
create policy by_student on aptitude_state for all to disha_api
  using (app_can_see_student(student_id)) with check (app_can_see_student(student_id));
create policy by_student on interest_state for all to disha_api
  using (app_can_see_student(student_id)) with check (app_can_see_student(student_id));
create policy by_student on outcome for all to disha_api
  using (app_can_see_student(student_id)) with check (app_can_see_student(student_id));

-- The analysis role reads everything except names and phones.
create policy readonly_all on student for select to disha_readonly using (true);
create policy readonly_all on evidence_event for select to disha_readonly using (true);
create policy readonly_all on skill_state for select to disha_readonly using (true);
create policy readonly_all on aptitude_state for select to disha_readonly using (true);
create policy readonly_all on interest_state for select to disha_readonly using (true);
create policy readonly_all on outcome for select to disha_readonly using (true);
