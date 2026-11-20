-- Sign-in for everyone: students, teachers, donors (funders) and employers/customers.
--
-- A person signs in with a phone number or an email and a one-time code (OTP). We never keep the phone number or
-- email in readable form: only an HMAC of it (login_hash, keyed with a server secret) to find the account again, and
-- a masked copy ("98•••••210") to show on the account screen. Signing in gives the phone a device token (table device),
-- so every existing endpoint keeps working with the same school scoping.
--
--   account    one row per person. Students and teachers belong to a school (from their class or teacher code);
--              donors and employers belong to none and so can never read student rows (row-level security, 0003).
--   login_otp  short-lived codes. Only a hash of the code is kept; 5 wrong tries or 10 minutes and it is dead.

create table account (
  id            text primary key,
  role          text not null check (role in ('student', 'teacher', 'funder', 'employer')),
  login_hash    text not null unique,          -- HMAC-SHA256(server secret, normalised phone or email)
  login_kind    text not null check (login_kind in ('phone', 'email')),
  login_masked  text not null,                 -- shown back to the person, e.g. 98•••••210 or a•••@gmail.com
  name          text not null,
  org           text,                          -- donor's or employer's organisation
  school_id     text references school,
  class_code    text,
  student_id    text,                          -- a student's own profile, once it has synced
  privacy_ok_at timestamptz not null,          -- when they agreed to the privacy notice
  created_at    timestamptz not null default now(),
  last_login_at timestamptz,
  disabled_at   timestamptz
);
create index on account (school_id);

create table login_otp (
  id          bigserial primary key,
  login_hash  text not null,
  code_hash   text not null,
  attempts    int not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index on login_otp (login_hash, created_at desc);

-- Signed-in phones are devices too. Donors and employers have no school.
alter table device drop constraint if exists device_role_check;
alter table device add constraint device_role_check check (role in ('student', 'teacher', 'funder', 'employer'));
alter table device alter column school_id drop not null;
alter table device add column account_id text references account on delete cascade;

grant select, insert, update, delete on account, login_otp to disha_api;
grant usage, select on sequence login_otp_id_seq to disha_api;
-- The analysis role never sees accounts.
