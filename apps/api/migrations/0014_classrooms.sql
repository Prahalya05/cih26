-- Two ways into a class.
--
--   1. A school's code (join_code, 0008): the school hands out a class code and a secret teacher code. Unchanged.
--   2. Online: anyone can sign up as a teacher without a code, make classrooms and say who each one is for
--      (age range, state, district, language, seats). A student without a code searches those classrooms and asks
--      to join; the teacher approves or declines. Only an approved student is put in the class.
--
-- An online teacher gets her own "school" row (kind 'online') the first time she makes a classroom, so every
-- existing rule keeps working unchanged: row-level security still shows a teacher only her own school's students,
-- and each classroom's code is the class code her students are filed under.

alter table school add column kind text not null default 'school' check (kind in ('school', 'online'));

create table classroom (
  code             text primary key,                          -- also the class code on her students' records
  school_id        text not null references school,
  teacher_account  text not null references account on delete cascade,
  name             text not null,
  about            text,
  language         text,                                      -- ta / en / hi, or null for any
  state            text,                                      -- null: any state
  district         text,                                      -- null: any district
  min_age          int check (min_age between 5 and 99),
  max_age          int check (max_age between 5 and 99),
  seats            int not null default 40 check (seats between 1 and 500),
  open             boolean not null default true,
  created_at       timestamptz not null default now(),
  check (min_age is null or max_age is null or min_age <= max_age)
);
create index on classroom (open, state, district);
create index on classroom (teacher_account);

create table join_request (
  id               text primary key,
  classroom_code   text not null references classroom on delete cascade,
  student_account  text not null references account on delete cascade,
  age              int not null,                              -- what the teacher sees: her name (from account), age, place, note
  state            text,
  district         text,
  note             text,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled', 'left')),
  created_at       timestamptz not null default now(),
  decided_at       timestamptz
);
create unique index on join_request (classroom_code, student_account) where status = 'pending';
create index on join_request (student_account, created_at desc);
create index on join_request (classroom_code, status);

grant select, insert, update, delete on classroom, join_request to disha_api;
-- Neither table is granted to the analysis role (disha_readonly).

-- Online teachers are checked by a person before students can see their classrooms. The teacher uploads one
-- teaching proof (school ID card, TET or B.Ed certificate, appointment letter); a Disha reviewer approves or rejects
-- it. The photo is kept only until that decision and then deleted; only the outcome stays.
-- A teacher who joined with a school's teacher code is already vouched for by that school.
create table teacher_verification (
  account_id    text primary key references account on delete cascade,
  doc_kind      text not null check (doc_kind in ('school_id', 'tet', 'bed', 'appointment', 'other')),
  photo         bytea,                                      -- null once decided
  photo_type    text,
  note          text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reason        text,                                       -- why it was rejected, shown to the teacher
  submitted_at  timestamptz not null default now(),
  decided_at    timestamptz
);
create index on teacher_verification (status, submitted_at);
grant select, insert, update, delete on teacher_verification to disha_api;
