# American Vault — catalogo web

Catalogo publico de carteras importadas con modo admin, Supabase backend y deploy automatico a Hostinger.

## Arquitectura

- **Frontend**: HTML + CSS + JS (ES modules). Sin build step.
- **Backend**: [Supabase](https://supabase.com) (Postgres + Auth + Storage + Realtime).
- **Hosting**: Hostinger (plan anual). Dominio: `american-vault.com`.
- **Deploy**: GitHub Actions -> FTP a Hostinger en cada push a `main`.

## Estructura

```
american vault/
  index.html            pagina unica
  app.js                orquestador (ES module)
  styles.css
  src/
    config.js           URL + publishable key de Supabase, numero WhatsApp
    supabase.js         cliente compartido
    auth.js             login / logout / magic link
    products.js         CRUD + storage + realtime
  supabase/
    schema.sql          tablas products, wishlist, RLS, storage
  scripts/
    seed.mjs            importa las carteras iniciales (corre una vez)
  .github/workflows/
    deploy.yml          CI/CD a Hostinger
```

## Setup local

```bash
npm install
cp .env.example .env.local
# Pega tu SUPABASE_SERVICE_ROLE_KEY en .env.local (NUNCA commitear)
```

### Re-seed (rara vez)

```bash
npm run seed:dry    # preview, no escribe nada
npm run seed        # inserta de verdad (idempotente)
```

### Probar el sitio local

Cualquier servidor estatico sirve. Ejemplos:

```bash
python -m http.server 5174
# o
npx --yes serve -l 5174 .
```

Luego abre http://localhost:5174.

## Supabase

- Project URL y anon key publica estan en `src/config.js` (no son secretas).
- El `service_role` key es secreta, solo vive en `.env.local` y en scripts locales.
- Policies (RLS) definidas en `supabase/schema.sql`:
  - `products`: lectura publica, escritura solo autenticados.
  - `wishlist`: cualquiera inserta, solo admin lee/edita.

## Admin

1. Click en el candado del header.
2. Ingresa correo + contrasena del usuario creado en Supabase Auth.
3. Alternativamente, click "enlace magico por correo".

## Deploy

El workflow usa **SSH + rsync** a Hostinger (via GitHub Actions → `burnett01/rsync-deployments`).

- **Host:** `89.116.115.11` — **Puerto:** `65002`
- **Usuario:** `u567580447`
- **Ruta remota:** `/home/u567580447/domains/american-vault.com/public_html/`

Secret requerido en GitHub (`Settings > Secrets and variables > Actions`):

- `SSH_PRIVATE_KEY` — contenido completo de la llave privada ed25519 (incluyendo las líneas `BEGIN/END OPENSSH PRIVATE KEY`). La llave pública correspondiente debe estar registrada en Hostinger > SSH Access > SSH keys.

Push a `main` dispara el deploy automaticamente. También se puede ejecutar manualmente desde la pestaña *Actions*.
