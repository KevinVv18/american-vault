// ============================================================
// American Vault — app.js (v4, B&W Apple + wishlist server-side)
// - Datos en Supabase (tabla `products`, realtime).
// - Auth en Supabase (email+password, magic link opcional).
// - Imagenes en bucket `carteras`.
// - Wishlist server-side en tabla `wishlist` + notificacion admin.
// ============================================================

import { WHATSAPP_URL, FALLBACK_IMAGE } from './src/config.js';
import {
  fetchAll,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadImage,
  subscribeChanges,
  createWishlistEntry,
  listWishlist,
  markWishlistNotified,
  deleteWishlistEntry,
  subscribeWishlist,
  findMatchesForProduct
} from './src/products.js';
import {
  getSession,
  signInWithPassword,
  sendMagicLink,
  signOut,
  onAuthChange
} from './src/auth.js';

const LS_WISHLIST = 'av.wishlist';

const state = {
  products: [],
  isAdmin: false,
  adminEmail: null,
  lastUpdated: null,
  // Wishlist local del cliente (corazones guardados en localStorage).
  wishlistLocal: new Set(JSON.parse(localStorage.getItem(LS_WISHLIST) || '[]')),
  // Avisos server-side (solo admin los ve).
  wishlistEntries: [],
  wishlistShowNotified: false,
  // Vista admin activa.
  adminView: 'catalog',
  // Contexto del modal "Avisame".
  notifyContext: null,
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
let unsubscribeWishlist = null;

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

  onAuthChange(async (newSession) => {
    const wasAdmin = state.isAdmin;
    applySession(newSession);
    // Enter/exit admin: cargar/descargar wishlist server-side
    if (!wasAdmin && state.isAdmin) {
      await loadWishlistServer();
      subscribeWishlistAdmin();
    } else if (wasAdmin && !state.isAdmin) {
      state.wishlistEntries = [];
      if (unsubscribeWishlist) { unsubscribeWishlist(); unsubscribeWishlist = null; }
    }
    renderAll();
  });

  await loadCatalog();
  subscribeChanges(handleRealtimeChange);

  if (state.isAdmin) {
    await loadWishlistServer();
    subscribeWishlistAdmin();
  }

  renderBrandPills();
  renderColorSwatches();
  syncFilterInputs();
  renderAll();
}

function cacheElements() {
  // Topbar
  elements.lockButton           = document.getElementById('lockButton');
  elements.topWhatsapp          = document.getElementById('topWhatsapp');
  elements.wishlistTopBtn       = document.getElementById('wishlistTopBtn');
  elements.wishlistTopCount     = document.getElementById('wishlistTopCount');
  elements.adminNotice          = document.getElementById('adminNotice');

  // Catalog
  elements.pageCount            = document.getElementById('pageCount');
  elements.brandPills           = document.getElementById('brandPills');
  elements.browsingInfo         = document.getElementById('browsingInfo');
  elements.openFiltersBtn       = document.getElementById('openFiltersBtn');
  elements.activeFiltersBadge   = document.getElementById('activeFiltersBadge');
  elements.catalogGrid          = document.getElementById('catalogGrid');
  elements.lastUpdated          = document.getElementById('lastUpdated');

  // Filter drawer
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

  // Admin
  elements.adminPanel           = document.getElementById('adminPanel');
  elements.adminSummary         = document.getElementById('adminSummary');
  elements.adminTabCatalog      = document.getElementById('adminTabCatalog');
  elements.adminTabWishlist     = document.getElementById('adminTabWishlist');
  elements.adminTabCatalogCount = document.getElementById('adminTabCatalogCount');
  elements.adminTabWishlistCount= document.getElementById('adminTabWishlistCount');
  elements.adminViewCatalog     = document.getElementById('adminViewCatalog');
  elements.adminViewWishlist    = document.getElementById('adminViewWishlist');
  elements.productForm          = document.getElementById('productForm');
  elements.adminTableBody       = document.getElementById('adminTableBody');
  elements.signOutButton        = document.getElementById('signOutButton');
  elements.newImageFile         = document.getElementById('newImageFile');
  elements.wishlistList         = document.getElementById('wishlistList');
  elements.wishlistShowNotified = document.getElementById('wishlistShowNotified');

  // Modals
  elements.passwordModal        = document.getElementById('passwordModal');
  elements.passwordForm         = document.getElementById('passwordForm');
  elements.emailInput           = document.getElementById('emailInput');
  elements.passwordInput        = document.getElementById('passwordInput');
  elements.passwordMessage      = document.getElementById('passwordMessage');
  elements.cancelPasswordButton = document.getElementById('cancelPasswordButton');
  elements.magicLinkButton      = document.getElementById('magicLinkButton');

  elements.notifyModal          = document.getElementById('notifyModal');
  elements.notifyForm           = document.getElementById('notifyForm');
  elements.notifyWhatsapp       = document.getElementById('notifyWhatsapp');
  elements.notifyBrandHint      = document.getElementById('notifyBrandHint');
  elements.notifyMaxPrice       = document.getElementById('notifyMaxPrice');
  elements.notifyNotes          = document.getElementById('notifyNotes');
  elements.notifyMessage        = document.getElementById('notifyMessage');
  elements.cancelNotifyButton   = document.getElementById('cancelNotifyButton');
  elements.notifyProductSummary = document.getElementById('notifyProductSummary');
  elements.notifyProductImg     = document.getElementById('notifyProductImg');
  elements.notifyProductName    = document.getElementById('notifyProductName');
  elements.notifyProductBrand   = document.getElementById('notifyProductBrand');
  elements.notifyProductPrice   = document.getElementById('notifyProductPrice');

  // Wishlist drawer (cliente)
  elements.wishlistDrawer       = document.getElementById('wishlistDrawer');
  elements.wishlistScrim        = document.getElementById('wishlistScrim');
  elements.closeWishlistBtn     = document.getElementById('closeWishlistBtn');
  elements.wishlistClientList   = document.getElementById('wishlistClientList');
  elements.wishlistClearBtn     = document.getElementById('wishlistClearBtn');
  elements.wishlistWhatsappBtn  = document.getElementById('wishlistWhatsappBtn');
}

