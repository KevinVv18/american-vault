-- ============================================================
-- American Vault — Migracion Fase D: newsletter_subscribers
-- Ejecutar en: Supabase Dashboard > SQL Editor > New query
-- Idempotente: puedes correrlo varias veces sin romper nada.
--
-- Que crea:
--   - tabla newsletter_subscribers (id, whatsapp UNIQUE, source, created_at)
--   - RLS: insert publico, select/delete solo authenticated (admin)
--
-- El frontend tiene un form en el footer "Avisame cuando llegue algo
-- nuevo". El submit inserta whatsapp normalizado. El UNIQUE constraint
-- asegura que el mismo numero no se duplique; el cliente trata el
-- error 23505 como exito ("ya estabas en la lista").
-- ============================================================

create table if not exists public.newsletter_subscribers (
  id          uuid primary key default gen_random_uuid(),
  whatsapp    text not null,
  source      text not null default 'footer',
  created_at  timestamptz not null default now()
);

create unique index if not exists newsletter_subscribers_whatsapp_uidx
  on public.newsletter_subscribers (whatsapp);

alter table public.newsletter_subscribers enable row level security;

drop policy if exists newsletter_public_insert  on public.newsletter_subscribers;
drop policy if exists newsletter_admin_read     on public.newsletter_subscribers;
drop policy if exists newsletter_admin_delete   on public.newsletter_subscribers;

create policy newsletter_public_insert
  on public.newsletter_subscribers for insert
  with check (true);

create policy newsletter_admin_read
  on public.newsletter_subscribers for select
  to authenticated using (true);

create policy newsletter_admin_delete
  on public.newsletter_subscribers for delete
  to authenticated using (true);

-- Verificar:
--   select count(*) from public.newsletter_subscribers;  -- debe ser 0
--   \d public.newsletter_subscribers                      -- ver columnas
