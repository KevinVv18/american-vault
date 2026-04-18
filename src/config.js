// Configuracion publica. La publishable/anon key NO es secreta:
// esta disenada para ir en frontend. La seguridad real vive en
// las Row Level Security policies definidas en supabase/schema.sql.
export const SUPABASE_URL = 'https://acmllkuqsxukxevunzei.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_ZaaJ9_slQk3abAdC_pRnUA_NU7Kxtby';

export const WHATSAPP_NUMBER = '51998251375';
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

// Imagen que se muestra si un producto no tiene ni stock ni casera.
// Vive en el repo bajo /stock/default-bag.jpg (editorial neutra).
export const FALLBACK_IMAGE = 'stock/default-bag.jpg';