function bindEvents() {
  // Topbar
  elements.lockButton.addEventListener('click', handleLockButton);
  elements.wishlistTopBtn.addEventListener('click', openWishlistDrawer);

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

  // Catalog grid delegation (hearts + notify-me)
  elements.catalogGrid.addEventListener('click', handleGridClick);

  // Admin
  elements.productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await addProduct();
  });
  elements.adminTableBody.addEventListener('change', handleAdminTableChange);
  elements.adminTableBody.addEventListener('click', handleAdminTableClick);
  elements.signOutButton.addEventListener('click', async () => { await signOut(); });

  // Admin tabs
  elements.adminTabCatalog.addEventListener('click', () => setAdminView('catalog'));
  elements.adminTabWishlist.addEventListener('click', () => setAdminView('wishlist'));
  elements.wishlistShowNotified.addEventListener('change', async (e) => {
    state.wishlistShowNotified = e.target.checked;
    await loadWishlistServer();
    renderWishlistAdmin();
  });
  elements.wishlistList.addEventListener('click', handleWishlistAdminClick);

  // Login modal
  elements.passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handlePasswordSubmit();
  });
  elements.cancelPasswordButton.addEventListener('click', closePasswordModal);
  elements.magicLinkButton.addEventListener('click', handleMagicLink);

  // Notify-me modal
  elements.notifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleNotifySubmit();
  });
  elements.cancelNotifyButton.addEventListener('click', closeNotifyModal);

  // Wishlist drawer (cliente)
  elements.closeWishlistBtn.addEventListener('click', closeWishlistDrawer);
  elements.wishlistScrim.addEventListener('click', closeWishlistDrawer);
  elements.wishlistClientList.addEventListener('click', handleWishlistClientClick);
  elements.wishlistClearBtn.addEventListener('click', clearClientWishlist);
  elements.wishlistWhatsappBtn.addEventListener('click', sendClientWishlistWhatsapp);

  // Escape cierra modales/drawers
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePasswordModal();
      closeNotifyModal();
      closeDrawer();
      closeWishlistDrawer();
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

// ---------- Drawers ----------
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

