# CLAUDE.md — American Vault

> Documento de arranque para cualquier IA o desarrollador que tome este proyecto
> desde cero. Contiene contexto de negocio, arquitectura, APIs, workflows de
> desarrollo y deploy. Última actualización: junio 2026 (commit `01a69ed`).
>
> ⚠️ Este archivo está EXCLUIDO del deploy (ver `.github/workflows/deploy.yml`).
> No debe llegar nunca a `public_html`.

---

## 1. Qué es este proyecto

**American Vault** (https://american-vault.com) es un catálogo e-commerce de
carteras de marca importadas desde USA, vendidas en Perú. NO tiene checkout:
la conversión es 100% vía **WhatsApp** (`51998251375`). El sitio es la vitrina;
el cierre de venta ocurre en el chat.

- **Sitio estático**: HTML/CSS/JS vanilla (sin framework, sin bundler).
- **Backend**: Supabase (Postgres + Auth + Storage + Realtime).
- **Hosting**: Hostinger compartido (Apache), deploy automático por GitHub Actions.
- **Dueño**: Kevin Villalobos (kevinv15v@gmail.com). Sitio hecho por DAK Agency.

## 2. Modelo de negocio (contexto para toda decisión)

- **Fundado**: enero 2026, **Chiclayo, Lambayeque, Perú** (NO Lima — hubo que corregirlo).
- **Una unidad por modelo, casi nunca se repone.** El producto que se vende no
  vuelve. Esto define el copy ("Casi siempre única", "Una pieza, un dueño") y
  features como bestsellers-por-escasez (no por ventas — no hay métricas de venta).
- Marcas que se importan: Guess, Michael Kors, Tommy Hilfiger, Nautica,
  Steve Madden, Juicy Couture.
- Hoy carteras; a futuro otros productos curados (el copy usa "pieza", no "cartera",
  donde es posible, para no atar la marca).
- Estado actual: esperando fardos de carteras para tomar fotos oficiales.
  **Aún no hay clientes** → no implementar testimonials todavía (D3 pendiente).
- Mobile-first: la mayoría del tráfico esperado es celular vía redes sociales.

## 3. Identidad de marca (no negociable)

- **B&W puro estilo Apple/editorial**: fondo blanco `#ffffff`, tinta `#1d1d1f`.
  El hero es negro puro con gradiente a blanco.
- **Tipografías**: Fraunces (serif, headings/editorial) + Jost (sans, UI/body).
  Google Fonts, pesos 300–700.
- **Tono**: lujo minimalista, revista impresa, hairlines, letter-spacing amplio,
  small-caps. Radios de botones casi cuadrados (2px).
- **Calidad sobre velocidad**: el dueño prefiere codear a mano con detalle antes
  que generadores (no usar skills/herramientas Stitch para este proyecto).
- Logos oficiales en `assets/brand/` (icon-av-black/white.svg, logo-av-*.svg).
- **El 3D del hero CONSERVA sus texturas PBR** (cuero negro + herraje dorado).
  Se intentó un rebrand a materiales planos B&W y el dueño lo rechazó — no repetir.

## 4. Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | HTML + CSS + JS vanilla, ES Modules nativos (sin build) |
| 3D hero | three.js 0.160.1 vía CDN unpkg + importmap, GLB + texturas WebP |
| Backend | Supabase: proyecto `acmllkuqsxukxevunzei` |
| DB client | `@supabase/supabase-js@2.45.4` vía esm.sh (CDN, no npm en runtime) |
| Hosting | Hostinger compartido, Apache, ruta `/home/u567580447/domains/american-vault.com/public_html/` |
| CI/CD | GitHub Actions → rsync por SSH en cada push a `main` |
| Repo | github.com:KevinVv18/american-vault.git (branch única: `main`) |

No hay framework, no hay bundler, no hay TypeScript, no hay tests automatizados.
Verificación de sintaxis rápida: `node --check app.js src/*.js`.

## 5. Mapa de archivos

```
american vault/
├── index.html              # SPA completa (~760 líneas): todas las secciones + modales
├── app.js                  # Lógica principal (~2600 líneas), ver §6
├── styles.css              # Todos los estilos (~3000 líneas), secciones con banners "==="
├── .htaccess               # Cache headers Apache (ver §12 — CRÍTICO)
├── CLAUDE.md               # Este documento (excluido del deploy)
├── src/
│   ├── config.js           # Constantes públicas: SUPABASE_URL, ANON_KEY, WHATSAPP, FALLBACK_IMAGE
│   ├── supabase.js         # createClient singleton (storageKey 'americanVault.auth')
│   ├── auth.js             # getSession, signInWithPassword, sendMagicLink, signOut, onAuthChange
│   ├── products.js         # TODA la capa de datos: CRUD, storage, realtime, wishlist, newsletter
│   └── hero.js             # Scrollytelling 3D del hero (módulo autoejecutable, sin exports)
├── supabase/
│   ├── schema.sql                          # Schema canónico completo (fresh installs solo necesitan esto)
│   ├── migration_phase3_images_style.sql   # Migración: images[]/image_paths[]/style + backfill
│   └── migration_phase4_newsletter.sql     # Migración: tabla newsletter_subscribers
├── scripts/                # (excluido del deploy)
│   ├── seed.mjs            # Siembra productos desde ./carteras/ (npm run seed / seed:dry)
│   ├── convert-fbx-to-glb.mjs  # Conversión offline del modelo 3D (npm run convert:3d)
│   └── build-static.mjs    # Build a dist/ (legacy, casi no se usa)
├── assets/
│   ├── brand/              # SVGs del logo/monograma AV (black/white/full)
│   └── 3d/handbag/         # handbag.glb + handbag.fbx + textures/*.webp (12 PBR maps)
├── carteras/               # Fotos caseras de productos (fuente del seed; excluido del deploy)
├── stock/                  # default-bag.jpg (fallback) + futuras fotos editoriales
├── .github/workflows/deploy.yml  # Pipeline de deploy (ver §12)
├── .env.example            # Plantilla: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
└── package.json            # Solo devDependencies para scripts locales
```

## 6. Arquitectura frontend (app.js)

### Estado global

```js
state = {
  products: [],            // catálogo completo (fromRow-mapeado)
  isAdmin: false,          // true si hay sesión Supabase
  adminEmail: null,
  lastUpdated: null,       // ISO string
  wishlistLocal: Set,      // corazones del cliente, localStorage 'av.wishlist'
  wishlistEntries: [],     // wishlist server-side (solo admin)
  wishlistShowNotified: false,
  adminView: 'catalog',    // tab activo admin: 'catalog' | 'wishlist'
  notifyContext: null,     // producto del modal "Avísame" (null = lead genérico)
  filters: { search, brand:'all', color:'all', minPrice, maxPrice,
             stock:'all', styles: Set },
  detailGallery: { images: [], index: 0 }
}
```

### Flujo de arranque (`init()`)

1. `cacheElements()` — ~90 refs DOM cacheadas en `elements.*`
2. `bindEvents()` — todo por event delegation
3. `parseAuthCallback()` — procesa `?admin=1` y `#error=` de Supabase auth
4. `getSession()` + `onAuthChange()` — sesión admin
5. `loadCatalog()` → `fetchAll()` → `state.products`
6. `subscribeChanges(handleRealtimeChange)` — realtime de products
7. `readFiltersFromURL()` — `?brand=` / `?style=` antes del primer render
8. Renders + `openDetailFromURL()` — deep-link `?id=`

### Features públicas

- **Catálogo**: grid 4/3/2 columnas (breakpoints 1100/780px). Cards con
  aspect-ratio 4:5 + `object-fit: contain` + fondo blanco (la foto SIEMPRE se ve
  completa, sin recortes — decisión final del dueño tras varias iteraciones).
  Primeras 6 cards eager+fetchpriority=high (LCP).
- **Filtros**: search, brand pills (single), style pills (multi-select Set,
  se auto-ocultan si ningún producto tiene style), color swatches, precio
  min/max, stock. Sincronizados a URL (`?brand=`, `?style=tote,clutch`).
- **Modal detalle**: galería multi-foto (flechas, dots, contador, teclado,
  swipe táctil 40px), deep-link `?id=` con pushState/popstate, share nativo,
  CTA WhatsApp con mensaje prellenado + deep-link de recuperación `&b=brand`.
- **Wishlist cliente**: corazones en localStorage + drawer + "enviar por WhatsApp".
- **Notify-me ("Avísame cuando llegue")**: en productos agotados o desde el
  empty-state → inserta en tabla `wishlist`.
- **Newsletter (footer)**: "Avísame cuando llegue algo nuevo" → tabla
  `newsletter_subscribers`. Re-suscripción (23505) se trata como éxito.
- **Bestsellers**: sección negra post-catálogo; 4 productos con MENOR stock
  (urgencia honesta por escasez). Se oculta sola si no hay candidatos.
- **Origin**: story editorial "De boutiques en USA. A tus manos."

### Admin (visible solo con sesión)

- Login: candado del topbar → password o magic link (redirect `?admin=1`,
  cooldown reenvío 60s).
- **Quick Add**: multi-foto con compresión client-side (maxSide 1600, target
  <420KB), reorden drag&drop (índice 0 = "Principal"), select de estilo,
  Publicar o Borrador (draft: stock=0, available=false, invisible en público).
- **Tabla inline**: editar nombre/marca/color/precio/stock/disponible en línea;
  stock y available se auto-sincronizan. Eliminar con confirmDialog.
- **Wishlist admin**: lista de avisos con chips de match (matchesWish: marca +
  precio tope + disponibilidad), botón WhatsApp saliente que auto-marca
  notificado, toggle notificado, eliminar.
- Toast de match en realtime: si entra/cambia un producto que calza con un
  aviso pendiente, banner 12s en adminNotice.

### Convenciones de código

- Comentarios **en español**, explican el *porqué* (decisiones), no el qué.
- DB usa `snake_case`, la UI usa `camelCase` — `fromRow`/`toRow` en
  `src/products.js` son el ÚNICO punto de mapeo.
- Sanitización: `escapeHtml`/`escapeAttribute` en TODO render de datos de DB.
- `confirmDialog()` reemplaza `window.confirm` (branded, Promise<boolean>).
- Moneda: `formatCurrency` es-PE PEN (S/).

## 7. Base de datos (Supabase, proyecto `acmllkuqsxukxevunzei`)

### Tablas

**`products`** — catálogo
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| name, brand, color | text | brand default 'Sin marca', color 'Variado' |
| price | numeric(10,2) | CHECK >= 0 |
| stock | integer | CHECK >= 0 |
| available | boolean | default true |
| status | text | CHECK: available/reserved/sold_out |
| **images** | text[] | galería ordenada; [0] = principal del catálogo |
| **image_paths** | text[] | paths en bucket (paralelo a images, para cleanup) |
| image_url, image_path, stock_image_url | text | LEGACY (Fase 1) — mantener por compat |
| style | text | CHECK: crossbody/tote/satchel/clutch/bucket/hobo/shoulder/mini, NULL = sin clasificar |
| source_file | text UNIQUE | idempotencia del seed |
| created_at, updated_at | timestamptz | updated_at via trigger |

Orden de lectura de imagen en el front: `images[0] || stock_image_url || image_url || FALLBACK_IMAGE`.

**`wishlist`** — avisos "avísame cuando llegue" (intención específica de compra)
- whatsapp, brand (null=cualquiera), max_price (null=sin tope),
  product_ref (FK products, SET NULL), notes, notified, notified_at.

**`newsletter_subscribers`** — captura general del footer
- whatsapp (UNIQUE — re-suscribir lanza 23505, el front lo trata como éxito), source ('footer').

### RLS (la seguridad REAL vive acá, la anon key es pública)

| Tabla | Público | Authenticated (admin) |
|---|---|---|
| products | SELECT | INSERT/UPDATE/DELETE |
| wishlist | INSERT | SELECT/UPDATE/DELETE |
| newsletter_subscribers | INSERT | SELECT/DELETE |
| storage bucket `carteras` | SELECT (público) | INSERT/UPDATE/DELETE |

### Realtime

Solo `products` está en la publicación `supabase_realtime`. Los clientes
reciben INSERT/UPDATE/DELETE en vivo (stock, precios, productos nuevos) sin
recargar. Canales: `products-changes` y `wishlist-changes` (este último solo
lo consume el admin).

### Migraciones — cuándo correr qué

- **Instalación desde cero**: solo `supabase/schema.sql` (lo incluye todo, idempotente).
- **DB pre-Fase 3**: correr `migration_phase3_images_style.sql` (agrega
  images[]/image_paths[]/style + backfill desde columnas legacy).
- **DB pre-Fase D**: correr `migration_phase4_newsletter.sql`.
- Todas son idempotentes (re-correr no rompe). Se ejecutan en
  Supabase Dashboard → SQL Editor.

## 8. API de datos (src/products.js — única capa de acceso)

```js
// Catálogo
fetchAll() → Product[]                    // select * ordered created_at desc
createProduct(p) / updateProduct(id, patch) / deleteProduct(id)
subscribeChanges(cb) → unsubscribe        // realtime products

// Storage (bucket 'carteras')
uploadImage(file) → { publicUrl, path }   // key: admin/<ts>-<uuid>.<ext>
uploadImages(files) → { publicUrls[], paths[] }  // paralelo, mismo orden
deleteImageByPath(path)                   // silencioso si falla

// Estilos
STYLES = ['crossbody','tote','satchel','clutch','bucket','hobo','shoulder','mini']
STYLE_LABELS, isValidStyle(s)             // deben coincidir con el CHECK de la DB

// Wishlist
createWishlistEntry({whatsapp, brand, maxPrice, productRef, notes})
listWishlist({includeNotified}) / markWishlistNotified(id) / deleteWishlistEntry(id)
subscribeWishlist(cb) → unsubscribe
matchesWish(product, wish) / findMatchesForProduct(product, wishes)  // puros, sin I/O

// Newsletter
subscribeNewsletter(whatsapp, source) → { alreadySubscribed }
```

Imágenes responsivas: `buildImageSources()` en app.js transforma URLs del
bucket a `/storage/v1/render/image/public/` con widths 400/600/900/1200 q75
(Supabase image transforms). URLs externas pasan crudas.

## 9. Hero 3D (src/hero.js)

- **Scrollytelling**: hero de 200vh (130vh mobile ≤780px, 110vh landscape corto).
  La cartera 3D rota 315° siguiendo el scroll; 3 headlines ("actos") aparecen
  por rangos de progress: [0–0.26], [0.30–0.58], [0.62–fin].
- **Dos capas**: silueta SVG (fallback inmediato, reduce-motion, sin WebGL2) +
  upgrade lazy a three.js (requestIdleCallback) con cross-fade CSS de 1.2s.
- **Modelo**: `assets/3d/handbag/handbag.glb` (convertido de FBX con
  `npm run convert:3d`) + 12 texturas WebP PBR (3 regiones × 4 mapas).
  Materiales remapeados por nombre de mesh (lower/metal/upper).
- **Entry animation**: si el usuario está en el primer fold al cargar el 3D,
  la cartera "se posa" (offset rotación+tilt decae 900ms).
- **Drag interactivo (D1)**: arrastre horizontal rota la cartera (touch+mouse,
  `touch-action: pan-y`, lock direccional para no robar el scroll vertical);
  al soltar decae a 0 en 700ms.
- **Stock counter**: app.js emite `CustomEvent('av:catalog-count')` +
  `window.__avCatalog`; hero hace count-up al entrar el acto 3.
- **Topbar sync**: clase `is-over-dark` calculada sincrónicamente por scroll
  (NO IntersectionObserver — causaba flashes).
- Debug local: `window.__hero3D` expuesto solo en localhost.

## 10. Deploy + sistema de cache (CRÍTICO — leer antes de tocar nada)

### Pipeline (push a main = deploy automático)

```
push a main
  → GitHub Actions (.github/workflows/deploy.yml)
    1. checkout
    2. "Inject build hash": sed reemplaza __BUILD_HASH__ por el SHA corto (7 chars)
       en TODOS los .html y .js (excluye .git/.github/node_modules/scripts)
    3. rsync -avz --delete por SSH a Hostinger
       host 89.116.115.11 : puerto 65002 : user u567580447
       destino: /home/u567580447/domains/american-vault.com/public_html/
```

- Secret requerido: `SSH_PRIVATE_KEY` (GitHub repo Settings → Secrets).
- ⚠️ **NUNCA** tocar `/home/u567580447/public_html/` ni `.../domains/dakagency.net/`
  — pertenecen a DAK Agency.
- Excluidos del deploy: `.git .github .claude node_modules scripts supabase
  referencias carteras dist .env* package*.json README.md CLAUDE.md *.fbx 3D/`.

### Cache-busting de 3 capas (resuelve "clientes ven versión vieja")

1. **Placeholder en el código**: toda referencia interna versionada lleva
   `?v=__BUILD_HASH__` — en el HTML (`styles.css`, `app.js`, `src/hero.js`)
   **y en los imports internos de los JS** (`import ... from './src/products.js?v=__BUILD_HASH__'`).
2. **CI lo sustituye** por el commit SHA antes del rsync → URL única por deploy.
3. **`.htaccess` (Apache)**:
   - HTML → `no-cache, no-store, must-revalidate` (siempre fresco)
   - CSS/JS → `max-age=31536000, immutable` (1 año; seguro porque la URL cambia por commit)
   - Imágenes/fuentes/3D → 30 días + must-revalidate
   - \+ gzip + mime types (glb/webp/woff2) + headers de seguridad

### 🔴 REGLA DE ORO al crear/editar imports

**Todo import relativo nuevo en cualquier JS DEBE llevar `?v=__BUILD_HASH__`:**

```js
// ✅ CORRECTO
import { algo } from './src/nuevo-modulo.js?v=__BUILD_HASH__';
// ❌ ROMPE PRODUCCIÓN (el browser usará la versión cacheada vieja del módulo)
import { algo } from './src/nuevo-modulo.js';
```

Incidente real (commit `01a69ed`): `app.js` nuevo importó `products.js`
cacheado viejo → `SyntaxError: does not provide an export named
'subscribeNewsletter'` → el catálogo quedó en "Cargando catalogo..." infinito.

### Cómo se actualiza cada cosa (referencia rápida)

| Cambio | Mecanismo | El cliente lo ve |
|---|---|---|
| Producto editado en admin | Supabase realtime | Al instante, sin recargar |
| Foto nueva de producto | URL única en bucket | Al siguiente render |
| Código deployado | Cache-bust automático | En su siguiente visita |

## 11. Workflows de desarrollo

### Hacer un cambio y publicarlo

```bash
# 1. Editar archivos (recordar ?v=__BUILD_HASH__ en imports nuevos)
# 2. Verificar sintaxis
node --check app.js; node --check src/products.js   # etc.
# 3. Commit estilo convencional en español + push
git add <archivos>
git commit -m "feat(scope): descripción"   # feat/fix/polish/perf/infra/revert(scope)
git push origin main                        # ← esto ES el deploy (1-2 min)
```

- Branch única `main`; no hay PRs ni staging. Cada push va directo a producción.
- Mensajes de commit: convencional, en español, body explicando el porqué.
- Tras el deploy, verificar con DevTools → Network que `app.js?v=<sha-nuevo>` carga.

### Cambiar el schema de la DB

1. Editar `supabase/schema.sql` (estado canónico, para fresh installs).
2. Crear `supabase/migration_<fase>_<nombre>.sql` idempotente (ADD COLUMN IF NOT
   EXISTS, DO-blocks para constraints, etc.) para las DBs existentes.
3. Avisar al dueño que debe correr la migración en Supabase Dashboard → SQL Editor
   (la IA no tiene acceso directo a la DB; solo el dueño).
4. El front debe degradar con gracia si la migración aún no corrió
   (ej. `fromRow` chequea `Array.isArray(row.images)`).

### Sembrar productos (cuando lleguen los fardos)

```bash
# Fotos en ./carteras/ con nombre "<Nombre> <marca> <precio> soles.jpeg"
cp .env.example .env.local   # completar SUPABASE_SERVICE_ROLE_KEY
npm install
npm run seed:dry             # primero dry-run, revisar el parseo
npm run seed                 # inserta de verdad (idempotente por source_file)
```

### Probar localmente

Servir con cualquier static server (`npx serve`, Live Server, etc.) — el
placeholder `__BUILD_HASH__` sin sustituir funciona (el browser lo trata como
query string literal). Supabase responde igual desde localhost.

## 12. Secretos y credenciales — dónde vive cada cosa

| Credencial | Dónde está | ¿Es secreta? |
|---|---|---|
| SUPABASE_URL + ANON_KEY | `src/config.js` (hardcoded) | NO — diseñadas para frontend; RLS protege |
| SUPABASE_SERVICE_ROLE_KEY | `.env.local` local del dueño (gitignored) | SÍ — solo para seed scripts, JAMÁS al frontend ni al repo |
| SSH_PRIVATE_KEY (deploy) | GitHub → Settings → Secrets → Actions | SÍ |
| Login admin del sitio | Cuenta Supabase Auth del dueño (email+password o magic link) | SÍ — la maneja el dueño |
| WhatsApp del negocio | `src/config.js` → `51998251375` | NO |

## 13. Historial de fases (qué se hizo y en qué orden)

| Fase | Commits clave | Qué entregó |
|---|---|---|
| v1–v4 base | … → `4934e64` | Catálogo, auth, admin, wishlist server, hero base |
| SEO + deep-links | `eca49d9`, `eb96d6a` | Modal detalle ?id=, OG tags, JSON-LD |
| Hero editorial | `0953ece` | 3 actos, contact shadow, light orbit, stock counter, grain |
| Polish 1 / Perf 2 | `4ef48b0`, `8642c0b` | Micro-interacciones; LCP: srcset+GLB+lazy3D |
| Fase 3 | `8fc8ab1` | Galería multi-imagen, filtro estilo, admin multi-upload, seed v2 |
| Fix fotos catálogo | `506b0bd`→`a5e377f` | Decisión final: 4:5 + contain + fondo blanco (100% visible + simetría) |
| Home sections | `f70966e` | Bestsellers (negro), Origin story, footer marcas |
| Fase A | `046f96f` | Mobile: hero 130vh, touch 44px, scroll-hint, skip-link, search |
| Fase B | `d2501c4` | Voz pieza-única + Chiclayo + Est. Ene 2026 |
| Fase C | `38bc08f` | Entry 3D, cross-fade 1.2s, hairline puente, grain parallax desktop |
| Fase D | `7b805d5` + revert `283d446` | Drag 3D ✅, newsletter ✅, rebrand materiales ❌ (revertido) |
| Infra cache | `dae846e`, `01a69ed` | Sistema 3 capas + fix imports internos |

## 14. Decisiones ya tomadas (NO re-litigar sin el dueño)

1. **Fotos del catálogo**: aspect 4:5 uniforme + `object-fit: contain` + fondo
   blanco. El dueño quiere AMBAS cosas: foto 100% visible (cero recorte) Y
   filas simétricas. Se iteró 3 veces hasta llegar acá.
2. **El 3D conserva texturas PBR**. El rebrand a materiales planos se vio
   "feo" y plano. Revertido en `283d446`.
3. **Sin checkout**: WhatsApp es el canal de conversión. No agregar carrito.
4. **Sin frameworks**: vanilla a propósito (hosting compartido, simplicidad).
5. **Bestsellers = menor stock**, no ventas (no hay datos de ventas y la
   escasez es el mensaje de marca honesto).
6. **Brand pills single-select** + style pills multi-select (así se decidió).
7. Skills de generación de UI (Stitch etc.): **no usar** — diseño a mano.

## 15. Pendientes / roadmap

- [ ] **Correr `migration_phase4_newsletter.sql` en Supabase** (si no se corrió,
      el form del footer falla al enviar).
- [ ] **Correr `migration_phase3_images_style.sql`** si los productos existentes
      no muestran galería (verificar si ya corrió).
- [ ] **D3 Testimonials**: esperando primeros clientes reales (post-fardos).
- [ ] **Fotos oficiales**: cuando lleguen los fardos → re-seed con fotos buenas,
      clasificar estilos desde el admin (los style pills aparecen solos).
- [ ] Posible futuro: reemplazar el modelo 3D genérico por una pieza real
      escaneada/modelada; vista admin para exportar newsletter_subscribers.
- [ ] Newsletter broadcast: hoy el admin exporta y manda por WhatsApp Business
      a mano; automatizar si crece.

## 16. Errores conocidos y sus síntomas (diagnóstico rápido)

| Síntoma | Causa probable | Fix |
|---|---|---|
| "Cargando catalogo..." infinito | SyntaxError de import (módulo cacheado viejo o export faltante) | Consola → ver error; verificar `?v=__BUILD_HASH__` en todos los imports |
| Form newsletter falla | Migración phase4 sin correr | Correr `migration_phase4_newsletter.sql` |
| Galería detalle con 1 sola foto en productos viejos | Migración phase3 sin correr (sin backfill) | Correr `migration_phase3_images_style.sql` |
| Cliente ve versión vieja tras deploy | Cache previo a `.htaccess` (pre-`dae846e`) | Esperar 24h máx o hard-refresh; los nuevos visitantes no sufren esto |
| Style pills no aparecen | Ningún producto tiene `style` asignado | Comportamiento esperado: clasificar desde admin |
| 3D no carga (queda silueta SVG) | Sin WebGL2, reduce-motion, o error de red CDN | Esperado: la silueta ES el fallback diseñado |

---

*Mantener este documento al día: cuando una fase nueva cambie arquitectura,
APIs o workflows, actualizar la sección correspondiente en el mismo commit.*
