// ============================================================
// American Vault — app.js (v2, Supabase)
// - Datos en Supabase (tabla `products`, realtime).
// - Auth en Supabase (email+password, magic link opcional).
// - Imagenes en bucket `carteras`.
// localStorage ya no se usa para inventario ni password.
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

  // Sesion persistida (si el admin cerro el tab, sigue logueado hasta que expire).
  const session = await getSession();
  applySession(session);

  // Cambios de sesion en vivo (login/logout/expira).
  onAuthChange((newSession) => {
    applySession(newSession);
    renderAll();
  });

  // Carga inicial desde Supabase.
  await loadCatalog();

  // Realtime: cualquier cambio en la tabla se refleja sin recargar.
  subscribeChanges(handleRealtimeChange);

  populateFilterOptions();
  syncFilterInputs();
  renderAll();
}

function cacheElements() {
  elements.lockButton             = document.getElementById('lockButton');
  elements.lockText               = document.getElementById('lockText');
  elements.passwordNotice         = document.getElementById('passwordNotice');
  elements.searchInput            = document.getElementById('searchInput');
  elements.brandFilter            = document.getElementById('brandFilter');
  elements.colorFilter            = document.getElementById('colorFilter');
  elements.minPriceFilter         = document.getElementById('minPriceFilter');
  elements.maxPriceFilter         = document.getElementById('maxPriceFilter');
  elements.stockFilter            = document.getElementById('stockFilter');
  elements.clearFiltersButton     = document.getElementById('clearFiltersButton');
  elements.statsLine              = document.getElementById('statsLine');
  elements.catalogGrid            = document.getElementById('catalogGrid');
  elements.lastUpdated            = document.getElementById('lastUpdated');
  elements.adminPanel             = document.getElementById('adminPanel');
  elements.adminSummary           = document.getElementById('adminSummary');
  elements.productForm            = document.getElementById('productForm');
  elements.adminTableBody         = document.getElementById('adminTableBody');
  elements.signOutButton          = document.getElementById('signOutButton');
  elements.passwordModal          = document.getElementById('passwordModal');
  elements.passwordForm           = document.getElementById('passwordForm');
  elements.emailInput             = document.getElementById('emailInput');
  elements.passwordInput          = document.getElementById('passwordInput');
  elements.passwordMessage        = document.getElementById('passwordMessage');
  elements.cancelPasswordButton   = document.getElementById('cancelPasswordButton');
  elements.magicLinkButton        = document.getElementById('magicLinkButton');
  elements.newImageFile           = document.getElementById('newImageFile');
}

function bindEvents() {
  elements.searchInput.addEventListener('input', (e) => {
    state.filters.search = e.target.value.trim().toLowerCase();
    renderCatalogAndStats();
  });

  elements.brandFilter.addEventListener('change', (e) => {
    state.filters.brand = e.target.value;
    renderCatalogAndStats();
  });

  elements.colorFilter.addEventListener('change', (e) => {
    state.filters.color = e.target.value;
    renderCatalogAndStats();
  });

  elements.minPriceFilter.addEventListener('input', (e) => {
    state.filters.minPrice = e.target.value;
    renderCatalogAndStats();
  });

  elements.maxPriceFilter.addEventListener('input', (e) => {
    state.filters.maxPrice = e.target.value;
    renderCatalogAndStats();
  });

  elements.stockFilter.addEventListener('change', (e) => {
    state.filters.stock = e.target.value;
    renderCatalogAndStats();
  });

  elements.clearFiltersButton.addEventListener('click', clearFilters);

  elements.lockButton.addEventListener('click', handleLockButton);

  elements.passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handlePasswordSubmit();
  });

  elements.cancelPasswordButton.addEventListener('click', closePasswordModal);

  elements.magicLinkButton.addEventListener('click', handleMagicLink);

  elements.productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await addProduct();
  });

  elements.adminTableBody.addEventListener('change', handleAdminTableChange);
  elements.adminTableBody.addEventListener('click', handleAdminTableClick);

  elements.signOutButton.addEventListener('click', async () => {
    await signOut();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePasswordModal();
  });
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

