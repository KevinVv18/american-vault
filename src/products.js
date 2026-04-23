import { supabase } from './supabase.js';
import { FALLBACK_IMAGE } from './config.js';

// ---------- Estilos validos (Fase 3) ----------
// Debe coincidir con el CHECK constraint en supabase/schema.sql. Si agregas
// uno aqui, agregalo tambien en el constraint y en la UI de filtros.
export const STYLES = Object.freeze([
  'crossbody', 'tote', 'satchel', 'clutch',
  'bucket',    'hobo', 'shoulder', 'mini'
]);

export const STYLE_LABELS = Object.freeze({
  crossbody: 'Crossbody',
  tote:      'Tote',
  satchel:   'Satchel',
  clutch:    'Clutch',
  bucket:    'Bucket',
  hobo:      'Hobo',
  shoulder:  'Shoulder',
  mini:      'Mini'
});

export function isValidStyle(s) {
  return typeof s === 'string' && STYLES.includes(s);
}

// ---------- Mapeo DB <-> UI ----------
// La tabla usa snake_case, la UI sigue usando camelCase para no romper codigo.
function fromRow(row) {
  // Galeria Fase 3: images[] es la fuente primaria (array ordenado de URLs).
  // Si la fila todavia no tiene images (producto legacy pre-migracion),
  // sintetizamos la galeria con los campos viejos: [stock, home].
  const rawGallery = Array.isArray(row.images) ? row.images.filter(Boolean) : [];
  const rawPaths   = Array.isArray(row.image_paths) ? row.image_paths.filter(Boolean) : [];

  const stock = row.stock_image_url || '';
  const home  = row.image_url || '';

  // Si el admin ya subio via multi-upload → usamos images[].
  // Sino → sintetizamos la galeria de los campos legacy (stock primero).
  const gallery = rawGallery.length > 0
    ? rawGallery
    : [stock, home].filter(Boolean);

  // primary: primera de la galeria efectiva, sino fallback.
  const primary = gallery[0] || FALLBACK_IMAGE;
  // secondary (legacy para compat con codigo v4): la casera cuando
  // primary viene de la stock/galeria y hay una casera distinta.
  const secondary = (primary !== home && home) ? home : null;

  return {
    id:            row.id,
    name:          row.name ?? '',
    brand:         row.brand ?? 'Sin marca',
    color:         row.color ?? 'Variado',
    price:         Number(row.price ?? 0),
    stock:         Number(row.stock ?? 0),
    available:     Boolean(row.available),
    status:        row.status ?? 'available',
    style:         isValidStyle(row.style) ? row.style : null,
    // Galeria completa (para el modal de detalle: carousel/swipe).
    images:        gallery,
    imagePaths:    rawPaths,
    imageUrl:      primary,                // principal (catalogo)
    secondaryUrl:  secondary,              // legacy (compat con v4)
    stockImageUrl: row.stock_image_url ?? null,
    homeImageUrl:  row.image_url ?? null,
    imagePath:     row.image_path ?? null,
    sourceFile:    row.source_file ?? null,
    createdAt:     row.created_at,
    lastUpdated:   row.updated_at
  };
}

function toRow(p) {
  const row = {};
  if (p.name           !== undefined) row.name            = p.name;
  if (p.brand          !== undefined) row.brand           = p.brand;
  if (p.color          !== undefined) row.color           = p.color;
  if (p.price          !== undefined) row.price           = p.price;
  if (p.stock          !== undefined) row.stock           = p.stock;
  if (p.available      !== undefined) row.available       = p.available;
  if (p.status         !== undefined) row.status          = p.status;
  if (p.style          !== undefined) row.style           = isValidStyle(p.style) ? p.style : null;
  if (p.images         !== undefined) row.images          = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
  if (p.imagePaths     !== undefined) row.image_paths     = Array.isArray(p.imagePaths) ? p.imagePaths.filter(Boolean) : [];
  if (p.homeImageUrl   !== undefined) row.image_url       = p.homeImageUrl;
  if (p.imagePath      !== undefined) row.image_path      = p.imagePath;
  if (p.stockImageUrl  !== undefined) row.stock_image_url = p.stockImageUrl;
  return row;
}

