create extension if not exists "pgcrypto";

create table if not exists public.donation_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  file_names text[] not null default '{}'::text[],
  total_records integer not null default 0
);

create table if not exists public.donations (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.donation_batches(id) on delete cascade,
  name text not null,
  date text not null,
  amount text not null,
  payment_type text not null,
  email text not null,
  source_file_name text
);

create index if not exists donation_batches_created_at_idx
  on public.donation_batches (created_at desc);

create index if not exists donations_batch_id_idx
  on public.donations (batch_id);

create index if not exists donations_name_idx
  on public.donations (name);
