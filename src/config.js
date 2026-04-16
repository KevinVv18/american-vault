// Configuracion publica. La publishable/anon key NO es secreta:
// esta disenada para ir en frontend. La seguridad real vive en
// las Row Level Security policies definidas en supabase/schema.sql.
export const SUPABASE_URL = 'https://acmllkuqsxukxevunzei.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_ZaaJ9_slQk3abAdC_pRnUA_NU7Kxtby';

export const WHATSAPP_NUMBER = '51906765040';
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`;

export const FALLBACK_IMAGE =
  'https://dummyimage.com/600x750/e5dccf/2f2317&text=Cartera';
