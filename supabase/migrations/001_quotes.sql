-- WashQuote customer accounts + private cloud quotes
-- Run this in Supabase SQL Editor once.

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_name text not null default '',
  job_reference text not null default '',
  quote_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quotes_user_id_created_at_idx
  on public.quotes(user_id, created_at desc);

alter table public.quotes enable row level security;

drop policy if exists "Users can read their own quotes" on public.quotes;
create policy "Users can read their own quotes" on public.quotes for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own quotes" on public.quotes;
create policy "Users can insert their own quotes" on public.quotes for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own quotes" on public.quotes;
create policy "Users can update their own quotes" on public.quotes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own quotes" on public.quotes;
create policy "Users can delete their own quotes" on public.quotes for delete
  using (auth.uid() = user_id);

create or replace function public.set_quotes_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists quotes_set_updated_at on public.quotes;
create trigger quotes_set_updated_at
before update on public.quotes
for each row execute function public.set_quotes_updated_at();
