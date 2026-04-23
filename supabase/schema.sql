-- ============================================================
-- American Vault — Supabase schema
-- Ejecutar en: Supabase Dashboard > SQL Editor > New query
-- Idempotente: puedes correrlo varias veces sin romper nada.
-- ============================================================

-- ---------- Extensiones ----------
create extension if not exists "pgcrypto";

-- ---------- Tabla: products ----------
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  brand         text not null default 'Sin marca',
  color         text default 'Variado',
  price         numeric(10,2) not null check (price >= 0),
  stock         integer not null default 0 check (stock >= 0),
  available     boolean not null default true,
  status        text not null default 'available'
                  check (status in ('available','reserved','sold_out')),
  -- Galeria multi-imagen (Fase 3). images[0] = principal mostrada en catalogo;
  -- images[1..] = secundarias en el modal de detalle. image_paths[] es la
  -- misma cardinalidad pero con rutas dentro del bucket (para cleanup).
  images        text[] not null default '{}'::text[],
  image_paths   text[] not null default '{}'::text[],
  -- Legacy (Fase 1-A): se mantienen para compat. La app lee
  -- images[0] || stock_image_url || image_url (en ese orden).
  image_url         text,             -- foto "casera" (bucket 'carteras')
  image_path        text,             -- ruta dentro del bucket 'carteras'
  stock_image_url   text,             -- foto editorial/stock (principal). Fallback: image_url
  -- Estilo para filtro publico (Fase 3). Null = sin clasificar.
  style         text check (
    style is null
    or style in (
      'crossbody', 'tote', 'satchel', 'clutch',
      'bucket',    'hobo', 'shoulder', 'mini'
    )
  ),
  source_file   text unique,          -- nombre original (evita duplicados en seed)
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists products_brand_idx     on public.products (brand);
create index if not exists products_available_idx on public.products (available);
create index if not exists products_created_idx   on public.products (created_at desc);
create index if not exists products_status_idx    on public.products (status);
create index if not exists products_style_idx     on public.products (style) where style is not null;

-- ---------- Tabla: wishlist ----------
create table if not exists public.wishlist (
  id             uuid primary key default gen_random_uuid(),
  whatsapp       text not null,           -- formato libre, normalizar en app
  brand          text,                    -- null = cualquier marca
  max_price      numeric(10,2),           -- null = sin tope
  product_ref    uuid references public.products(id) on delete set null,
  notes          text,
  notified       boolean not null default false,
  notified_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists wishlist_notified_idx on public.wishlist (notified);
create index if not exists wishlist_brand_idx    on public.wishlist (brand);

-- ---------- Trigger updated_at en products ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------- Row Level Security ----------
alter table public.products enable row level security;
alter table public.wishlist enable row level security;

-- products: lectura pública, escritura solo autenticados (el admin)
drop policy if exists products_public_read            on public.products;
drop policy if exists products_authenticated_insert   on public.products;
drop policy if exists products_authenticated_update   on public.products;
drop policy if exists products_authenticated_delete   on public.products;

create policy products_public_read
  on public.products for select
  using (true);

create policy products_authenticated_insert
  on public.products for insert
  to authenticated with check (true);

create policy products_authenticated_update
  on public.products for update
  to authenticated using (true) with check (true);

create policy products_authenticated_delete
  on public.products for delete
  to authenticated using (true);

-- wishlist: inserción pública (cliente se anota), resto solo autenticados
drop policy if exists wishlist_public_insert          on public.wishlist;
drop policy if exists wishlist_authenticated_read     on public.wishlist;
drop policy if exists wishlist_authenticated_update   on public.wishlist;
drop policy if exists wishlist_authenticated_delete   on public.wishlist;

create policy wishlist_public_insert
  on public.wishlist for insert
  with check (true);

create policy wishlist_authenticated_read
  on public.wishlist for select
  to authenticated using (true);

create policy wishlist_authenticated_update
  on public.wishlist for update
  to authenticated using (true) with check (true);

create policy wishlist_authenticated_delete
  on public.wishlist for delete
  to authenticated using (true);

-- ---------- Realtime: suscripción a products ----------
-- Permite que los clientes reciban cambios de stock/precio en vivo.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'products'
  ) then
    alter publication supabase_realtime add table public.products;
  end if;
end$$;

-- ---------- Storage bucket: carteras ----------
-- Imágenes servidas públicamente, pero solo admin sube/borra.
insert into storage.buckets (id, name, public)
values ('carteras', 'carteras', true)
on conflict (id) do nothing;

drop policy if exists carteras_public_read          on storage.objects;
drop policy if exists carteras_authenticated_insert on storage.objects;
drop policy if exists carteras_authenticated_update on storage.objects;
drop policy if exists carteras_authenticated_delete on storage.objects;

create policy carteras_public_read
  on storage.objects for select
  using (bucket_id = 'carteras');

create policy carteras_authenticated_insert
  on storage.objects for insert to authenticated
  with check (bucket_id = 'carteras');

create policy carteras_authenticated_update
  on storage.objects for update to authenticated
  using (bucket_id = 'carteras') with check (bucket_id = 'carteras');

create policy carteras_authenticated_delete
  on storage.objects for delete to authenticated
  using (bucket_id = 'carteras');

-- ============================================================
-- Fin. Para verificar:
--   select count(*) from public.products;   -- debe ser 0
--   select count(*) from public.wishlist;   -- debe ser 0
--   select id from storage.buckets;         -- debe incluir 'carteras'
-- ============================================================
