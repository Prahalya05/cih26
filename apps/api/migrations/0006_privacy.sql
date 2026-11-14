-- Phase 11: names and phone numbers live only in student_private; anonymous count of deletions.

-- The guardian's name moves out of consent, so the only table holding names is student_private.
alter table student_private add column guardian_name text;
insert into student_private(student_id, guardian_name)
  select student_id, guardian_name from consent where guardian_name is not null
  on conflict (student_id) do update set guardian_name = excluded.guardian_name;
alter table consent drop column guardian_name;

-- "Delete my data" keeps nothing about the student: only how many were deleted each day.
create table deletion_count (
  day date primary key,
  n int not null default 0
);
grant select, insert, update on deletion_count to disha_api;
grant select on deletion_count to disha_readonly;
