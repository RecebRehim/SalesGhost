-- Run this in Supabase SQL Editor once. Then add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to Vercel env.

create table if not exists public.salesghost_sync (
  account_id text primary key default 'mock-user-001',
  analytics_events jsonb not null default '[]'::jsonb,
  mock_database jsonb not null default '{}'::jsonb,
  cart jsonb not null default '[]'::jsonb,
  wishlist jsonb not null default '[]'::jsonb,
  cart_updated_at timestamptz,
  wishlist_updated_at timestamptz,
  consent text not null default 'unset',
  n8n_webhook_url text not null default '',
  updated_at timestamptz not null default now()
);

-- Existing projects: run once in SQL Editor if the table already existed without these columns:
-- alter table public.salesghost_sync add column if not exists cart_updated_at timestamptz;
-- alter table public.salesghost_sync add column if not exists wishlist_updated_at timestamptz;

alter table public.salesghost_sync enable row level security;

-- Realtime (optional): Dashboard → Database → Replication, or:
-- alter publication supabase_realtime add table public.salesghost_sync;

-- Demo-only: allow anonymous read/write for the single shared account (hackathon).
drop policy if exists "salesghost_anon_all" on public.salesghost_sync;
create policy "salesghost_anon_all"
  on public.salesghost_sync
  for all
  to anon, authenticated
  using (true)
  with check (true);
