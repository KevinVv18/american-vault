-- ============================================================
-- Migracion: agrega soporte para imagen stock (editorial)
-- Fase A del rediseno mobile-first
-- Ejecutar en: Supabase Dashboard > SQL Editor > New query
-- Idempotente: seguro correr varias veces.
-- ============================================================

-- ---------- products.stock_image_url ----------
-- Imagen editorial (fondo limpio, sin contexto) que se muestra como
-- principal en la tarjeta. La foto casera ya existente (image_url +
-- image_path) queda como secundaria para dar confianza al cliente.
alter table public.products
  add column if not exists stock_image_url text;

comment on column public.products.stock_image_url is
  'Imagen editorial/stock. Se muestra primero en la tarjeta. Si null, se usa image_url como fallback.';

-- ============================================================
-- Verificar:
--   select id, name, image_url, stock_image_url
--   from public.products limit 5;
-- ============================================================
