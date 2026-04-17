// ============================================================
// American Vault — app.js (v3, Rent The Runway UI)
// - Datos en Supabase (tabla `products`, realtime).
// - Auth en Supabase (email+password, magic link opcional).
// - Imagenes en bucket `carteras`.
// ============================================================

import { WHATSAPP_URL, FALLBACK_IMAGE } from './src/config.js';
import {
  fetchAll,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadImage,
  subscribeChanges
} from './src/products.js';
import {
  getSession,
  signInWithPassword,
  sendMagicLink,
  signOut,
  onAuthChange
} from './src/auth.js';

const state = {
  products: [],
  isAdmin: false,
  adminEmail: null,
  lastUpdated: null,
  wishlistLocal: new Set(JSON.parse(localStorage.getItem('av.wishlist') || '[]')),
  filters: {
    search: '',
    brand: 'all',
    color: 'all',
    minPrice: '',
    maxPrice: '',
    stock: 'all'
  }
};

const elements = {};

document.addEventListener('DOMContentLoaded', () => {
  init().catch((error) => {
    console.error(error);
    alert('No se pudo iniciar el catalogo. Revisa la consola del navegador.');
  });
});

async function init() {
  cacheElements();
  bindEvents();
  setTopWhatsapp();

  const session = await getSession();
  applySession(session);

  onAuthChange((newSession) => {
    applySession(newSession);
    renderAll();
  });

  await loadCatalog();
  subscribeChanges(handleRealtimeChange);

  renderBrandPills();
  renderColorSwatches();
  syncFilterInputs();
  renderAll();
}

function cacheElements() {
  elements.lockButton           = document.getElementById('lockButton');
  elements.topWhatsapp          = document.getElementById('topWhatsapp');
  elements.wishlistTopBtn       = document.getElementById('wishlistTopBtn');
  elements.adminNotice          = document.getElementById('adminNotice');

  elements.pageCount            = document.getElementById('pageCount');
  elements.brandPills           = document.getElementById('brandPills');
  elements.browsingInfo         = document.getElementById('browsingInfo');
  elements.openFiltersBtn       = document.getElementById('openFiltersBtn');
  elements.activeFiltersBadge   = document.getElementById('activeFiltersBadge');

  elements.catalogGrid          = document.getElementById('catalogGrid');
  elements.lastUpdated          = document.getElementById('lastUpdated');

  elements.drawer               = document.getElementById('filterDrawer');
  elements.drawerScrim          = document.getElementById('drawerScrim');
  elements.closeDrawerBtn       = document.getElementById('closeDrawerBtn');
  elements.searchInput          = document.getElementById('searchInput');
  elements.colorSwatches        = document.getElementById('colorSwatches');
  elements.minPriceFilter       = document.getElementById('minPriceFilter');
  elements.maxPriceFilter       = document.getElementById('maxPriceFilter');
  elements.stockFilter          = document.getElementById('stockFilter');
  elements.clearFiltersButton   = document.getElementById('clearFiltersButton');
  elements.applyFiltersBtn      = document.getElementById('applyFiltersBtn');

  elements.adminPanel           = document.getElementById('adminPanel');
  elements.adminSummary         = document.getElementById('adminSummary');
  elements.productForm          = document.getElementById('productForm');
  elements.adminTableBody       = document.getElementById('adminTableBody');
  elements.signOutButton        = document.getElementById('signOutButton');
  elements.newImageFile         = document.getElementById('newImageFile');

  elements.passwordModal        = document.getElementById('passwordModal');
  elements.passwordForm         = document.getElementById('passwordForm');
  elements.emailInput           = document.getElementById('emailInput');
  elements.passwordInput        = document.getElementById('passwordInput');
  elements.passwordMessage      = document.getElementById('passwordMessage');
  elements.cancelPasswordButton = document.getElementById('cancelPasswordButton');
  elements.magicLinkButton      = document.getElementById('magicLinkButton');
}

