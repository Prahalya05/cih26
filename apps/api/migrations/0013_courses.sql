-- Teacher profiles and teacher-run courses with plans and payments (routers/courses.py).
--
--   teacher_profile  what a teacher shows students: bio, subjects, languages, experience. One per teacher account.
--   course           a course by a teacher; plan: free | per_module | subscription; price in rupees (per module, or
--                    per period for a subscription). Visible to the teacher's school, or to everyone if open.
--   course_module    one lesson: text and/or video link, a short quiz, and the sub-skill it trains.
--   purchase         one payment attempt: Razorpay test order, or a labelled demo payment when no keys are set.
--                    A module or course is unlocked only by a purchase with status 'paid' (rule.course_access).
--                    Razorpay payments are marked paid only after the server checks the HMAC-SHA256 signature.
--   module_progress  quiz results; a pass also becomes a skill evidence event on the student's phone.

create table teacher_profile (
  account_id   text primary key references account on delete cascade,
  bio          text,
  subjects     text[] not null default '{}',
  languages    text[] not null default '{}',
  years        int,
  qualification text,
  district     text,
  avatar       text,
  updated_at   timestamptz not null default now()
);

create table course (
  id            text primary key,
  teacher_id    text not null references account on delete cascade,
  school_id     text references school,             -- null = open to students of every school
  title         text not null,
  description   text,
  language      text not null default 'ta',
  skill_id      text not null,                       -- skill or sub-skill it trains
  plan          text not null check (plan in ('free', 'per_module', 'subscription')),
  price_inr     int not null default 0 check (price_inr >= 0 and price_inr <= 100000),
  period_days   int not null default 30,
  published     boolean not null default false,
  created_at    timestamptz not null default now()
);
create index on course (teacher_id);

create table course_module (
  id          text primary key,
  course_id   text not null references course on delete cascade,
  position    int not null,
  title       text not null,
  body        text,
  video_url   text,
  subskill_id text,
  quiz        jsonb not null default '[]'          -- [{q, options: [..], answer: index}]
);
create index on course_module (course_id, position);

create table purchase (
  id           text primary key,
  account_id   text not null references account on delete cascade,
  course_id    text not null references course on delete cascade,
  module_id    text references course_module on delete cascade,  -- per_module only
  kind         text not null check (kind in ('module', 'subscription')),
  amount_inr   int not null,
  provider     text not null check (provider in ('razorpay', 'demo')),
  order_id     text,
  payment_id   text,
  status       text not null default 'created' check (status in ('created', 'paid', 'failed')),
  valid_until  timestamptz,
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);
create index on purchase (account_id, course_id);
create unique index on purchase (order_id) where order_id is not null;

create table module_progress (
  account_id  text not null references account on delete cascade,
  module_id   text not null references course_module on delete cascade,
  score       real not null,
  passed      boolean not null,
  at          timestamptz not null default now(),
  primary key (account_id, module_id)
);

grant select, insert, update, delete on teacher_profile, course, course_module, purchase, module_progress to disha_api;
grant select on course, course_module to disha_readonly;