function openWishlistDrawer() {
  renderClientWishlistDrawer();
  elements.wishlistDrawer.classList.add('is-open');
  elements.wishlistScrim.classList.add('is-open');
  elements.wishlistDrawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeWishlistDrawer() {
  elements.wishlistDrawer.classList.remove('is-open');
  elements.wishlistScrim.classList.remove('is-open');
  elements.wishlistDrawer.setAttribute('aria-hidden', 'true');
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

async function loadWishlistServer() {
  if (!state.isAdmin) return;
  try {
    state.wishlistEntries = await listWishlist({ includeNotified: state.wishlistShowNotified });
  } catch (error) {
    console.error('Error cargando wishlist:', error);
    state.wishlistEntries = [];
  }
}

function subscribeWishlistAdmin() {
  if (unsubscribeWishlist) unsubscribeWishlist();
  unsubscribeWishlist = subscribeWishlist(async ({ event, entry }) => {
    if (event === 'INSERT') {
      // Si es un wish nuevo y no estamos mostrando notified, asegurate de que aparezca.
      if (!entry.notified || state.wishlistShowNotified) {
        if (!state.wishlistEntries.some((w) => w.id === entry.id)) {
          state.wishlistEntries.unshift(entry);
        }
      }
    } else if (event === 'UPDATE') {
      const idx = state.wishlistEntries.findIndex((w) => w.id === entry.id);
      if (idx >= 0) {
        if (!state.wishlistShowNotified && entry.notified) {
          state.wishlistEntries.splice(idx, 1);
        } else {
          state.wishlistEntries[idx] = entry;
        }
      }
    } else if (event === 'DELETE') {
      state.wishlistEntries = state.wishlistEntries.filter((w) => w.id !== entry.id);
    }
    renderWishlistAdmin();
    renderAdminTabs();
  });
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

  // Si soy admin y acaba de llegar/habilitarse un producto, chequear wishlist.
  if (state.isAdmin && (event === 'INSERT' || event === 'UPDATE')) {
    maybeNotifyMatchesFor(product);
  }
}

// ---------- Rendering ----------
function renderAll() {
  renderLockState();
  renderAdminNotice();
  renderCatalogAndStats();
  renderAdminPanel();
  renderLastUpdated();
  renderActiveFiltersBadge();
  renderWishlistTopCount();
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
        ${isOut ? `
          <button class="notify-button" type="button" data-action="notify" data-id="${escapeAttribute(product.id)}">
            <svg viewBox="0 0 24 24" aria-hidden="true" style="fill:none;stroke:currentColor;stroke-width:2;">
              <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0a3 3 0 1 1-6 0"/>
            </svg>
            Avisame cuando llegue
          </button>
        ` : `
          <a class="wa-button"
             href="${waHref}"
             target="_blank"
             rel="noopener noreferrer"
             aria-label="Pedir ${escapeAttribute(product.name)} por WhatsApp">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20.52 3.48A11.94 11.94 0 0 0 12.06 0C5.5 0 .14 5.35.14 11.91c0 2.1.55 4.15 1.6 5.96L0 24l6.3-1.66a11.92 11.92 0 0 0 5.76 1.47h.01c6.56 0 11.9-5.35 11.9-11.91 0-3.18-1.24-6.17-3.45-8.42ZM12.07 21.6h-.01a9.66 9.66 0 0 1-4.93-1.35l-.35-.21-3.74.98 1-3.64-.23-.37a9.58 9.58 0 0 1-1.48-5.1c0-5.32 4.34-9.66 9.67-9.66 2.58 0 5.01 1.01 6.84 2.84a9.6 9.6 0 0 1 2.83 6.84c0 5.32-4.33 9.67-9.6 9.67Zm5.32-7.24c-.29-.14-1.73-.85-2-.95-.27-.1-.47-.14-.66.14-.19.29-.76.95-.93 1.14-.17.19-.34.21-.63.07-.29-.14-1.23-.45-2.35-1.45-.87-.77-1.45-1.73-1.62-2.02-.17-.29-.02-.45.13-.59.13-.13.29-.34.43-.51.14-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.07-.14-.66-1.6-.91-2.19-.24-.58-.49-.5-.66-.51h-.57c-.19 0-.5.07-.76.36-.26.29-1 .98-1 2.39s1.02 2.77 1.17 2.96c.14.19 2.01 3.07 4.88 4.3.68.29 1.21.47 1.62.6.68.22 1.3.19 1.79.12.55-.08 1.73-.71 1.97-1.39.24-.68.24-1.27.17-1.39-.07-.12-.27-.19-.56-.34Z"/>
            </svg>
            Pedir por WhatsApp
          </a>
        `}
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
    localStorage.setItem(LS_WISHLIST, JSON.stringify([...state.wishlistLocal]));
    const isActive = state.wishlistLocal.has(id);
    wishBtn.classList.toggle('is-active', isActive);
    wishBtn.setAttribute('aria-pressed', String(isActive));
    wishBtn.setAttribute('aria-label', isActive ? 'Quitar de wishlist' : 'Agregar a wishlist');
    renderWishlistTopCount();
    return;
  }

  const notifyBtn = e.target.closest('[data-action="notify"]');
  if (notifyBtn) {
    const id = notifyBtn.dataset.id;
    const product = state.products.find((p) => p.id === id);
    openNotifyModal(product);
  }
}

// ---------- Wishlist top bubble + drawer cliente ----------
function renderWishlistTopCount() {
  const n = state.wishlistLocal.size;
  elements.wishlistTopCount.textContent = String(n);
  elements.wishlistTopCount.classList.toggle('hidden', n === 0);
  elements.wishlistTopBtn.setAttribute('aria-pressed', String(n > 0));
}

function renderClientWishlistDrawer() {
  const items = [...state.wishlistLocal]
    .map((id) => state.products.find((p) => p.id === id))
    .filter(Boolean);

  if (!items.length) {
    elements.wishlistClientList.innerHTML = `
      <p class="muted">Tu wishlist esta vacia. Toca el corazon en cualquier cartera para guardarla aqui.</p>
    `;
    elements.wishlistWhatsappBtn.disabled = true;
    elements.wishlistClearBtn.disabled = true;
    return;
  }

  elements.wishlistWhatsappBtn.disabled = false;
  elements.wishlistClearBtn.disabled = false;

  elements.wishlistClientList.innerHTML = items
    .map((p) => `
      <div class="wishlist-client-item" data-id="${escapeAttribute(p.id)}">
        <img src="${escapeAttribute(p.imageUrl)}" alt="" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'"/>
        <div class="info">
          <strong>${escapeHtml(p.name)}</strong>
          <span>${escapeHtml(p.brand)} · ${escapeHtml(p.color)}</span>
          <span class="price">${formatCurrency(p.price)}</span>
        </div>
        <button class="remove" type="button" data-action="remove-wish" data-id="${escapeAttribute(p.id)}" aria-label="Quitar de wishlist">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    `)
    .join('');
}

function handleWishlistClientClick(e) {
  const btn = e.target.closest('[data-action="remove-wish"]');
  if (!btn) return;
  const id = btn.dataset.id;
  state.wishlistLocal.delete(id);
  localStorage.setItem(LS_WISHLIST, JSON.stringify([...state.wishlistLocal]));
  renderClientWishlistDrawer();
  renderWishlistTopCount();
  renderCatalogAndStats();
}

function clearClientWishlist() {
  if (!state.wishlistLocal.size) return;
  if (!confirm('Vaciar toda tu wishlist?')) return;
  state.wishlistLocal.clear();
  localStorage.setItem(LS_WISHLIST, JSON.stringify([]));
  renderClientWishlistDrawer();
  renderWishlistTopCount();
  renderCatalogAndStats();
}

function sendClientWishlistWhatsapp() {
  const items = [...state.wishlistLocal]
    .map((id) => state.products.find((p) => p.id === id))
    .filter(Boolean);
  if (!items.length) return;
  const lines = items.map((p) => `- ${p.name} (${p.brand}) — S/${p.price}`);
  const text = encodeURIComponent(
    `Hola, me interesan estas carteras del catalogo American Vault:\n${lines.join('\n')}`
  );
  window.open(`${WHATSAPP_URL}?text=${text}`, '_blank', 'noopener');
}

// ---------- Notify-me modal (cliente) ----------
function openNotifyModal(product = null) {
  state.notifyContext = product ? { id: product.id, name: product.name, brand: product.brand, price: product.price, imageUrl: product.imageUrl } : null;
  elements.notifyForm.reset();
  elements.notifyMessage.textContent = '';
  elements.notifyMessage.classList.remove('success');

  if (product) {
    elements.notifyProductSummary.classList.remove('hidden');
    elements.notifyProductImg.src = product.imageUrl || FALLBACK_IMAGE;
    elements.notifyProductImg.onerror = () => { elements.notifyProductImg.src = FALLBACK_IMAGE; };
    elements.notifyProductName.textContent = product.name;
    elements.notifyProductBrand.textContent = product.brand;
    elements.notifyProductPrice.textContent = formatCurrency(product.price);
    elements.notifyBrandHint.value = product.brand || '';
    elements.notifyMaxPrice.value = product.price ? Math.ceil(product.price) : '';
  } else {
    elements.notifyProductSummary.classList.add('hidden');
  }

  elements.notifyModal.classList.remove('hidden');
  elements.notifyWhatsapp.focus();
}

function closeNotifyModal() {
  elements.notifyModal.classList.add('hidden');
  elements.notifyMessage.textContent = '';
  elements.notifyMessage.classList.remove('success');
  state.notifyContext = null;
}

async function handleNotifySubmit() {
  const whatsapp = elements.notifyWhatsapp.value.trim();
  const brand    = elements.notifyBrandHint.value.trim();
  const maxPrice = elements.notifyMaxPrice.value;
  const notes    = elements.notifyNotes.value.trim();

  elements.notifyMessage.textContent = '';
  elements.notifyMessage.classList.remove('success');

  if (!whatsapp || whatsapp.replace(/\D+/g, '').length < 6) {
    elements.notifyMessage.textContent = 'Ingresa un numero de WhatsApp valido.';
    return;
  }

  try {
    await createWishlistEntry({
      whatsapp,
      brand: brand || null,
      maxPrice: maxPrice === '' ? null : Number(maxPrice),
      productRef: state.notifyContext?.id || null,
      notes: notes || null
    });
    elements.notifyMessage.classList.add('success');
    elements.notifyMessage.textContent = 'Listo. Te avisaremos por WhatsApp cuando llegue.';
    setTimeout(closeNotifyModal, 1500);
  } catch (error) {
    elements.notifyMessage.textContent = `No se pudo enviar: ${error?.message ?? 'error desconocido'}.`;
  }
}

// ---------- Admin panel ----------
function setAdminView(view) {
  state.adminView = view;
  renderAdminTabs();
  elements.adminViewCatalog.classList.toggle('is-active', view === 'catalog');
  elements.adminViewWishlist.classList.toggle('is-active', view === 'wishlist');
  elements.adminViewCatalog.toggleAttribute('hidden', view !== 'catalog');
  elements.adminViewWishlist.toggleAttribute('hidden', view !== 'wishlist');

  if (view === 'wishlist' && state.isAdmin) {
    renderWishlistAdmin();
  }
}

function renderAdminTabs() {
  elements.adminTabCatalog.classList.toggle('is-active', state.adminView === 'catalog');
  elements.adminTabWishlist.classList.toggle('is-active', state.adminView === 'wishlist');
  elements.adminTabCatalog.setAttribute('aria-selected', String(state.adminView === 'catalog'));
  elements.adminTabWishlist.setAttribute('aria-selected', String(state.adminView === 'wishlist'));
  elements.adminTabCatalogCount.textContent = String(state.products.length);

  const pending = state.wishlistEntries.filter((w) => !w.notified).length;
  const total = state.wishlistEntries.length;
  elements.adminTabWishlistCount.textContent = state.wishlistShowNotified ? String(total) : String(pending);
}

function renderAdminPanel() {
  elements.adminPanel.classList.toggle('hidden', !state.isAdmin);
  if (!state.isAdmin) return;
  elements.adminSummary.textContent = `${state.products.length} articulos · ${state.wishlistEntries.filter((w) => !w.notified).length} avisos pendientes`;
  renderAdminTabs();
  renderAdminTable();
  renderWishlistAdmin();
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

function renderWishlistAdmin() {
  if (!state.isAdmin) return;
  renderAdminTabs();
  elements.wishlistShowNotified.checked = state.wishlistShowNotified;

  if (!state.wishlistEntries.length) {
    elements.wishlistList.innerHTML = `<div class="empty">No hay avisos ${state.wishlistShowNotified ? '' : 'pendientes'}.</div>`;
    return;
  }

  elements.wishlistList.innerHTML = state.wishlistEntries.map((w) => {
    const matches = findMatchesGlobal(w);
    const matchChips = matches.length
      ? `<div class="matches">${matches.slice(0, 6).map((m) => `
          <span class="match-chip is-available" title="${escapeAttribute(m.brand)} · ${escapeAttribute(m.name)}">${escapeHtml(m.brand)} · ${escapeHtml(m.name)}</span>
        `).join('')}</div>`
      : '';

    const whatsappHref = buildAdminOutboundWaHref(w, matches);
    const productLabel = w.productRef
      ? (state.products.find((p) => p.id === w.productRef)?.name ?? 'producto original')
      : 'cualquiera que calce';

    return `
      <article class="wishlist-item${w.notified ? ' is-notified' : ''}" data-id="${escapeAttribute(w.id)}">
        <div class="who">
          <strong>${escapeHtml(w.whatsapp)}</strong>
          <span class="meta">
            ${w.brand ? escapeHtml(w.brand) : 'cualquier marca'}
            ${w.maxPrice != null ? ` · hasta S/${w.maxPrice}` : ''}
            · ${escapeHtml(productLabel)}
          </span>
          ${w.notes ? `<span class="note">"${escapeHtml(w.notes)}"</span>` : ''}
          ${matchChips}
        </div>
        <div class="actions">
          <a class="btn btn-primary" href="${whatsappHref}" target="_blank" rel="noopener noreferrer" data-action="wa" data-id="${escapeAttribute(w.id)}">
            WhatsApp
          </a>
          <button class="btn btn-ghost" type="button" data-action="toggle-notified" data-id="${escapeAttribute(w.id)}">
            ${w.notified ? 'Marcar pendiente' : 'Marcar avisado'}
          </button>
          <button class="btn btn-danger" type="button" data-action="delete-wish" data-id="${escapeAttribute(w.id)}">Eliminar</button>
        </div>
      </article>
    `;
  }).join('');
}

function findMatchesGlobal(wish) {
  // Para cada wish buscamos productos disponibles que calcen (con el mismo criterio que matchesWish pero al reves).
  return state.products.filter((p) => {
    const fake = { ...wish, notified: false };
    // Reusamos el matcher interno expuesto
    return matchesWishHelper(p, fake);
  });
}

// Duplicado local para evitar otro import: usa el mismo criterio que src/products.js.
function matchesWishHelper(product, wish) {
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
  if (!wish.brand && wish.maxPrice == null && !wish.productRef) return false;
  return true;
}

function buildAdminOutboundWaHref(wish, matches) {
  const digits = String(wish.whatsapp).replace(/\D+/g, '');
  // wa.me acepta numeros en formato internacional sin + ni espacios.
  const base = `https://wa.me/${digits}`;
  const firstMatch = matches[0];
  let body;
  if (firstMatch) {
    body = `Hola! Soy de American Vault. Llego una cartera que coincide con lo que pediste: *${firstMatch.name}* (${firstMatch.brand}) por S/${firstMatch.price}. ¿La reservamos?`;
  } else {
    body = `Hola! Soy de American Vault. Tenemos novedades sobre tu pedido. ¿Te paso algunas opciones?`;
  }
  return `${base}?text=${encodeURIComponent(body)}`;
}

async function handleWishlistAdminClick(e) {
  const actionBtn = e.target.closest('[data-action]');
  if (!actionBtn) return;
  const id = actionBtn.dataset.id;
  const action = actionBtn.dataset.action;
  const wish = state.wishlistEntries.find((w) => w.id === id);
  if (!wish) return;

  if (action === 'wa') {
    // Marcar como avisado automaticamente al abrir WhatsApp (no bloquear el link).
    try { await markWishlistNotified(id, true); } catch (err) { console.warn(err); }
    return; // dejamos que el <a> haga su trabajo
  }

  if (action === 'toggle-notified') {
    try {
      await markWishlistNotified(id, !wish.notified);
    } catch (err) {
      alert(`No se pudo actualizar: ${err?.message ?? 'error'}`);
    }
    return;
  }

  if (action === 'delete-wish') {
    if (!confirm(`Eliminar aviso de ${wish.whatsapp}?`)) return;
    try {
      await deleteWishlistEntry(id);
    } catch (err) {
      alert(`No se pudo eliminar: ${err?.message ?? 'error'}`);
    }
  }
}

// Dispara un toast suave cuando llega un producto que calza con algun wish.
function maybeNotifyMatchesFor(product) {
  if (!state.wishlistEntries.length) return;
  const matched = findMatchesForProduct(product, state.wishlistEntries);
  if (!matched.length) return;
  // Aviso en la barra admin — simple, sin depender de librerias.
  const prev = elements.adminNotice.textContent;
  const plural = matched.length === 1 ? 'cliente' : 'clientes';
  elements.adminNotice.classList.remove('hidden');
  elements.adminNotice.innerHTML = `<strong>Match:</strong> ${matched.length} ${plural} esperaban algo como "${escapeHtml(product.name)}". Abre la pestana <strong>Wishlist</strong> para avisarles.`;
  // Volver al mensaje original despues de 12s.
  clearTimeout(maybeNotifyMatchesFor._timer);
  maybeNotifyMatchesFor._timer = setTimeout(() => {
    if (state.isAdmin && state.adminEmail) {
      elements.adminNotice.textContent = `Modo edicion activo · ${state.adminEmail}`;
    } else {
      elements.adminNotice.textContent = prev;
    }
  }, 12000);
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
      homeImageUrl: resolvedUrl || null,
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
