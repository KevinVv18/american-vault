import { supabase } from './supabase.js';
import { FALLBACK_IMAGE } from './config.js';

// ---------- Mapeo DB <-> UI ----------
// La tabla usa snake_case, la UI sigue usando camelCase para no romper codigo.
function fromRow(row) {
  return {
    id:          row.id,
    name:        row.name ?? '',
    brand:       row.brand ?? 'Sin marca',
    color:       row.color ?? 'Variado',
    price:       Number(row.price ?? 0),
    stock:       Number(row.stock ?? 0),
    available:   Boolean(row.available),
    status:      row.status ?? 'available',
    imageUrl:    row.image_url || FALLBACK_IMAGE,
    imagePath:   row.image_path ?? null,
    sourceFile:  row.source_file ?? null,
    createdAt:   row.created_at,
    lastUpdated: row.updated_at
  };
}

function toRow(p) {
  const row = {};
  if (p.name        !== undefined) row.name        = p.name;
  if (p.brand       !== undefined) row.brand       = p.brand;
  if (p.color       !== undefined) row.color       = p.color;
  if (p.price       !== undefined) row.price       = p.price;
  if (p.stock       !== undefined) row.stock       = p.stock;
  if (p.available   !== undefined) row.available   = p.available;
  if (p.status      !== undefined) row.status      = p.status;
  if (p.imageUrl    !== undefined) row.image_url   = p.imageUrl;
  if (p.imagePath   !== undefined) row.image_path  = p.imagePath;
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
