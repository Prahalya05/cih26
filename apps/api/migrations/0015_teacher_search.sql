-- Location-aware teacher search: opt-in listing, coarse district_code & pincode only (no GPS coordinates ever stored).
alter table teacher_profile
  add column if not exists listed boolean not null default false,
  add column if not exists pincode text,
  add column if not exists district_code text;

create index if not exists teacher_profile_listed_idx on teacher_profile (listed, district_code);
