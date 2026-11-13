-- Disha schema v1. Evidence events are the record; *_state tables are caches rebuilt from them.

create extension if not exists vector;

create table school (
  id text primary key,
  name text not null,
  district text not null
);

create table student (
  id text primary key,
  school_id text references school,
  facilitator_code text,
  district text,
  class smallint,
  gender text,
  medium text,
  birth_year smallint,
  created_at timestamptz not null default now()
);
create index on student (school_id);
create index on student (facilitator_code);

-- Name and phone are kept apart so analysis roles never see them.
create table student_private (
  student_id text primary key references student on delete cascade,
  name text,
  phone text
);

create table consent (
  id text primary key,
  student_id text not null references student on delete cascade,
  guardian_name text,
  scopes text[] not null,                 -- assess, photos, share_portfolio
  method text not null,                   -- paper_form, otp, self_18plus
  granted_at timestamptz not null,
  revoked_at timestamptz
);
create index on consent (student_id);

create table rater (
  id text primary key,
  role text not null check (role in ('teacher', 'mentor', 'buyer', 'family', 'facilitator')),
  school_id text references school,
  leniency real not null default 0,
  agreement real not null default 1
);

create table evidence_event (
  id text primary key,                    -- ULID made on the phone
  seq bigserial unique,                   -- sync cursor, strictly increasing on the server
  student_id text not null references student on delete cascade,
  device_id text not null,
  kind text not null check (kind in ('self_report', 'family_report', 'item_response', 'task',
    'aptitude_response', 'interest_choice', 'work_sample', 'rating', 'order', 'taster')),
  skill_id text,
  subskill_id text,
  item_id text,
  payload jsonb not null default '{}',
  rater_id text references rater,
  refers_to text references evidence_event on delete cascade,
  created_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index on evidence_event (student_id, created_at);

create table skill_state (
  student_id text references student on delete cascade,
  subskill_id text,
  p_level real[] not null,
  theta real,
  se real,
  updated_at timestamptz not null,
  primary key (student_id, subskill_id)
);

create table aptitude_state (
  student_id text references student on delete cascade,
  domain text,
  theta real not null,
  se real not null,
  primary key (student_id, domain)
);

create table interest_state (
  student_id text primary key references student on delete cascade,
  riasec real[] not null,
  updated_at timestamptz not null
);

create table kg_node (
  id text primary key,
  type text not null,
  props jsonb not null,
  version text not null,
  active boolean not null default true
);

create table kg_edge (
  src text references kg_node on delete cascade,
  dst text references kg_node on delete cascade,
  type text,
  weight real not null,
  level smallint,
  source text,
  version text not null,
  primary key (src, dst, type)
);

create table item (
  id text primary key,
  subskill_id text not null,
  format text not null,
  difficulty real not null,
  discrimination real not null default 1,
  body jsonb not null,
  langs text[] not null,
  active boolean not null default true,
  version text not null
);

create table item_stat (
  item_id text primary key references item on delete cascade,
  n int not null default 0,
  p_correct real,
  dif_gender real,
  dif_medium real,
  last_fit timestamptz
);

create table rubric (
  id text primary key,
  skill_id text not null,
  criteria jsonb not null,
  version text not null
);

create table career_embedding (
  node_id text primary key references kg_node on delete cascade,
  embedding vector(768) not null
);
create index on career_embedding using hnsw (embedding vector_cosine_ops);

create table opportunity (
  id text primary key,
  type text not null,
  district text,
  node_id text references kg_node,
  title text not null,
  opens_at date,
  closes_at date
);

create table outcome (
  student_id text references student on delete cascade,
  career_id text,
  status text not null,
  checked_at timestamptz not null,
  primary key (student_id, career_id, checked_at)
);