function bindEvents() {
  // Topbar
  elements.lockButton.addEventListener('click', handleLockButton);
  elements.wishlistTopBtn.addEventListener('click', scrollToWishlistItems);

  // Pills (delegated)
  elements.brandPills.addEventListener('click', handleBrandPillClick);

  // Filter drawer
  elements.openFiltersBtn.addEventListener('click', openDrawer);
  elements.closeDrawerBtn.addEventListener('click', closeDrawer);
  elements.drawerScrim.addEventListener('click', closeDrawer);

  elements.searchInput.addEventListener('input', (e) => {
    state.filters.search = e.target.value.trim().toLowerCase();
    renderCatalogAndStats();
    renderActiveFiltersBadge();
  });

  elements.colorSwatches.addEventListener('click', handleColorSwatchClick);

  elements.minPriceFilter.addEventListener('input', (e) => {
    state.filters.minPrice = e.target.value;
    renderCatalogAndStats();
    renderActiveFiltersBadge();
  });
  elements.maxPriceFilter.addEventListener('input', (e) => {
    state.filters.maxPrice = e.target.value;
    renderCatalogAndStats();
    renderActiveFiltersBadge();
  });

  elements.stockFilter.addEventListener('change', (e) => {
    state.filters.stock = e.target.value;
    renderCatalogAndStats();
    renderActiveFiltersBadge();
  });

  elements.clearFiltersButton.addEventListener('click', clearFilters);
  elements.applyFiltersBtn.addEventListener('click', closeDrawer);

  // Catalog grid delegation: wishlist hearts on cards
  elements.catalogGrid.addEventListener('click', handleGridClick);

  // Admin
  elements.productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await addProduct();
  });
  elements.adminTableBody.addEventListener('change', handleAdminTableChange);
  elements.adminTableBody.addEventListener('click', handleAdminTableClick);
  elements.signOutButton.addEventListener('click', async () => { await signOut(); });

  // Login modal
  elements.passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handlePasswordSubmit();
  });
  elements.cancelPasswordButton.addEventListener('click', closePasswordModal);
  elements.magicLinkButton.addEventListener('click', handleMagicLink);

  // Escape cierra modales/drawer
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePasswordModal();
      closeDrawer();
    }
  });
}

function setTopWhatsapp() {
  const msg = encodeURIComponent('Hola, vengo del catalogo de American Vault.');
  elements.topWhatsapp.href = `${WHATSAPP_URL}?text=${msg}`;
}

// ---------- Session / Auth ----------
function applySession(session) {
  state.isAdmin = Boolean(session);
  state.adminEmail = session?.user?.email ?? null;
}

async function handlePasswordSubmit() {
  const email = elements.emailInput.value;
  const password = elements.passwordInput.value;
  elements.passwordMessage.textContent = '';

  try {
    await signInWithPassword(email, password);
    closePasswordModal();
  } catch (error) {
    elements.passwordMessage.textContent =
      error?.message === 'Invalid login credentials'
        ? 'Correo o contrasena incorrectos.'
        : `Error: ${error?.message ?? 'no se pudo iniciar sesion.'}`;
  }
}

async function handleMagicLink() {
  const email = elements.emailInput.value;
  if (!email) {
    elements.passwordMessage.textContent = 'Escribe tu correo primero.';
    return;
  }
  try {
    await sendMagicLink(email);
    elements.passwordMessage.textContent =
      'Te enviamos un enlace magico. Abrelo desde el correo.';
  } catch (error) {
    elements.passwordMessage.textContent =
      `No se pudo enviar el enlace: ${error?.message ?? 'error desconocido'}.`;
  }
}

function handleLockButton() {
  if (state.isAdmin) {
    signOut();
    return;
  }
  elements.passwordMessage.textContent = '';
  elements.emailInput.value = '';
  elements.passwordInput.value = '';
  elements.passwordModal.classList.remove('hidden');
  elements.emailInput.focus();
}

function closePasswordModal() {
  elements.passwordModal.classList.add('hidden');
  elements.passwordMessage.textContent = '';
}

