// ============================================================
// American Vault — seed de productos a Supabase
//
// Uso:
//   1. npm install
//   2. Copia .env.example a .env.local y pega tu SUPABASE_SERVICE_ROLE_KEY.
//   3. node scripts/seed.mjs           (inserta de verdad)
//      node scripts/seed.mjs --dry-run (solo imprime qué haría)
//
// El script:
//   - Lee todos los archivos de ./carteras/
//   - Parsea marca, nombre, precio del nombre del archivo
//   - Sube la imagen al bucket 'carteras' de Supabase Storage
//   - Inserta el producto en la tabla 'products'
//   - Idempotente: si 'source_file' ya existe en DB, lo salta.
// ============================================================

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Cargar .env.local primero (convencional para secretos locales),
// luego .env como fallback. Variables ya presentes no se sobrescriben.
loadEnv({ path: path.join(ROOT, '.env.local') });
loadEnv({ path: path.join(ROOT, '.env') });
const CARTERAS_DIR = path.join(ROOT, 'carteras');
const BUCKET = 'carteras';
const DRY_RUN = process.argv.includes('--dry-run');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
  console.error('   Copia .env.example a .env.local y completa los valores.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// ---------- Parsing (portado de app.js v1) ----------

function extractPriceFromFileName(baseName) {
  const solesMatch = baseName.match(/(\d{2,4})(?=\s*sole?s?\b)/i);
  if (solesMatch) return Number(solesMatch[1]);
  const trailing = baseName.match(/(\d{2,4})(?!.*\d)/);
  return trailing ? Number(trailing[1]) : null;
}

function cleanProductName(baseName, price) {
  let s = baseName;
  s = s.replace(new RegExp(`\\b${price}\\b\\s*sole?s?`, 'i'), '');
  s = s.replace(new RegExp(`\\b${price}\\b`, 'i'), '');
  s = s.replace(/\bsole?s?\b/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  const repeated = s.match(/^(.+?)\s+\1$/i);
  if (repeated) s = repeated[1];
  s = s.replace(/\s+\b[aA]\b$/, '').trim();
  return s;
}

function detectBrand(name) {
  const text = String(name || '').toLowerCase();
  const brands = [];
  if (/\bguess\b/.test(text))                 brands.push('Guess');
  if (/\bmk\b|michael\s*kors/.test(text))     brands.push('Michael Kors');
  if (/nautica|n[áa]utica/.test(text))        brands.push('Nautica');
  if (/steve\s*madden/.test(text))            brands.push('Steve Madden');
  if (/\bth\b|tommy\s*hilfiger/.test(text))   brands.push('Tommy Hilfiger');
  if (/juicy/.test(text))                     brands.push('Juicy Couture');
  return brands.length ? [...new Set(brands)].join(' / ') : 'Sin marca';
}

function toDisplayName(text) {
  const lowered = String(text || '').toLocaleLowerCase('es-PE');
  return lowered
    .replace(/(^|\s|[+/(-])([\p{L}\p{N}])/gu, (_, p, c) => p + c.toLocaleUpperCase('es-PE'))
    .replace(/\bMk\b/g, 'MK')
    .replace(/\bTh\b/g, 'TH');
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function guessMime(name) {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png')                   return 'image/png';
  if (ext === 'webp')                  return 'image/webp';
  return 'application/octet-stream';
}

// ---------- Main ----------

async function main() {
  console.log(`\n🔐 Proyecto: ${SUPABASE_URL}`);
  console.log(`📁 Carteras: ${CARTERAS_DIR}`);
  if (DRY_RUN) console.log('🧪 DRY RUN — no se escribirá nada.\n');
  else         console.log('');

  const files = await fs.readdir(CARTERAS_DIR);
  const usable = files.filter(
    f => /\.(jpe?g|png|webp)$/i.test(f) && !/^whatsapp image/i.test(f)
  );
  console.log(`Encontrados ${usable.length} archivos utilizables.\n`);

  // Evitar duplicados
  let knownSources = new Set();
  if (!DRY_RUN) {
    const { data: existing, error } = await supabase
      .from('products')
      .select('source_file');
    if (error) {
      console.error('❌ No se pudo consultar productos existentes:', error.message);
      process.exit(1);
    }
    knownSources = new Set((existing ?? []).map(r => r.source_file).filter(Boolean));
    if (knownSources.size > 0) {
      console.log(`ℹ️  Ya hay ${knownSources.size} productos previos (se saltarán).\n`);
    }
  }

  let inserted = 0, skipped = 0, failed = 0;

  for (const fileName of usable) {
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const price    = extractPriceFromFileName(baseName);
    if (price === null) {
      console.log(`  ⏭  skip (sin precio en nombre): ${fileName}`);
      skipped++;
      continue;
    }

    if (knownSources.has(fileName)) {
      console.log(`  ⏭  skip (ya existe): ${fileName}`);
      skipped++;
      continue;
    }

    const cleaned     = cleanProductName(baseName, price);
    const displayName = toDisplayName(cleaned || 'Cartera');
    const brand       = detectBrand(cleaned);
    const storagePath = `seed/${slugify(baseName)}${path.extname(fileName)}`;

    if (DRY_RUN) {
      console.log(`  🧪 ${displayName} — ${brand} — S/${price}  [${storagePath}]`);
      inserted++;
      continue;
    }

    // 1) Subir imagen
    const buf = await fs.readFile(path.join(CARTERAS_DIR, fileName));
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buf, {
        contentType: guessMime(fileName),
        upsert: true
      });
    if (upErr) {
      console.error(`  ❌ upload fallo ${fileName}: ${upErr.message}`);
      failed++;
      continue;
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    // 2) Insertar producto
    const { error: insErr } = await supabase
      .from('products')
      .insert({
        name:        displayName,
        brand,
        color:       'Variado',
        price,
        stock:       1,
        available:   true,
        status:      'available',
        image_url:   pub.publicUrl,
        image_path:  storagePath,
        source_file: fileName
      });

    if (insErr) {
      console.error(`  ❌ insert fallo ${fileName}: ${insErr.message}`);
      failed++;
      continue;
    }

    console.log(`  ✅ ${displayName} — ${brand} — S/${price}`);
    inserted++;
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log(`Resumen: ${inserted} insertados · ${skipped} saltados · ${failed} fallidos`);
  if (DRY_RUN) console.log(`(era dry-run, no se tocó nada)`);
  console.log(`──────────────────────────────────────────\n`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('\n💥 Error fatal:', err);
  process.exit(1);
});