// ---------- Data ----------
async function loadCatalog() {
  try {
    state.products = await fetchAll();
    state.lastUpdated = new Date().toISOString();
  } catch (error) {
    console.error('Error cargando catalogo:', error);
    state.products = [];
    elements.statsLine.textContent = 'No se pudo conectar con el catalogo.';
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
  populateFilterOptions();
  renderAll();
}

// ---------- Rendering ----------
function renderAll() {
  renderLockState();
  renderPasswordNotice();
  renderCatalogAndStats();
  renderAdminPanel();
  renderLastUpdated();
}

function renderLockState() {
  elements.lockText.textContent = state.isAdmin ? 'Edicion activa' : 'Bloqueado';
  elements.lockButton.classList.toggle('unlocked', state.isAdmin);
  elements.lockButton.classList.toggle('locked', !state.isAdmin);
  elements.lockButton.setAttribute(
    'aria-label',
    state.isAdmin ? 'Cerrar sesion de administrador' : 'Abrir modo edicion'
  );
}

function renderPasswordNotice() {
  if (state.isAdmin && state.adminEmail) {
    elements.passwordNotice.classList.remove('hidden');
    elements.passwordNotice.textContent = `Conectado como ${state.adminEmail}.`;
  } else {
    elements.passwordNotice.classList.add('hidden');
    elements.passwordNotice.textContent = '';
  }
}

function renderCatalogAndStats() {
  const filtered = getFilteredProducts();
  const availableVisible = filtered.filter((p) => getStatus(p).className !== 'out').length;

  elements.statsLine.textContent = `${filtered.length} de ${state.products.length} articulos visibles | ${availableVisible} disponibles`;

  if (!filtered.length) {
    elements.catalogGrid.innerHTML = `
      <article class="empty-state">
        <h3>No hay resultados</h3>
        <p>Prueba otro texto o ajusta los filtros de marca, color o precio.</p>
      </article>
    `;
    return;
  }

  elements.catalogGrid.innerHTML = filtered
    .map((product) => {
      const status = getStatus(product);
      const waText = encodeURIComponent(
        `Hola, me interesa la *${product.name}* (${product.brand}) - S/${product.price}. ID: ${product.id}`
      );
      const waHref = `${WHATSAPP_URL}?text=${waText}`;
      const disabledClass = status.className === 'out' ? ' wa-disabled' : '';
      return `
        <article class="product-card">
          <img
            class="product-image"
            src="${escapeAttribute(product.imageUrl)}"
            alt="${escapeAttribute(`Cartera ${product.name}`)}"
            loading="lazy"
            onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'"
          />
          <div class="product-body">
            <p class="status-badge ${status.className}">${status.label}</p>
            <h3 class="product-title">${escapeHtml(product.name)}</h3>
            <div class="product-meta">
              <span>Marca: ${escapeHtml(product.brand)}</span>
              <span>Color: ${escapeHtml(product.color)}</span>
              <span>Unidades: ${product.stock}</span>
            </div>
            <p class="product-price">${formatCurrency(product.price)}</p>
            <a class="wa-button${disabledClass}"
               href="${waHref}"
               target="_blank"
               rel="noopener noreferrer">
              Pedir por WhatsApp
            </a>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderAdminPanel() {
  elements.adminPanel.classList.toggle('hidden', !state.isAdmin);
  if (!state.isAdmin) return;
  elements.adminSummary.textContent = `${state.products.length} articulos`;
  renderAdminTable();
}

function renderAdminTable() {
  if (!state.products.length) {
    elements.adminTableBody.innerHTML = `
      <tr><td colspan="7">No hay articulos cargados.</td></tr>
    `;
    return;
  }

  const rows = [...state.products]
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
    .map((product) => `
        <tr>
          <td><input type="text"   data-id="${escapeAttribute(product.id)}" data-field="name"      value="${escapeAttribute(product.name)}" /></td>
          <td><input type="text"   data-id="${escapeAttribute(product.id)}" data-field="brand"     value="${escapeAttribute(product.brand)}" /></td>
          <td><input type="text"   data-id="${escapeAttribute(product.id)}" data-field="color"     value="${escapeAttribute(product.color)}" /></td>
          <td><input type="number" min="0" step="0.01" data-id="${escapeAttribute(product.id)}" data-field="price" value="${product.price}" /></td>
          <td><input type="number" min="0" step="1"    data-id="${escapeAttribute(product.id)}" data-field="stock" value="${product.stock}" /></td>
          <td><input type="checkbox" data-id="${escapeAttribute(product.id)}" data-field="available" ${product.available ? 'checked' : ''} /></td>
          <td>
            <button class="delete-button" type="button" data-action="delete" data-id="${escapeAttribute(product.id)}">
              Quitar
            </button>
          </td>
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
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

function populateFilterOptions() {
  const brands = [...new Set(state.products.map((p) => p.brand))].sort((a, b) =>
    a.localeCompare(b, 'es', { sensitivity: 'base' })
  );
  const colors = [...new Set(state.products.map((p) => p.color))].sort((a, b) =>
    a.localeCompare(b, 'es', { sensitivity: 'base' })
  );

  elements.brandFilter.innerHTML =
    '<option value="all">Todas</option>' +
    brands.map((b) => `<option value="${escapeAttribute(b)}">${escapeHtml(b)}</option>`).join('');
  elements.brandFilter.value = brands.includes(state.filters.brand) ? state.filters.brand : 'all';
  state.filters.brand = elements.brandFilter.value;

  elements.colorFilter.innerHTML =
    '<option value="all">Todos</option>' +
    colors.map((c) => `<option value="${escapeAttribute(c)}">${escapeHtml(c)}</option>`).join('');
  elements.colorFilter.value = colors.includes(state.filters.color) ? state.filters.color : 'all';
  state.filters.color = elements.colorFilter.value;
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
  elements.brandFilter.value     = 'all';
  elements.colorFilter.value     = 'all';
  elements.minPriceFilter.value  = '';
  elements.maxPriceFilter.value  = '';
  elements.stockFilter.value     = 'all';
  renderCatalogAndStats();
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
