-- ============================================================
-- Migracion Fase 3: galeria multi-imagen + filtro por estilo
-- Ejecutar en: Supabase Dashboard > SQL Editor > New query
-- Idempotente: seguro correr varias veces.
-- ============================================================
--
-- CAMBIOS:
--   1. products.images text[]   — galeria ordenada de URLs publicas
--                                  (images[0] = principal, images[1..] = secundarias)
--   2. products.image_paths text[] — rutas dentro del bucket 'carteras',
--                                    paralela a images (para cleanup en Storage)
--   3. products.style text     — estilo de cartera para filtro
--                                 (crossbody, tote, satchel, clutch, bucket,
--                                  hobo, shoulder, mini)
--
-- COMPATIBILIDAD:
--   - image_url, image_path, stock_image_url se mantienen.
--   - Durante la transicion, la app lee: images[0] || stock_image_url || image_url
--   - El seed y el admin nuevos escriben a images[]; legacy sigue funcionando.
-- ============================================================

-- ---------- Extensiones (ya deberian estar) ----------
create extension if not exists "pgcrypto";

-- ---------- products.images ----------
alter table public.products
  add column if not exists images text[] not null default '{}'::text[];

comment on column public.products.images is
  'Galeria de URLs publicas de la pieza. images[0] = foto principal mostrada en el catalogo. images[1..] = fotos secundarias en el modal de detalle. Se llena desde el admin (multi-upload) o el seed.';

-- ---------- products.image_paths ----------
-- Paralela a images[] pero con las rutas dentro del bucket 'carteras'.
-- Sirve para que el admin pueda borrar del Storage cuando elimina una foto.
alter table public.products
  add column if not exists image_paths text[] not null default '{}'::text[];

comment on column public.products.image_paths is
  'Rutas dentro del bucket "carteras", misma cardinalidad y orden que images[]. Para que el admin pueda borrar objetos del Storage al eliminar una foto de la galeria.';

-- ---------- products.style ----------
alter table public.products
  add column if not exists style text;

-- CHECK constraint con los 8 estilos fijos. Se agrega solo si no existe
-- (los CHECK constraints no tienen IF NOT EXISTS nativo en Postgres).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_style_check'
  ) then
    alter table public.products
      add constraint products_style_check
      check (
        style is null
        or style in (
          'crossbody', 'tote', 'satchel', 'clutch',
          'bucket',    'hobo', 'shoulder', 'mini'
        )
      );
  end if;
end$$;

comment on column public.products.style is
  'Estilo de la pieza para filtro publico. Null = sin clasificar (legacy). Valores: crossbody, tote, satchel, clutch, bucket, hobo, shoulder, mini.';

create index if not exists products_style_idx on public.products (style)
  where style is not null;

-- ---------- Backfill: images[] <- [stock_image_url, image_url] ----------
-- Para productos existentes que todavia no tengan images pobladas, derivamos
-- la galeria a partir de las columnas legacy. Orden: stock primero (si existe
-- y es distinta de la casera), luego casera.
update public.products
set images = array_remove(array[stock_image_url, image_url], null)::text[]
where (images is null or array_length(images, 1) is null)
  and (stock_image_url is not null or image_url is not null);

-- Backfill image_paths[]: solo tenemos image_path (ruta de la foto casera).
-- stock_image_url suele ser una URL externa (Unsplash / CDN) y no vive en
-- el bucket, por eso image_paths solo contiene image_path cuando existe.
update public.products
set image_paths = array_remove(array[image_path], null)::text[]
where (image_paths is null or array_length(image_paths, 1) is null)
  and image_path is not null;

-- ============================================================
-- Verificar:
--   select id, name, style,
--          array_length(images, 1)       as n_imgs,
--          array_length(image_paths, 1)  as n_paths
--   from public.products
--   limit 10;
--
--   select style, count(*) from public.products group by style;
-- ============================================================
