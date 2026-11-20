-- Schemes the phones fetch at runtime (GET /v1/schemes). packages/kb/schemes.json + rules/*.json are the seed;
-- a row here adds a new scheme or replaces the seed copy with the same id. active = false hides a scheme.
create table if not exists scheme_catalog (
  id          text primary key,
  scheme      jsonb not null,
  rule        jsonb not null,
  active      boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  text not null default 'admin'
);
grant select, insert, update, delete on scheme_catalog to disha_api;
grant select on scheme_catalog to disha_readonly;
