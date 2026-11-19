-- The AI work-sample scorer is a rater like any other: its weight follows its agreement with teachers
-- (services/raters.py ai_agreement). Starts at 1, the weight AI scores always had.
alter table rater drop constraint if exists rater_role_check;
alter table rater add constraint rater_role_check
  check (role in ('teacher', 'mentor', 'buyer', 'family', 'facilitator', 'ai'));
insert into rater(id, role, school_id, leniency, agreement) values ('ai_vision', 'ai', null, 0, 1)
  on conflict (id) do nothing;
