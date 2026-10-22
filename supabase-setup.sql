-- Run this ONCE in Supabase: left menu > SQL Editor > New query > paste > Run.

create table if not exists users (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null unique,
  phone text,
  country text,
  pass_hash text not null,
  role text not null default 'user',
  created_at bigint not null
);

create table if not exists settings (
  key text primary key,
  value text not null
);

create table if not exists departments (
  id bigint generated always as identity primary key,
  name text not null,
  description text not null default '',
  icon text not null default 'heart',
  image text not null default '',
  min_amount integer not null default 20,
  presets text not null default '[20,50,100,500,1000,5000]',
  active integer not null default 1,
  sort integer not null default 0
);

create table if not exists plans (
  id bigint generated always as identity primary key,
  name text not null,
  months integer not null,
  price bigint not null,
  perks text not null default '',
  active integer not null default 1,
  sort integer not null default 0
);

create table if not exists payments (
  id bigint generated always as identity primary key,
  receipt_no text,
  kind text not null,
  user_id bigint not null references users(id),
  donor_name text not null,
  donor_email text not null,
  department_id bigint,
  plan_id bigint,
  label text not null,
  amount bigint not null,
  utr text not null,
  message text not null default '',
  anonymous integer not null default 0,
  status text not null default 'pending',
  created_at bigint not null,
  reviewed_at bigint,
  starts_at bigint,
  ends_at bigint
);

create index if not exists idx_payments_user on payments(user_id);
create index if not exists idx_payments_status on payments(status);
-- the same UPI reference number cannot be used twice (unless that payment was rejected)
create unique index if not exists payments_utr_live on payments(utr) where status <> 'rejected';

-- Lock the tables so nobody can read them with the public (anon) key.
-- The website uses the secret service key inside the Netlify function, which bypasses this.
alter table users enable row level security;
alter table settings enable row level security;
alter table departments enable row level security;
alter table plans enable row level security;
alter table payments enable row level security;
