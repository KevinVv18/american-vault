import { supabase } from './supabase.js';

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password
  });
  if (error) throw error;
  return data.session;
}

export async function sendMagicLink(email) {
  // Redirect siempre a la raiz del sitio con ?admin=1 para que el callback
  // abra el panel automaticamente. Usamos origin+pathname (sin hash/query
  // previos) para que Supabase no rechace la URL.
  const redirectTo = `${window.location.origin}${window.location.pathname}?admin=1`;
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: redirectTo }
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}
