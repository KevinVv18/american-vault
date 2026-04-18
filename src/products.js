import { supabase } from './supabase.js';
import { FALLBACK_IMAGE } from './config.js';

// ---------- Mapeo DB <-> UI ----------
// La tabla usa snake_case, la UI sigue usando camelCase para no romper codigo.
function fromRow(row) {
  const stock = row.stock_image_url || '';
  const home  = row.image_url || '';
  // primary: stock editorial si existe, sino la casera, sino el fallback.
  // secondary: la casera cuando primary es stock (si no, null).
  const primary   = stock || home || FALLBACK_IMAGE;
  const secondary = stock && home ? home : null;
  return {
    id:            row.id,
    name:          row.name ?? '',
    brand:         row.brand ?? 'Sin marca',
    color:         row.color ?? 'Variado',
    price:         Number(row.price ?? 0),
    stock:         Number(row.stock ?? 0),
    available:     Boolean(row.available),
    status:        row.status ?? 'available',
    imageUrl:      primary,                // primera (la que ve el cliente)
    secondaryUrl:  secondary,              // foto casera, para swipe/hover
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
