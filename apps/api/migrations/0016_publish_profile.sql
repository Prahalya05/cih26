-- Opt-in profile publishing, aggregate-only view counts, guardian OTP, and pgcrypto encryption for student_private.
create extension if not exists pgcrypto;

alter table student_private
  add column if not exists name_enc bytea,
  add column if not exists phone_enc bytea,
  add column if not exists guardian_name_enc bytea;

create table if not exists published_profile (
  student_id text primary key references student on delete cascade,
  school_id text not null references school on delete cascade,
  slug text unique not null,
  visibility text not null check (visibility in ('private', 'school', 'verified_partners', 'public')),
  snapshot jsonb not null,
  is_minor boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists published_profile_slug_idx on published_profile (slug);

grant select, insert, update, delete on published_profile to disha_api;
alter table published_profile enable row level security;
create policy by_school on published_profile for all to disha_api
  using (app_can_see_student(student_id)) with check (app_can_see_student(student_id));

-- Aggregate view counts only (never viewer IP, user-agent, or identity).
create table if not exists published_profile_views (
  slug text not null references published_profile(slug) on delete cascade,
  day date not null,
  views int not null default 0,
  primary key (slug, day)
);
grant select, insert, update, delete on published_profile_views to disha_api;
grant select on published_profile_views to disha_readonly;

-- Guardian OTP for minor consent (stores only HMAC(AUTH_SECRET, phone), never raw number).
create table if not exists guardian_otp (
  student_id text primary key references student on delete cascade,
  guardian_hmac text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  tries int not null default 0,
  verified_at timestamptz
);
grant select, insert, update, delete on guardian_otp to disha_api;
alter table guardian_otp enable row level security;
create policy by_student on guardian_otp for all to disha_api
  using (app_can_see_student(student_id)) with check (app_can_see_student(student_id));