// ---------- CRUD ----------
export async function fetchAll() {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

export async function createProduct(product) {
  const { data, error } = await supabase
    .from('products')
    .insert(toRow(product))
    .select()
    .single();
  if (error) throw error;
  return fromRow(data);
}

export async function updateProduct(id, patch) {
  const { data, error } = await supabase
    .from('products')
    .update(toRow(patch))
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return fromRow(data);
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Storage (imagenes) ----------
export async function uploadImage(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const key = `admin/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from('carteras')
    .upload(key, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('carteras').getPublicUrl(key);
  return { publicUrl: data.publicUrl, path: key };
}

// Multi-upload (Fase 3): sube varias fotos en paralelo y devuelve
// arrays paralelos de URLs y paths, en el mismo orden de entrada.
// Si alguna falla, tira el error (no deja fotos huerfanas a medio subir
// — el caller puede decidir reintentar con las que quedaron).
export async function uploadImages(files) {
  const list = Array.from(files ?? []);
  if (list.length === 0) return { publicUrls: [], paths: [] };

  const results = await Promise.all(list.map((f) => uploadImage(f)));
  return {
    publicUrls: results.map((r) => r.publicUrl),
    paths:      results.map((r) => r.path)
  };
}

// Borra un objeto del bucket 'carteras' por path. Silencioso si falla
// (el admin puede tener URLs externas que no viven en Storage, y eso no
// es error — solo se limpia lo propio).
export async function deleteImageByPath(path) {
  if (!path) return;
  const { error } = await supabase.storage.from('carteras').remove([path]);
  if (error) console.warn('[storage] no se pudo borrar', path, error.message);
}

// ---------- Realtime ----------
// callback recibe { event, product } donde event es INSERT|UPDATE|DELETE.
// Devuelve funcion para cancelar la suscripcion.
export function subscribeChanges(callback) {
  const channel = supabase
    .channel('products-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'products' },
      (payload) => {
        const product =
          payload.eventType === 'DELETE'
            ? fromRow(payload.old)
            : fromRow(payload.new);
        callback({ event: payload.eventType, product });
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

// ============================================================
// Wishlist (avisos de clientes esperando que llegue algo)
// Tabla: public.wishlist — RLS:
//   - insert publico (cualquiera se anota),
//   - select/update/delete solo autenticados (admin).
// ============================================================

function fromWishRow(row) {
  return {
    id:          row.id,
    whatsapp:    row.whatsapp ?? '',
    brand:       row.brand ?? null,
    maxPrice:    row.max_price == null ? null : Number(row.max_price),
    productRef:  row.product_ref ?? null,
    notes:       row.notes ?? '',
    notified:    Boolean(row.notified),
    notifiedAt:  row.notified_at ?? null,
    createdAt:   row.created_at
  };
}

function normalizeWhatsapp(raw) {
  // Deja solo digitos + un leading +.
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const hasPlus = s.startsWith('+');
  const digits = s.replace(/\D+/g, '');
  return hasPlus ? `+${digits}` : digits;
}

export async function createWishlistEntry(entry) {
  const whatsapp = normalizeWhatsapp(entry.whatsapp);
  if (!whatsapp) throw new Error('Numero de WhatsApp requerido.');

  const row = {
    whatsapp,
    brand:       entry.brand ? String(entry.brand).trim() : null,
    max_price:   entry.maxPrice == null || entry.maxPrice === '' ? null : Number(entry.maxPrice),
    product_ref: entry.productRef ?? null,
    notes:       entry.notes ? String(entry.notes).trim() : null
  };

  const { data, error } = await supabase
    .from('wishlist')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return fromWishRow(data);
}

// Admin only (RLS bloquea si no hay sesion).
export async function listWishlist({ includeNotified = false } = {}) {
  let query = supabase
    .from('wishlist')
    .select('*')
    .order('created_at', { ascending: false });
  if (!includeNotified) query = query.eq('notified', false);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(fromWishRow);
}

export async function markWishlistNotified(id, notified = true) {
  const patch = {
    notified,
    notified_at: notified ? new Date().toISOString() : null
  };
  const { data, error } = await supabase
    .from('wishlist')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return fromWishRow(data);
}

export async function deleteWishlistEntry(id) {
  const { error } = await supabase.from('wishlist').delete().eq('id', id);
  if (error) throw error;
}

// Realtime: avisa al admin si llega un wishlist nuevo.
export function subscribeWishlist(callback) {
  const channel = supabase
    .channel('wishlist-changes')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'wishlist' },
      (payload) => {
        const entry =
          payload.eventType === 'DELETE'
            ? fromWishRow(payload.old)
            : fromWishRow(payload.new);
        callback({ event: payload.eventType, entry });
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

// Matching puro (sin I/O) — el caller decide que hacer con los matches.
// Un producto "calza" con un wish si:
//   - el wish apunta a ese product_ref (match exacto), o
//   - (marca null o marca == product.brand, case-insensitive) Y
//     (max_price null o product.price <= max_price) Y
//     (el producto esta disponible).
// Estamos suponiendo getStatus = disponible cuando stock > 0 y available.
export function matchesWish(product, wish) {
  if (!product || !wish) return false;
  if (wish.notified) return false;
  const isAvailable = Boolean(product.available) && Number(product.stock) > 0;
  if (!isAvailable) return false;

  if (wish.productRef && wish.productRef === product.id) return true;

  if (wish.brand) {
    const a = String(wish.brand).trim().toLowerCase();
    const b = String(product.brand ?? '').trim().toLowerCase();
    if (a !== b) return false;
  }
  if (wish.maxPrice != null && Number(product.price) > Number(wish.maxPrice)) return false;

  // Si no hay productRef ni marca ni precio, es demasiado abierto: que el admin lo vea en la lista.
  if (!wish.brand && wish.maxPrice == null && !wish.productRef) return false;

  return true;
}

export function findMatchesForProduct(product, wishes) {
  return (wishes ?? []).filter((w) => matchesWish(product, w));
}
