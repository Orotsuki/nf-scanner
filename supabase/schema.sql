-- NF Scanner: banco compartilhado entre celular e PC
-- Execute este script no SQL Editor do seu projeto Supabase.

create extension if not exists pgcrypto;

create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^[0-9]{11,14}$'),
  nome text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, cnpj)
);

create table if not exists public.notas_fiscais (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  numero_nf text not null,
  cnpj_emitente text not null check (cnpj_emitente ~ '^[0-9]{11,14}$'),
  fornecedor text not null default '',
  valor numeric(14,2),
  chave_acesso text not null,
  data_cadastro timestamptz not null default now(),
  data_envio date,
  unique (user_id, chave_acesso)
);

alter table public.fornecedores enable row level security;
alter table public.notas_fiscais enable row level security;

revoke all on table public.fornecedores from anon;
revoke all on table public.notas_fiscais from anon;

grant select, insert, update, delete on table public.fornecedores to authenticated;
grant select, insert, update, delete on table public.notas_fiscais to authenticated;

drop policy if exists "fornecedores_select_own" on public.fornecedores;
create policy "fornecedores_select_own"
on public.fornecedores for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "fornecedores_insert_own" on public.fornecedores;
create policy "fornecedores_insert_own"
on public.fornecedores for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "fornecedores_update_own" on public.fornecedores;
create policy "fornecedores_update_own"
on public.fornecedores for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "fornecedores_delete_own" on public.fornecedores;
create policy "fornecedores_delete_own"
on public.fornecedores for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "notas_select_own" on public.notas_fiscais;
create policy "notas_select_own"
on public.notas_fiscais for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "notas_insert_own" on public.notas_fiscais;
create policy "notas_insert_own"
on public.notas_fiscais for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "notas_update_own" on public.notas_fiscais;
create policy "notas_update_own"
on public.notas_fiscais for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "notas_delete_own" on public.notas_fiscais;
create policy "notas_delete_own"
on public.notas_fiscais for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Ativa os eventos necessários para a sincronização em tempo real.
do $$
begin
  alter publication supabase_realtime add table public.notas_fiscais;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.fornecedores;
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_notas_fiscais_user_data
  on public.notas_fiscais (user_id, data_cadastro desc);

create index if not exists idx_notas_fiscais_envio
  on public.notas_fiscais (data_envio);

create index if not exists idx_fornecedores_user_cnpj
  on public.fornecedores (user_id, cnpj);


create table if not exists public.app_config (
  key text primary key,
  value text not null
);

alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;


alter table public.notas_fiscais replica identity full;
alter table public.fornecedores replica identity full;