// ---------- Drawer ----------
function openDrawer() {
  elements.drawer.classList.add('is-open');
  elements.drawerScrim.classList.add('is-open');
  elements.drawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  elements.drawer.classList.remove('is-open');
  elements.drawerScrim.classList.remove('is-open');
  elements.drawer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

// ---------- Data ----------
async function loadCatalog() {
  try {
    state.products = await fetchAll();
    state.lastUpdated = new Date().toISOString();
  } catch (error) {
    console.error('Error cargando catalogo:', error);
    state.products = [];
    if (elements.pageCount) {
      elements.pageCount.textContent = 'No se pudo conectar con el catalogo.';
    }
  }
}

function handleRealtimeChange({ event, product }) {
  if (event === 'INSERT') {
    if (!state.products.some((p) => p.id === product.id)) {
      state.products.unshift(product);
    }
  } else if (event === 'UPDATE') {
    const idx = state.products.findIndex((p) => p.id === product.id);
    if (idx >= 0) state.products[idx] = product;
    else state.products.unshift(product);
  } else if (event === 'DELETE') {
    state.products = state.products.filter((p) => p.id !== product.id);
  }
  state.lastUpdated = new Date().toISOString();
  renderBrandPills();
  renderColorSwatches();
  renderAll();
}

// ---------- Rendering ----------
function renderAll() {
  renderLockState();
  renderAdminNotice();
  renderCatalogAndStats();
  renderAdminPanel();
  renderLastUpdated();
  renderActiveFiltersBadge();
}

function renderLockState() {
  const locked = !state.isAdmin;
  elements.lockButton.setAttribute('aria-pressed', String(!locked));
  elements.lockButton.setAttribute(
    'aria-label',
    locked ? 'Abrir modo edicion' : 'Cerrar sesion de administrador'
  );
}

function renderAdminNotice() {
  if (state.isAdmin && state.adminEmail) {
    elements.adminNotice.classList.remove('hidden');
    elements.adminNotice.textContent = `Modo edicion activo · ${state.adminEmail}`;
  } else {
    elements.adminNotice.classList.add('hidden');
  }
}

function renderBrandPills() {
  const brands = [...new Set(state.products.map((p) => p.brand))].sort((a, b) =>
    a.localeCompare(b, 'es', { sensitivity: 'base' })
  );
  const all = [{ value: 'all', label: 'Todas' }, ...brands.map((b) => ({ value: b, label: b }))];
  elements.brandPills.innerHTML = all
    .map((opt) => `
      <button class="pill ${state.filters.brand === opt.value ? 'is-active' : ''}"
              type="button"
              data-brand="${escapeAttribute(opt.value)}">
        ${escapeHtml(opt.label)}
      </button>
    `)
    .join('');
}

function renderColorSwatches() {
  const colors = [...new Set(state.products.map((p) => p.color))].sort((a, b) =>
    a.localeCompare(b, 'es', { sensitivity: 'base' })
  );
  const all = [{ value: 'all', label: 'Todos' }, ...colors.map((c) => ({ value: c, label: c }))];
  elements.colorSwatches.innerHTML = all
    .map((opt) => `
      <button class="swatch ${state.filters.color === opt.value ? 'is-active' : ''}"
              type="button"
              data-color="${escapeAttribute(opt.value)}">
        ${escapeHtml(opt.label)}
      </button>
    `)
    .join('');
}

function handleBrandPillClick(e) {
  const pill = e.target.closest('button.pill');
  if (!pill) return;
  state.filters.brand = pill.dataset.brand;
  renderBrandPills();
  renderCatalogAndStats();
  renderActiveFiltersBadge();
}

function handleColorSwatchClick(e) {
  const sw = e.target.closest('button.swatch');
  if (!sw) return;
  state.filters.color = sw.dataset.color;
  renderColorSwatches();
  renderCatalogAndStats();
  renderActiveFiltersBadge();
}

function renderCatalogAndStats() {
  const filtered = getFilteredProducts();
  const totalAvail = state.products.filter((p) => getStatus(p).className !== 'out').length;
  const visAvail = filtered.filter((p) => getStatus(p).className !== 'out').length;

  if (elements.pageCount) {
    elements.pageCount.textContent =
      `${state.products.length} piezas en catalogo · ${totalAvail} disponibles`;
  }
  if (elements.browsingInfo) {
    elements.browsingInfo.textContent =
      `${filtered.length} de ${state.products.length}${state.filters.stock === 'available' ? ' · solo disponibles' : ''}`;
  }

  if (!filtered.length) {
    elements.catalogGrid.innerHTML = `
      <article class="empty-state">
        <h3>No hay resultados</h3>
        <p>Ajusta la marca, color o el rango de precios.</p>
      </article>
    `;
    return;
  }

  elements.catalogGrid.innerHTML = filtered.map(cardHTML).join('');
}

function cardHTML(product) {
  const status = getStatus(product);
  const isOut = status.className === 'out';
  const waText = encodeURIComponent(
    `Hola, me interesa la *${product.name}* (${product.brand}) — S/${product.price}. ID: ${product.id}`
  );
  const waHref = `${WHATSAPP_URL}?text=${waText}`;
  const liked = state.wishlistLocal.has(product.id);

  return `
    <article class="product-card${isOut ? ' is-out' : ''}" data-id="${escapeAttribute(product.id)}">
      <div class="product-image-wrap">
        <img
          class="product-image"
          src="${escapeAttribute(product.imageUrl)}"
          alt="${escapeAttribute(`Cartera ${product.name}`)}"
          loading="lazy"
          onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'"
        />
        <button class="wishlist-btn${liked ? ' is-active' : ''}" type="button"
                data-action="wishlist"
                data-id="${escapeAttribute(product.id)}"
                aria-pressed="${liked ? 'true' : 'false'}"
                aria-label="${liked ? 'Quitar de wishlist' : 'Agregar a wishlist'}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6C19 16.5 12 21 12 21Z"/>
          </svg>
        </button>
        <span class="status-chip ${status.className}">${status.label}</span>
      </div>

      <div class="product-info">
        <p class="product-brand">${escapeHtml(product.brand)}</p>
        <h3 class="product-title">${escapeHtml(product.name)}</h3>
        <div class="product-price-row">
          <span class="product-price">${formatCurrency(product.price)}</span>
          <span class="product-stock">${isOut ? 'Agotado' : `${product.stock} disp.`}</span>
        </div>
        <a class="wa-button${isOut ? ' wa-disabled' : ''}"
           href="${waHref}"
           target="_blank"
           rel="noopener noreferrer"
           aria-label="Pedir ${escapeAttribute(product.name)} por WhatsApp">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20.52 3.48A11.94 11.94 0 0 0 12.06 0C5.5 0 .14 5.35.14 11.91c0 2.1.55 4.15 1.6 5.96L0 24l6.3-1.66a11.92 11.92 0 0 0 5.76 1.47h.01c6.56 0 11.9-5.35 11.9-11.91 0-3.18-1.24-6.17-3.45-8.42ZM12.07 21.6h-.01a9.66 9.66 0 0 1-4.93-1.35l-.35-.21-3.74.98 1-3.64-.23-.37a9.58 9.58 0 0 1-1.48-5.1c0-5.32 4.34-9.66 9.67-9.66 2.58 0 5.01 1.01 6.84 2.84a9.6 9.6 0 0 1 2.83 6.84c0 5.32-4.33 9.67-9.6 9.67Zm5.32-7.24c-.29-.14-1.73-.85-2-.95-.27-.1-.47-.14-.66.14-.19.29-.76.95-.93 1.14-.17.19-.34.21-.63.07-.29-.14-1.23-.45-2.35-1.45-.87-.77-1.45-1.73-1.62-2.02-.17-.29-.02-.45.13-.59.13-.13.29-.34.43-.51.14-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.07-.14-.66-1.6-.91-2.19-.24-.58-.49-.5-.66-.51h-.57c-.19 0-.5.07-.76.36-.26.29-1 .98-1 2.39s1.02 2.77 1.17 2.96c.14.19 2.01 3.07 4.88 4.3.68.29 1.21.47 1.62.6.68.22 1.3.19 1.79.12.55-.08 1.73-.71 1.97-1.39.24-.68.24-1.27.17-1.39-.07-.12-.27-.19-.56-.34Z"/>
          </svg>
          ${isOut ? 'No disponible' : 'Pedir por WhatsApp'}
        </a>
      </div>
    </article>
  `;
}

function handleGridClick(e) {
  const wishBtn = e.target.closest('[data-action="wishlist"]');
  if (wishBtn) {
    const id = wishBtn.dataset.id;
    if (state.wishlistLocal.has(id)) state.wishlistLocal.delete(id);
    else state.wishlistLocal.add(id);
    localStorage.setItem('av.wishlist', JSON.stringify([...state.wishlistLocal]));
    // Toggle visual solo en ese boton (sin re-render de toda la grilla)
    const isActive = state.wishlistLocal.has(id);
    wishBtn.classList.toggle('is-active', isActive);
    wishBtn.setAttribute('aria-pressed', String(isActive));
    wishBtn.setAttribute('aria-label', isActive ? 'Quitar de wishlist' : 'Agregar a wishlist');
  }
}

function scrollToWishlistItems() {
  if (!state.wishlistLocal.size) {
    alert('Tu wishlist esta vacia. Toca el corazon en una cartera para guardarla.');
    return;
  }
  // Primer item wishlisteado en la grilla actual
  const firstId = [...state.wishlistLocal][0];
  const el = document.querySelector(`.product-card[data-id="${CSS.escape(firstId)}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderAdminPanel() {
  elements.adminPanel.classList.toggle('hidden', !state.isAdmin);
  if (!state.isAdmin) return;
  elements.adminSummary.textContent = `${state.products.length} articulos en catalogo`;
  renderAdminTable();
}

function renderAdminTable() {
  if (!state.products.length) {
    elements.adminTableBody.innerHTML = `<tr><td colspan="7">No hay articulos cargados.</td></tr>`;
    return;
  }
  const rows = [...state.products]
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
    .map((product) => `
        <tr>
          <td><input type="text"   data-id="${escapeAttribute(product.id)}" data-field="name"  value="${escapeAttribute(product.name)}" /></td>
          <td><input type="text"   data-id="${escapeAttribute(product.id)}" data-field="brand" value="${escapeAttribute(product.brand)}" /></td>
          <td><input type="text"   data-id="${escapeAttribute(product.id)}" data-field="color" value="${escapeAttribute(product.color)}" /></td>
          <td><input type="number" min="0" step="0.01" data-id="${escapeAttribute(product.id)}" data-field="price" value="${product.price}" /></td>
          <td><input type="number" min="0" step="1"    data-id="${escapeAttribute(product.id)}" data-field="stock" value="${product.stock}" /></td>
          <td><input type="checkbox" data-id="${escapeAttribute(product.id)}" data-field="available" ${product.available ? 'checked' : ''} /></td>
          <td><button class="delete-inline" type="button" data-action="delete" data-id="${escapeAttribute(product.id)}">Quitar</button></td>
        </tr>
    `)
    .join('');
  elements.adminTableBody.innerHTML = rows;
}

function renderLastUpdated() {
  if (!state.lastUpdated) {
    elements.lastUpdated.textContent = 'Sin actualizaciones aun.';
    return;
  }
  elements.lastUpdated.textContent = `Ultima sincronizacion: ${formatDateTime(state.lastUpdated)}`;
}

function renderActiveFiltersBadge() {
  const f = state.filters;
  let n = 0;
  if (f.search) n++;
  if (f.color !== 'all') n++;
  if (f.minPrice !== '') n++;
  if (f.maxPrice !== '') n++;
  if (f.stock !== 'all') n++;
  // La marca se muestra como pill activa, no la contamos aquí para no duplicar.
  elements.activeFiltersBadge.textContent = String(n);
  elements.activeFiltersBadge.classList.toggle('hidden', n === 0);
}

// ---------- Filtros ----------
function getFilteredProducts() {
  const minPrice = toNumberOrNull(state.filters.minPrice);
  const maxPrice = toNumberOrNull(state.filters.maxPrice);

  return [...state.products]
    .filter((item) => {
      const fullText = `${item.name} ${item.brand} ${item.color}`.toLowerCase();
      if (state.filters.search && !fullText.includes(state.filters.search)) return false;
      if (state.filters.brand !== 'all' && item.brand !== state.filters.brand) return false;
      if (state.filters.color !== 'all' && item.color !== state.filters.color) return false;
      if (minPrice !== null && item.price < minPrice) return false;
      if (maxPrice !== null && item.price > maxPrice) return false;

      const status = getStatus(item);
      if (state.filters.stock === 'available' && status.className === 'out') return false;
      if (state.filters.stock === 'out' && status.className !== 'out') return false;
      return true;
    })
    .sort((a, b) => {
      // Disponibles primero, luego por marca+nombre
      const aOut = getStatus(a).className === 'out';
      const bOut = getStatus(b).className === 'out';
      if (aOut !== bOut) return aOut ? 1 : -1;
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    });
}

function syncFilterInputs() {
  elements.searchInput.value     = state.filters.search;
  elements.minPriceFilter.value  = state.filters.minPrice;
  elements.maxPriceFilter.value  = state.filters.maxPrice;
  elements.stockFilter.value     = state.filters.stock;
}

function clearFilters() {
  state.filters = {
    search: '', brand: 'all', color: 'all',
    minPrice: '', maxPrice: '', stock: 'all'
  };
  elements.searchInput.value     = '';
  elements.minPriceFilter.value  = '';
  elements.maxPriceFilter.value  = '';
  elements.stockFilter.value     = 'all';
  renderBrandPills();
  renderColorSwatches();
  renderCatalogAndStats();
  renderActiveFiltersBadge();
}

// ---------- Admin: create / update / delete ----------
async function addProduct() {
  const formData = new FormData(elements.productForm);
  const name     = sanitizeText(formData.get('name'));
  const brand    = sanitizeText(formData.get('brand'));
  const color    = sanitizeText(formData.get('color'));
  const price    = sanitizePrice(formData.get('price'));
  const stock    = sanitizeStock(formData.get('stock'));
  const imageUrl = sanitizeText(formData.get('imageUrl'));

  if (!name || !brand || !color) {
    alert('Completa nombre, marca y color.');
    return;
  }

  let resolvedUrl = imageUrl && isUrlLike(imageUrl) ? imageUrl : null;
  let resolvedPath = null;

  const file = elements.newImageFile.files?.[0];
  if (file) {
    try {
      const uploaded = await uploadImage(file);
      resolvedUrl  = uploaded.publicUrl;
      resolvedPath = uploaded.path;
    } catch (error) {
      alert(`No se pudo subir la imagen: ${error.message}`);
      return;
    }
  }

  try {
    await createProduct({
      name, brand, color, price, stock,
      available: stock > 0,
      status: stock > 0 ? 'available' : 'sold_out',
      imageUrl: resolvedUrl || FALLBACK_IMAGE,
      imagePath: resolvedPath
    });
    elements.productForm.reset();
  } catch (error) {
    alert(`No se pudo guardar: ${error.message}`);
  }
}

async function handleAdminTableChange(event) {
  const target = event.target;
  const id = target.dataset.id;
  const field = target.dataset.field;
  if (!id || !field) return;

  const product = state.products.find((p) => p.id === id);
  if (!product) return;

  const patch = {};

  if (field === 'name' || field === 'brand' || field === 'color') {
    patch[field] = sanitizeText(target.value);
  } else if (field === 'price') {
    patch.price = sanitizePrice(target.value);
  } else if (field === 'stock') {
    patch.stock = sanitizeStock(target.value);
    patch.available = patch.stock > 0;
    patch.status = patch.stock > 0 ? 'available' : 'sold_out';
  } else if (field === 'available') {
    patch.available = target.checked;
    if (!patch.available) {
      patch.stock = 0;
      patch.status = 'sold_out';
    } else if (product.stock === 0) {
      patch.stock = 1;
      patch.status = 'available';
    }
  }

  try {
    await updateProduct(id, patch);
  } catch (error) {
    alert(`No se pudo actualizar: ${error.message}`);
    await loadCatalog();
    renderAll();
  }
}

async function handleAdminTableClick(event) {
  const button = event.target.closest("button[data-action='delete']");
  if (!button) return;

  const id = button.dataset.id;
  const product = state.products.find((p) => p.id === id);
  if (!product) return;

  const ok = window.confirm(`Deseas eliminar "${product.name}" del catalogo?`);
  if (!ok) return;

  try {
    await deleteProduct(id);
  } catch (error) {
    alert(`No se pudo eliminar: ${error.message}`);
  }
}

// ---------- Helpers ----------
function getStatus(product) {
  if (product.status === 'reserved')                     return { label: 'Reservado',      className: 'reserved' };
  if (!product.available || product.stock === 0)         return { label: 'Agotado',        className: 'out' };
  if (product.stock <= 2)                                return { label: 'Pocas unidades', className: 'low' };
  return { label: 'Disponible', className: 'available' };
}

function sanitizeText(value)  { return String(value ?? '').trim().replace(/\s+/g, ' '); }
function sanitizePrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}
function sanitizeStock(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}
function toNumberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function isUrlLike(value) {
  try {
    const u = new URL(String(value).trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function formatCurrency(value) {
  const hasDec = Math.abs(value % 1) > 0.001;
  return new Intl.NumberFormat('es-PE', {
    style: 'currency', currency: 'PEN',
    minimumFractionDigits: hasDec ? 2 : 0,
    maximumFractionDigits: hasDec ? 2 : 0
  }).format(value);
}
function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium', timeStyle: 'short'
  }).format(d);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttribute(value) { return escapeHtml(value); }
