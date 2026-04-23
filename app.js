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
  uploadImages,
  subscribeChanges,
  createWishlistEntry,
  listWishlist,
  markWishlistNotified,
  deleteWishlistEntry,
  subscribeWishlist,
  findMatchesForProduct,
  STYLES,
  STYLE_LABELS,
  isValidStyle
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
    stock: 'all',
    // Multi-select: Set de estilos activos. Set vacio = "todos".
    // Usamos Set (no array) para toggle O(1) y dedup automatico.
    styles: new Set()
  },
  // Galeria del modal de detalle (Fase 3). Se rellena cuando se abre
  // un producto con >1 foto; null cuando esta cerrado.
  detailGallery: {
    images: [],      // URLs ordenadas
    index: 0
  }
};

const elements = {};
let unsubscribeWishlist = null;

// Estado del flujo magic-link: banner global de error + cooldown de reenvio.
const authFlow = {
  pendingError: null,       // { title, detail } cuando el callback trae #error=
  wantsAdminOpen: false,    // true cuando la URL trae ?admin=1
  magicSentTo: null,        // email al que mandamos el ultimo enlace
  resendAt: 0,              // timestamp (ms) desde el cual se puede reenviar
  resendTimer: null
};

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

  // Parsear ?admin=1 y #error=... antes de tocar la sesion; limpia la URL.
  parseAuthCallback();

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

  // Leer ?brand=/?style= de la URL antes de renderizar, asi los pills
  // arrancan con el estado correcto sin un flash de "todo seleccionado".
  readFiltersFromURL();

  renderBrandPills();
  renderStylePills();
  renderColorSwatches();
  syncFilterInputs();
  renderAll();

  // Deep-link ?id=xxx: abrir modal del producto si vino en la URL.
  openDetailFromURL();

  // Si el callback trajo un error, lo mostramos en el modal (reabierto).
  if (authFlow.pendingError) {
    openPasswordModalWithError(authFlow.pendingError);
    authFlow.pendingError = null;
  }
  // Si el callback fue exitoso y ?admin=1 estaba en la URL, lleva al panel.
  if (authFlow.wantsAdminOpen && state.isAdmin) {
    authFlow.wantsAdminOpen = false;
    setTimeout(() => {
      elements.adminPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 180);
  } else if (authFlow.wantsAdminOpen && !state.isAdmin) {
    // Redirigieron con ?admin=1 pero la sesion no cuajo: probablemente
    // Supabase no logro crear la sesion. Mostramos modal para reintentar.
    authFlow.wantsAdminOpen = false;
    openPasswordModalWithError({
      title: 'No pudimos iniciar tu sesion.',
      detail: 'Vuelve a pedir el enlace magico o entra con tu contrasena.'
    });
  }
}

function cacheElements() {
  // Topbar
  elements.lockButton           = document.getElementById('lockButton');
  elements.topWhatsapp          = document.getElementById('topWhatsapp');
  elements.wishlistTopBtn       = document.getElementById('wishlistTopBtn');
  elements.wishlistTopCount     = document.getElementById('wishlistTopCount');
  elements.adminNotice          = document.getElementById('adminNotice');
  elements.flashMessage         = document.getElementById('flashMessage');
  elements.confirmModal         = document.getElementById('confirmModal');

  // Catalog
  elements.pageCount            = document.getElementById('pageCount');
  elements.brandPills           = document.getElementById('brandPills');
  elements.stylePills           = document.getElementById('stylePills');
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
  elements.productFormMessage   = document.getElementById('productFormMessage');
  elements.adminTableBody       = document.getElementById('adminTableBody');
  elements.signOutButton        = document.getElementById('signOutButton');
  elements.newImageFile         = document.getElementById('newImageFile');
  elements.publishBtn           = document.getElementById('publishBtn');
  elements.saveDraftBtn         = document.getElementById('saveDraftBtn');
  elements.photoDrop            = document.getElementById('photoDrop');
  elements.photoDropEmpty       = document.getElementById('photoDropEmpty');
  elements.photoDropPreview     = document.getElementById('photoDropPreview');
  elements.photoPreview         = document.getElementById('photoPreview');
  elements.photoPreviewInfo     = document.getElementById('photoPreviewInfo');
  elements.photoPreviewClear    = document.getElementById('photoPreviewClear');
  elements.photoThumbs          = document.getElementById('photoThumbs');
  elements.newStyle             = document.getElementById('newStyle');
  elements.brandSuggestions     = document.getElementById('brandSuggestions');
  elements.colorSuggestions     = document.getElementById('colorSuggestions');
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

  // Product detail modal (deep-link ?id=)
  elements.detailModal          = document.getElementById('productDetailModal');
  elements.detailCloseBtn       = document.getElementById('detailCloseBtn');
  elements.detailImage          = document.getElementById('detailImage');
  elements.detailMedia          = document.getElementById('detailMedia');
  elements.detailGalPrev        = document.getElementById('detailGalPrev');
  elements.detailGalNext        = document.getElementById('detailGalNext');
  elements.detailGalCounter     = document.getElementById('detailGalCounter');
  elements.detailGalDots        = document.getElementById('detailGalDots');
  elements.detailStatus         = document.getElementById('detailStatus');
  elements.detailBrand          = document.getElementById('detailBrand');
  elements.detailName           = document.getElementById('detailName');
  elements.detailColor          = document.getElementById('detailColor');
  elements.detailStyle          = document.getElementById('detailStyle');
  elements.detailStyleRow       = document.getElementById('detailStyleRow');
  elements.detailPrice          = document.getElementById('detailPrice');
  elements.detailStock          = document.getElementById('detailStock');
  elements.detailWishBtn        = document.getElementById('detailWishBtn');
  elements.detailWishLabel      = document.getElementById('detailWishLabel');
  elements.detailWaBtn          = document.getElementById('detailWaBtn');
  elements.detailShareBtn       = document.getElementById('detailShareBtn');
}

function bindEvents() {
  // Topbar
  elements.lockButton.addEventListener('click', handleLockButton);
  elements.wishlistTopBtn.addEventListener('click', openWishlistDrawer);

  // Flash banner close (delegado: solo hay un boton dentro)
  if (elements.flashMessage) {
    elements.flashMessage.addEventListener('click', (e) => {
      if (e.target.closest('.flash-close')) hideFlash();
    });
  }

  // Pills (delegated)
  elements.brandPills.addEventListener('click', handleBrandPillClick);
  elements.stylePills.addEventListener('click', handleStylePillClick);

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
    await addProduct({ asDraft: false });
  });
  elements.saveDraftBtn.addEventListener('click', async () => {
    await addProduct({ asDraft: true });
  });
  // Foto: comprimir + preview en cuanto se elige archivo (multi-select OK).
  elements.newImageFile.addEventListener('change', handlePhotoChange);
  elements.photoPreviewClear.addEventListener('click', (e) => {
    // El input file cubre la zona completa, asi que "Cambiar" no hace falta
    // para re-elegir foto. Aqui lo usamos como "quitar" para volver al estado
    // vacio (si el usuario no quiere subir imagen).
    e.preventDefault();
    e.stopPropagation();
    resetPhotoDrop();
  });
  // Thumbs: delegacion para "quitar" y drag-reorder (Fase 3).
  elements.photoThumbs.addEventListener('click', handlePhotoThumbClick);
  elements.photoThumbs.addEventListener('dragstart', handlePhotoThumbDragStart);
  elements.photoThumbs.addEventListener('dragover',  handlePhotoThumbDragOver);
  elements.photoThumbs.addEventListener('drop',      handlePhotoThumbDrop);
  elements.photoThumbs.addEventListener('dragend',   handlePhotoThumbDragEnd);
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

  // Product detail modal
  elements.detailCloseBtn.addEventListener('click', closeProductDetail);
  elements.detailWishBtn.addEventListener('click', handleDetailWishToggle);
  elements.detailShareBtn.addEventListener('click', handleDetailShare);

  // Gallery nav (Fase 3): prev/next + dots + swipe touch.
  // Los handlers no-op si el modal no tiene mas de 1 imagen
  // (setDetailSlide valida bounds y la CSS oculta los botones).
  elements.detailGalPrev.addEventListener('click', () => setDetailSlide(state.detailGallery.index - 1));
  elements.detailGalNext.addEventListener('click', () => setDetailSlide(state.detailGallery.index + 1));
  elements.detailGalDots.addEventListener('click', (e) => {
    const dot = e.target.closest('.detail-gal-dot');
    if (!dot) return;
    const i = Number(dot.dataset.index);
    if (!Number.isNaN(i)) setDetailSlide(i);
  });
  // Swipe mobile: threshold de 40px para decidir si es swipe real (no tap).
  bindGallerySwipe(elements.detailMedia);

  // Back del navegador cierra el detalle si esta abierto.
  window.addEventListener('popstate', handlePopState);

  // Escape cierra modales/drawers. Flechas navegan la galeria si el
  // modal de detalle esta abierto (prioridad sobre cualquier otro modal).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!elements.detailModal.classList.contains('hidden')) {
        closeProductDetail();
        return;
      }
      closePasswordModal();
      closeNotifyModal();
      closeDrawer();
      closeWishlistDrawer();
      return;
    }
    // Flechas: solo cuando el modal esta abierto.
    const detailOpen = !elements.detailModal.classList.contains('hidden');
    if (!detailOpen) return;
    if (e.key === 'ArrowLeft') {
      setDetailSlide(state.detailGallery.index - 1);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      setDetailSlide(state.detailGallery.index + 1);
      e.preventDefault();
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
  // Respeta el cooldown: si todavia estamos en ventana de reenvio, ignoramos.
  if (Date.now() < authFlow.resendAt) return;

  const email = elements.emailInput.value;
  if (!email) {
    elements.passwordMessage.classList.remove('success');
    elements.passwordMessage.textContent = 'Escribe tu correo primero.';
    return;
  }

  // Feedback optimista antes de la llamada.
  elements.magicLinkButton.disabled = true;
  elements.passwordMessage.classList.remove('success');
  elements.passwordMessage.textContent = 'Enviando enlace...';

  try {
    await sendMagicLink(email);
    authFlow.magicSentTo = email.trim();
    authFlow.resendAt = Date.now() + 60_000;
    elements.passwordMessage.classList.add('success');
    elements.passwordMessage.innerHTML =
      `Te enviamos un enlace a <strong>${escapeHtml(email)}</strong>. ` +
      `Abrelo desde ese mismo dispositivo (expira en 10 min). ` +
      `Si no aparece, revisa Spam / Promociones.`;
    startResendCooldown();
  } catch (error) {
    elements.magicLinkButton.disabled = false;
    elements.passwordMessage.classList.remove('success');
    elements.passwordMessage.textContent =
      `No se pudo enviar el enlace: ${error?.message ?? 'error desconocido'}.`;
  }
}

function startResendCooldown() {
  if (authFlow.resendTimer) clearInterval(authFlow.resendTimer);
  const baseLabel = 'Prefiero recibir un enlace magico por correo';
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((authFlow.resendAt - Date.now()) / 1000));
    if (remaining <= 0) {
      clearInterval(authFlow.resendTimer);
      authFlow.resendTimer = null;
      if (elements.magicLinkButton) {
        elements.magicLinkButton.disabled = false;
        elements.magicLinkButton.textContent = 'Reenviar enlace magico';
      }
      return;
    }
    if (elements.magicLinkButton) {
      elements.magicLinkButton.disabled = true;
      elements.magicLinkButton.textContent = `Reenviar en ${remaining}s`;
    }
  };
  tick();
  authFlow.resendTimer = setInterval(tick, 1000);
  // Evitamos el valor original asignado en HTML tras el primer tick.
  void baseLabel;
}

function handleLockButton() {
  if (state.isAdmin) {
    signOut();
    return;
  }
  openPasswordModal();
}

function openPasswordModal() {
  elements.passwordMessage.classList.remove('success');
  elements.passwordMessage.textContent = '';
  elements.emailInput.value = '';
  elements.passwordInput.value = '';
  elements.passwordModal.classList.remove('hidden');
  elements.emailInput.focus();
  // Re-aplica cooldown si quedo colgado (p.ej. usuario reabrio el modal).
  if (Date.now() < authFlow.resendAt) startResendCooldown();
  else if (elements.magicLinkButton) {
    elements.magicLinkButton.disabled = false;
    elements.magicLinkButton.textContent = 'Prefiero recibir un enlace magico por correo';
  }
}

function openPasswordModalWithError({ title, detail }) {
  openPasswordModal();
  elements.passwordMessage.classList.remove('success');
  elements.passwordMessage.innerHTML =
    `<strong>${escapeHtml(title)}</strong><br/>${escapeHtml(detail)}`;
  // Si tenemos el correo que uso, pre-llenamos para facilitar el reintento.
  if (authFlow.magicSentTo) {
    elements.emailInput.value = authFlow.magicSentTo;
    elements.passwordInput.focus();
  }
}

function closePasswordModal() {
  elements.passwordModal.classList.add('hidden');
  elements.passwordMessage.textContent = '';
  elements.passwordMessage.classList.remove('success');
}

// Lee hash/query al cargar: extrae error del callback de Supabase y marca
// ?admin=1 para abrir el panel tras confirmar la sesion. Mantiene ?id= si
// viene (se consume luego por abrirDetalleDesdeURL). Limpia lo demas.
function parseAuthCallback() {
  const url = new URL(window.location.href);

  // Supabase devuelve errores como #error=...&error_code=...&error_description=...
  if (url.hash && url.hash.includes('error')) {
    const params = new URLSearchParams(url.hash.slice(1));
    const code = params.get('error_code') || params.get('error') || '';
    const raw = params.get('error_description') || '';
    const detail = raw.replace(/\+/g, ' ');

    let title = 'No pudimos iniciar tu sesion.';
    if (code === 'otp_expired') {
      title = 'El enlace magico expiro.';
    } else if (code === 'access_denied') {
      title = 'El enlace no es valido.';
    }
    authFlow.pendingError = {
      title,
      detail: detail || 'Pide un nuevo enlace o entra con contrasena.'
    };
  }

  // ?admin=1 es nuestra marca post-callback para abrir el panel automaticamente.
  if (url.searchParams.get('admin') === '1') {
    authFlow.wantsAdminOpen = true;
  }

  // Limpia solo los parametros de auth (?admin, #error) — dejamos ?id= para
  // que el deep-link siga disponible y sea compartible si el usuario copia URL.
  const needsClean = url.searchParams.has('admin') || (url.hash && url.hash.includes('error'));
  if (needsClean) {
    url.searchParams.delete('admin');
    const clean = url.origin + url.pathname + (url.search ? url.search : '');
    window.history.replaceState(null, '', clean);
  }
}

// ---------- Flash message (aviso editorial, dead-link recovery) ----------
// Pattern: un solo banner reutilizable. autoDismissMs=0 desactiva el timer.
// role=status en HTML -> lectores de pantalla lo anuncian sin interrumpir.
let flashTimer = null;
function showFlash(message, { autoDismissMs = 6000 } = {}) {
  const el = elements.flashMessage;
  if (!el) return;
  const textEl = el.querySelector('.flash-text');
  if (textEl) textEl.textContent = message;
  el.classList.remove('hidden');
  if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
  if (autoDismissMs > 0) {
    flashTimer = setTimeout(() => hideFlash(), autoDismissMs);
  }
}
function hideFlash() {
  const el = elements.flashMessage;
  if (!el) return;
  el.classList.add('hidden');
  if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
}

// ---------- Confirm dialog (reemplazo branded de window.confirm) ----------
// Promise<boolean>. Resuelve true al confirmar, false al cancelar.
// Keyboard: Escape cancela, Enter confirma. Click en backdrop cancela.
// El foco inicial cae en cancelar (convencion UX para acciones destructivas:
// el default seguro es NO borrar; el usuario debe explicitar click o Enter).
// Si por alguna razon no existe el markup, fallback al confirm() nativo.
function confirmDialog({
  title = '',
  message = '',
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  danger = false
} = {}) {
  return new Promise((resolve) => {
    const el = elements.confirmModal;
    if (!el) { resolve(window.confirm(message || title)); return; }

    const titleEl   = el.querySelector('.confirm-title');
    const msgEl     = el.querySelector('.confirm-message');
    const confirmBtn = el.querySelector('.confirm-ok');
    const cancelBtn  = el.querySelector('.confirm-cancel');
    if (!titleEl || !msgEl || !confirmBtn || !cancelBtn) {
      resolve(window.confirm(message || title));
      return;
    }

    titleEl.textContent = title;
    msgEl.textContent   = message;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent  = cancelText;
    confirmBtn.classList.toggle('is-danger', !!danger);

    // Guardamos el elemento con foco previo para restaurarlo al cerrar
    // (accesibilidad — no dejamos al usuario "flotando" sin foco).
    const prevFocus = document.activeElement;

    el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    // Focus initial: cancelar (default seguro en acciones destructivas).
    // setTimeout para esperar a que el browser reconozca el display:grid
    // despues del remove('hidden'); sin esto focus() puede fallar silencioso.
    setTimeout(() => cancelBtn.focus(), 20);

    function cleanup(result) {
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      el.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      // Restaurar foco al elemento previo si sigue en el DOM.
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch { /* ignore */ }
      }
      resolve(result);
    }
    function onConfirm() { cleanup(true); }
    function onCancel()  { cleanup(false); }
    function onBackdrop(e) {
      // Solo cierra si el click fue directamente en el backdrop, no en el card.
      if (e.target === el) cleanup(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
      else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
    }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    el.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}

// Si la URL trae ?id=xxx y el producto existe, abrimos el modal automaticamente.
// Si no existe (producto eliminado o link compartido viejo), recuperamos la
// experiencia leyendo el param auxiliar ?b= (brand) para sugerir algo similar.
function openDetailFromURL() {
  const url = new URL(window.location.href);
  const id = url.searchParams.get('id');
  if (!id) return;
  const product = state.products.find((p) => p.id === id);
  if (product) {
    openProductDetail(product, { pushHistory: false });
    return;
  }

  // Dead link: limpiamos los params y avisamos al usuario con un toast editorial.
  // Si el link trae &b=<brand>, aplicamos ese filtro para que vea piezas similares
  // de la misma marca en vez de un catalogo generico.
  const brandHint = url.searchParams.get('b');
  url.searchParams.delete('id');
  url.searchParams.delete('b');
  window.history.replaceState(null, '', url.toString());

  if (brandHint && state.products.some((p) => p.brand === brandHint)) {
    state.filters.brand = brandHint;
    renderBrandPills();
    renderCatalogAndStats();
    renderActiveFiltersBadge();
    showFlash(`Esa pieza ya se fue. Te dejamos lo que tenemos en ${brandHint}.`);
  } else {
    showFlash('Esa pieza ya se fue. Mira el catalogo completo abajo.');
  }
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
  renderStylePills();
  renderColorSwatches();
  renderAll();

  // Si el detalle abierto corresponde al producto cambiado, refrescamos;
  // si fue eliminado, cerramos el modal.
  if (detailCurrentId && detailCurrentId === product.id) {
    if (event === 'DELETE') {
      closeProductDetail();
    } else {
      const fresh = state.products.find((p) => p.id === detailCurrentId);
      if (fresh) renderProductDetail(fresh);
    }
  }

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
  syncFiltersToURL();
}

// ---------- Style pills (Fase 3) ----------
// Multi-select: click toggles membership en state.filters.styles (Set).
// La pill "Limpiar" vacia el set. Render se auto-oculta si ningun producto
// tiene un style asignado todavia (admin recien empieza a clasificar).
function renderStylePills() {
  // Contar cuantos productos tienen un style valido. Si es 0, escondemos
  // la nav completa para no mostrar filtros vacios.
  const used = new Set();
  for (const p of state.products) {
    if (isValidStyle(p.style)) used.add(p.style);
  }
  if (used.size === 0) {
    elements.stylePills.classList.add('hidden');
    elements.stylePills.innerHTML = '';
    return;
  }
  elements.stylePills.classList.remove('hidden');

  // Mostrar solo los estilos que tienen al menos 1 producto — no queremos
  // ofrecer "Clutch" como filtro si no hay ningun clutch en catalogo.
  // Orden: el orden canonico definido en STYLES (no alfabetico) para que
  // la UI sea estable aun cuando cambia el stock.
  const active = state.filters.styles;
  const pills = STYLES
    .filter((s) => used.has(s))
    .map((s) => {
      const isActive = active.has(s);
      return `
        <button class="pill ${isActive ? 'is-active' : ''}"
                type="button"
                data-style="${escapeAttribute(s)}"
                aria-pressed="${isActive ? 'true' : 'false'}">
          ${escapeHtml(STYLE_LABELS[s] || s)}
        </button>
      `;
    })
    .join('');

  // Pill "limpiar": solo visible cuando hay >=1 estilo activo.
  const clearBtn = active.size > 0
    ? `<button class="pill is-clear" type="button" data-style="__clear__">Limpiar</button>`
    : '';

  elements.stylePills.innerHTML = pills + clearBtn;
}

function handleStylePillClick(e) {
  const pill = e.target.closest('button.pill');
  if (!pill) return;
  const style = pill.dataset.style;
  const active = state.filters.styles;

  if (style === '__clear__') {
    active.clear();
  } else if (isValidStyle(style)) {
    if (active.has(style)) active.delete(style);
    else active.add(style);
  } else {
    return;
  }

  renderStylePills();
  renderCatalogAndStats();
  renderActiveFiltersBadge();
  syncFiltersToURL();
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

  // Notifica al hero (y otros) que el count real del catalogo esta listo.
  // El hero lo usa para el count-up bajo el CTA del acto 3. Pasa tanto total
  // como disponibles para que el listener decida cual mostrar.
  // window.__avCatalog actua como "ultimo valor conocido" para listeners que
  // se registren DESPUES del primer dispatch (evita la race app.js vs hero.js).
  const countDetail = { total: state.products.length, available: totalAvail };
  window.__avCatalog = countDetail;
  document.dispatchEvent(new CustomEvent('av:catalog-count', { detail: countDetail }));
  if (elements.browsingInfo) {
    elements.browsingInfo.textContent =
      `${filtered.length} de ${state.products.length}${state.filters.stock === 'available' ? ' · solo disponibles' : ''}`;
  }

  if (!filtered.length) {
    // Empty state editorial con lead capture. Monograma "AV" muteado como
    // marca-agua + copy que convierte el dead-end en oportunidad: "avisame
    // cuando llegue algo parecido" pre-lleva los filtros activos al modal.
    // data-action sirve para que el wiring del click funcione via
    // event delegation (no re-bindeamos en cada render).
    elements.catalogGrid.innerHTML = `
      <article class="empty-state">
        <svg class="empty-mark" viewBox="0 0 100 100" aria-hidden="true"
             fill="none" stroke="currentColor" stroke-width="1.6"
             stroke-linecap="square" stroke-linejoin="miter">
          <line x1="35" y1="10" x2="75" y2="90"/>
          <line x1="25" y1="90" x2="50" y2="40"/>
          <line x1="75" y1="10" x2="50" y2="40"/>
          <line x1="36" y1="68" x2="64" y2="68"/>
        </svg>
        <h3>Nada calza con tu busqueda.</h3>
        <p>Dejanos tu WhatsApp y te avisamos en cuanto llegue una pieza que calce con lo que estas buscando.</p>
        <button class="btn btn-primary" type="button" data-action="notify-from-filters">
          Avisame cuando llegue
        </button>
      </article>
    `;
    return;
  }

  // Pasamos el indice al cardHTML: los primeros ~6 items son LCP candidates
  // en desktop (arriba del fold), asi que reciben fetchpriority=high + eager.
  elements.catalogGrid.innerHTML = filtered.map((p, i) => cardHTML(p, i)).join('');
}

function cardHTML(product, index = 99) {
  const status = getStatus(product);
  const isOut = status.className === 'out';
  // Deep-link al producto para que el cliente llegue al mismo item desde WA.
  // Incluye &b=<brand> como fallback: si el producto ya no existe (vendido,
  // eliminado), openDetailFromURL filtra el catalogo por esa marca y muestra
  // un toast "esa pieza ya se fue, mira estas" — recuperamos intencion de
  // compra en vez de mostrar un vacio inexplicable.
  const deepLink = `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(product.id)}&b=${encodeURIComponent(product.brand)}`;
  const waText = encodeURIComponent(
    `Hola, me interesa la *${product.name}* (${product.brand}) — S/${product.price}. Link: ${deepLink}`
  );
  const waHref = `${WHATSAPP_URL}?text=${waText}`;
  const liked = state.wishlistLocal.has(product.id);

  // Imagen responsiva: srcset con 4 widths via Supabase transforms.
  // Los primeros 6 items (fold desktop) son LCP candidates: eager + high prio.
  // Resto: lazy + auto prio. Width/height explicitos => aspect-ratio estable,
  // cero CLS al montar el grid.
  const img = buildImageSources(product.imageUrl);
  const isAboveFold = index < 6;
  const loadingAttr = isAboveFold ? 'eager' : 'lazy';
  const fetchPrioAttr = isAboveFold ? 'high' : 'auto';
  const srcsetAttr = img.srcset ? ` srcset="${escapeAttribute(img.srcset)}"` : '';
  const sizesAttr  = img.sizes  ? ` sizes="${escapeAttribute(img.sizes)}"`   : '';

  return `
    <article class="product-card${isOut ? ' is-out' : ''}" data-id="${escapeAttribute(product.id)}">
      <div class="product-image-wrap">
        <img
          class="product-image"
          src="${escapeAttribute(img.src)}"${srcsetAttr}${sizesAttr}
          width="600" height="800"
          alt="${escapeAttribute(`Cartera ${product.name}`)}"
          loading="${loadingAttr}"
          decoding="async"
          fetchpriority="${fetchPrioAttr}"
          onerror="this.onerror=null;this.srcset='';this.src='${FALLBACK_IMAGE}'"
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
            <span class="wa-label-full">Pedir por WhatsApp</span>
            <span class="wa-label-short">Pedir</span>
          </a>
        `}
      </div>
    </article>
  `;
}

function handleGridClick(e) {
  const wishBtn = e.target.closest('[data-action="wishlist"]');
  if (wishBtn) {
    e.stopPropagation();
    const id = wishBtn.dataset.id;
    toggleWishlistLocal(id);
    const isActive = state.wishlistLocal.has(id);
    wishBtn.classList.toggle('is-active', isActive);
    wishBtn.setAttribute('aria-pressed', String(isActive));
    wishBtn.setAttribute('aria-label', isActive ? 'Quitar de wishlist' : 'Agregar a wishlist');
    return;
  }

  const notifyBtn = e.target.closest('[data-action="notify"]');
  if (notifyBtn) {
    e.stopPropagation();
    const id = notifyBtn.dataset.id;
    const product = state.products.find((p) => p.id === id);
    openNotifyModal(product);
    return;
  }

  // Lead capture desde empty state: abre el notify modal pre-llenado con
  // los filtros activos (ver openNotifyModal(null) para el pre-fill).
  const notifyFromFilters = e.target.closest('[data-action="notify-from-filters"]');
  if (notifyFromFilters) {
    e.stopPropagation();
    openNotifyModal(null);
    return;
  }

  // Click en "Pedir por WhatsApp" usa su propio href; solo lo dejamos pasar.
  if (e.target.closest('.wa-button')) return;

  // Cualquier otra zona de la card abre el detalle.
  const card = e.target.closest('.product-card');
  if (!card) return;
  const id = card.dataset.id;
  const product = state.products.find((p) => p.id === id);
  if (product) openProductDetail(product, { pushHistory: true });
}

function toggleWishlistLocal(id) {
  if (state.wishlistLocal.has(id)) state.wishlistLocal.delete(id);
  else state.wishlistLocal.add(id);
  localStorage.setItem(LS_WISHLIST, JSON.stringify([...state.wishlistLocal]));
  renderWishlistTopCount();
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
    .map((p) => {
      // Thumbnails en el drawer: 400w basta (columna angosta, off-viewport al inicio).
      const thumb = buildImageSources(p.imageUrl, { sizes: '96px' });
      const thumbSrcset = thumb.srcset ? ` srcset="${escapeAttribute(thumb.srcset)}"` : '';
      const thumbSizes  = thumb.sizes  ? ` sizes="${escapeAttribute(thumb.sizes)}"`   : '';
      return `
      <div class="wishlist-client-item" data-id="${escapeAttribute(p.id)}">
        <img src="${escapeAttribute(thumb.src)}"${thumbSrcset}${thumbSizes} alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.srcset='';this.src='${FALLBACK_IMAGE}'"/>
        <div class="info">
          <strong>${escapeHtml(p.name)}</strong>
          <span>${escapeHtml(p.brand)} · ${escapeHtml(p.color)}</span>
          <span class="price">${formatCurrency(p.price)}</span>
        </div>
        <button class="remove" type="button" data-action="remove-wish" data-id="${escapeAttribute(p.id)}" aria-label="Quitar de wishlist">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
    `;
    })
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

async function clearClientWishlist() {
  if (!state.wishlistLocal.size) return;
  const ok = await confirmDialog({
    title: 'Vaciar tu wishlist?',
    message: 'Se quitan todas las piezas que tenias guardadas. Esta accion no se puede deshacer.',
    confirmText: 'Vaciar',
    cancelText: 'Cancelar',
    danger: true
  });
  if (!ok) return;
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
  const origin = `${window.location.origin}${window.location.pathname}`;
  const lines = items.map((p) =>
    // &b= permite recuperar la experiencia si el producto murio (openDetailFromURL
    // filtra por marca y muestra toast cuando el id no resuelve).
    `- ${p.name} (${p.brand}) — S/${p.price}\n  ${origin}?id=${encodeURIComponent(p.id)}&b=${encodeURIComponent(p.brand)}`
  );
  const text = encodeURIComponent(
    `Hola, me interesan estas carteras del catalogo American Vault:\n${lines.join('\n')}`
  );
  window.open(`${WHATSAPP_URL}?text=${text}`, '_blank', 'noopener');
}

// ---------- Product detail modal (deep-link ?id=) -----------
// Abre la ficha del producto a pantalla completa y empuja ?id= al history.
// Si el producto cambia por realtime mientras el modal esta abierto, lo
// re-renderizamos para mantener stock/precio sincronizados.
let detailCurrentId = null;

const BASE_TITLE = document.title;

function openProductDetail(product, { pushHistory = true } = {}) {
  if (!product) return;
  detailCurrentId = product.id;
  renderProductDetail(product);
  elements.detailModal.classList.remove('hidden');
  elements.detailModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('detail-open');

  // Title del tab dinamico — ayuda en multi-pestana y al compartir.
  // (WhatsApp/OG no leen JS, pero el title es util para Chrome tabs,
  // bookmarks, historial.)
  document.title = `${product.brand} — ${product.name} · American Vault`;

  // Push al history solo si no venimos de un popstate (evita duplicar).
  if (pushHistory) {
    const url = new URL(window.location.href);
    url.searchParams.set('id', product.id);
    window.history.pushState({ detailId: product.id }, '', url.toString());
  }
}

function closeProductDetail({ popHistory = true } = {}) {
  if (detailCurrentId === null) return;
  detailCurrentId = null;
  elements.detailModal.classList.add('hidden');
  elements.detailModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('detail-open');
  document.title = BASE_TITLE;

  if (popHistory) {
    const url = new URL(window.location.href);
    if (url.searchParams.has('id')) {
      url.searchParams.delete('id');
      window.history.pushState(null, '', url.toString());
    }
  }
}

function renderProductDetail(product) {
  const status = getStatus(product);
  const isOut = status.className === 'out';
  const liked = state.wishlistLocal.has(product.id);

  // Galeria Fase 3: product.images[] es la fuente. Si esta vacio (legacy),
  // caemos al unico imageUrl. Dedupe por URL para evitar mostrar la misma
  // foto dos veces cuando images[0] === imageUrl (caso comun pre-migracion).
  const gallery = Array.isArray(product.images) && product.images.length > 0
    ? [...new Set(product.images.filter(Boolean))]
    : [product.imageUrl || FALLBACK_IMAGE];

  state.detailGallery.images = gallery;
  state.detailGallery.index = 0;
  state.detailGallery.alt = `Cartera ${product.name}`;

  // Data attr para que CSS oculte nav/dots cuando hay 1 sola foto.
  elements.detailMedia.dataset.count = String(gallery.length);
  elements.detailMedia.dataset.index = '0';

  // Pintar dots + counter + primera slide.
  renderDetailGalleryUI();
  setDetailSlide(0, { instant: true });

  // Status inline: solo lo mostramos cuando aporta info (low/out/reserved).
  // Para 'available' el stock del spec row ya lo dice; esconderlo evita ruido.
  if (status.className === 'available') {
    elements.detailStatus.hidden = true;
  } else {
    elements.detailStatus.hidden = false;
    elements.detailStatus.dataset.state = status.className;
    elements.detailStatus.textContent = status.label;
  }

  elements.detailBrand.textContent = product.brand;
  elements.detailName.textContent = product.name;
  elements.detailColor.textContent = product.color || '—';

  // Estilo (Fase 3): fila visible solo cuando el producto esta clasificado.
  if (isValidStyle(product.style)) {
    elements.detailStyle.textContent = STYLE_LABELS[product.style] || product.style;
    elements.detailStyleRow.hidden = false;
  } else {
    elements.detailStyleRow.hidden = true;
  }

  elements.detailPrice.textContent = formatCurrency(product.price);
  elements.detailPrice.classList.add('price');
  elements.detailStock.textContent = isOut ? 'Agotado' : `${product.stock} disponibles`;

  // Wishlist button refleja el estado actual.
  elements.detailWishBtn.classList.toggle('is-active', liked);
  elements.detailWishLabel.textContent = liked ? 'Guardado en wishlist' : 'Guardar en wishlist';

  // WhatsApp: link con deep-link al catalogo, NO con UUID crudo.
  // &b=<brand> es un fallback: si el producto desaparece, openDetailFromURL
  // aplica el filtro de marca y muestra un toast editorial en lugar de vacio.
  const deepLink = `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(product.id)}&b=${encodeURIComponent(product.brand)}`;
  let msg;
  if (isOut) {
    msg = `Hola, me interesa reservar la *${product.name}* (${product.brand}). Precio referencial S/${product.price}. Link: ${deepLink}`;
  } else {
    msg = `Hola, me interesa la *${product.name}* (${product.brand}) — S/${product.price}. Link: ${deepLink}`;
  }
  elements.detailWaBtn.href = `${WHATSAPP_URL}?text=${encodeURIComponent(msg)}`;
  elements.detailWaBtn.textContent = isOut ? 'Preguntar por disponibilidad' : 'Pedir por WhatsApp';

  // Share nativo: solo mostrar si el navegador lo soporta.
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    elements.detailShareBtn.classList.remove('hidden');
  } else {
    elements.detailShareBtn.classList.add('hidden');
  }
}

function handleDetailWishToggle() {
  if (!detailCurrentId) return;
  toggleWishlistLocal(detailCurrentId);
  const liked = state.wishlistLocal.has(detailCurrentId);
  elements.detailWishBtn.classList.toggle('is-active', liked);
  elements.detailWishLabel.textContent = liked ? 'Guardado en wishlist' : 'Guardar en wishlist';
  // Repintar las cards para que el corazon se actualice tambien.
  renderCatalogAndStats();
}

// ---------- Detail gallery (Fase 3) ----------
// Renderiza dots + counter basados en el state.detailGallery actual.
function renderDetailGalleryUI() {
  const { images, index } = state.detailGallery;
  const total = images.length;

  // Counter "2 / 3" — accesible via aria-live en caso de cambios via teclado.
  if (elements.detailGalCounter) {
    elements.detailGalCounter.textContent = total > 1 ? `${index + 1} / ${total}` : '';
  }

  // Dots — uno por foto, el activo con .is-active (widening + full ink).
  if (elements.detailGalDots) {
    if (total <= 1) {
      elements.detailGalDots.innerHTML = '';
    } else {
      elements.detailGalDots.innerHTML = images
        .map((_, i) => `
          <button type="button"
                  class="detail-gal-dot ${i === index ? 'is-active' : ''}"
                  data-index="${i}"
                  role="tab"
                  aria-selected="${i === index ? 'true' : 'false'}"
                  aria-label="Foto ${i + 1} de ${total}"></button>
        `).join('');
    }
  }
}

// Cambia el slide activo. Valida bounds; si el index esta fuera no hace nada.
// opts.instant = true saltea el fade (para el open inicial del modal).
function setDetailSlide(nextIndex, { instant = false } = {}) {
  const { images } = state.detailGallery;
  const total = images.length;
  if (total === 0) return;
  // Clamp: no wrap-around en galerias pequenas (2-3 fotos) — el usuario
  // espera que la flecha se sienta "apagada" en el borde, no que salte.
  // Si mas adelante queremos wrap, este es el lugar para cambiarlo.
  const clamped = Math.max(0, Math.min(total - 1, nextIndex));
  if (clamped === state.detailGallery.index && !instant) return;

  state.detailGallery.index = clamped;
  elements.detailMedia.dataset.index = String(clamped);

  const nextUrl = images[clamped];
  const img = elements.detailImage;

  const swap = () => {
    const sources = buildImageSources(nextUrl || FALLBACK_IMAGE, {
      sizes: '(max-width: 900px) 100vw, 50vw'
    });
    img.src = sources.src;
    if (sources.srcset) {
      img.setAttribute('srcset', sources.srcset);
      img.setAttribute('sizes', sources.sizes);
    } else {
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
    }
    img.decoding = 'async';
    img.onerror = () => {
      img.removeAttribute('srcset');
      img.src = FALLBACK_IMAGE;
    };
    img.alt = state.detailGallery.alt || '';
  };

  if (instant) {
    swap();
    img.classList.remove('is-loading');
  } else {
    // Fade out → swap → fade in. onload para esperar el decode real.
    img.classList.add('is-loading');
    img.addEventListener('load', () => img.classList.remove('is-loading'), { once: true });
    // Si la imagen esta cacheada, onload puede no disparar en algunos
    // navegadores — quitamos la clase tambien despues de un tick.
    setTimeout(() => img.classList.remove('is-loading'), 260);
    swap();
  }

  renderDetailGalleryUI();
}

// Swipe en mobile: touchstart captura punto inicial, touchend mide delta.
// Threshold 40px para no gatillar accidentalmente al hacer scroll vertical.
function bindGallerySwipe(container) {
  if (!container || typeof window === 'undefined') return;
  let startX = 0, startY = 0, active = false;
  const THRESHOLD = 40;

  container.addEventListener('touchstart', (e) => {
    if (state.detailGallery.images.length <= 1) return;
    const t = e.changedTouches?.[0];
    if (!t) return;
    startX = t.clientX;
    startY = t.clientY;
    active = true;
  }, { passive: true });

  container.addEventListener('touchend', (e) => {
    if (!active) return;
    active = false;
    const t = e.changedTouches?.[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    // Ignorar si el gesto fue mas vertical que horizontal (scroll, no swipe).
    if (Math.abs(dy) > Math.abs(dx)) return;
    if (Math.abs(dx) < THRESHOLD) return;
    if (dx < 0) setDetailSlide(state.detailGallery.index + 1);
    else        setDetailSlide(state.detailGallery.index - 1);
  }, { passive: true });
}

async function handleDetailShare() {
  if (!detailCurrentId) return;
  const product = state.products.find((p) => p.id === detailCurrentId);
  if (!product) return;

  // &b=<brand> = fallback para cuando el id muere (ver openDetailFromURL).
  const deepLink = `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(product.id)}&b=${encodeURIComponent(product.brand)}`;
  const baseShare = {
    title: `${product.brand} — ${product.name}`,
    text: `${product.name} (${product.brand}) — S/${product.price}`,
    url: deepLink
  };

  // Intento 1: share con la imagen como archivo (soportado en iOS 15+,
  // Android Chrome moderno). Asi el contacto recibe la foto directamente
  // ademas del link, util para WhatsApp / mensajes.
  try {
    if (product.imageUrl && typeof navigator.canShare === 'function') {
      const res = await fetch(product.imageUrl, { mode: 'cors' });
      if (res.ok) {
        const blob = await res.blob();
        const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        const name = `${slug(product.brand)}-${slug(product.name)}.${ext}`;
        const file = new File([blob], name, { type: blob.type });
        const withFile = { ...baseShare, files: [file] };
        if (navigator.canShare(withFile)) {
          await navigator.share(withFile);
          return;
        }
      }
    }
  } catch (err) {
    console.warn('Share con imagen fallo, intentando solo URL:', err);
  }

  // Intento 2: share basico (solo texto + url).
  try {
    if (navigator.share) {
      await navigator.share(baseShare);
      return;
    }
  } catch (err) {
    if (err?.name !== 'AbortError') console.warn('Share cancelado:', err);
    return;
  }

  // Fallback final: copiar el link al portapapeles.
  try {
    await navigator.clipboard?.writeText(deepLink);
  } catch { /* silencio */ }
}

function slug(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'item';
}

function handlePopState(event) {
  // Al navegar back/forward, sincronizar el modal con ?id= de la URL.
  const url = new URL(window.location.href);
  const id = url.searchParams.get('id');
  if (id) {
    const product = state.products.find((p) => p.id === id);
    if (product) {
      openProductDetail(product, { pushHistory: false });
    } else {
      closeProductDetail({ popHistory: false });
    }
  } else {
    closeProductDetail({ popHistory: false });
  }
}

// ---------- Notify-me modal (cliente) ----------
function openNotifyModal(product = null) {
  state.notifyContext = product ? { id: product.id, name: product.name, brand: product.brand, price: product.price, imageUrl: product.imageUrl } : null;
  elements.notifyForm.reset();
  elements.notifyMessage.textContent = '';
  elements.notifyMessage.classList.remove('success');

  if (product) {
    elements.notifyProductSummary.classList.remove('hidden');
    // Thumbnail del notify modal: 400w basta (preview pequeno).
    const notifyImg = buildImageSources(product.imageUrl || FALLBACK_IMAGE, { sizes: '120px' });
    elements.notifyProductImg.src = notifyImg.src;
    if (notifyImg.srcset) {
      elements.notifyProductImg.setAttribute('srcset', notifyImg.srcset);
      elements.notifyProductImg.setAttribute('sizes', notifyImg.sizes);
    } else {
      elements.notifyProductImg.removeAttribute('srcset');
      elements.notifyProductImg.removeAttribute('sizes');
    }
    elements.notifyProductImg.decoding = 'async';
    elements.notifyProductImg.onerror = () => {
      elements.notifyProductImg.removeAttribute('srcset');
      elements.notifyProductImg.src = FALLBACK_IMAGE;
    };
    elements.notifyProductName.textContent = product.name;
    elements.notifyProductBrand.textContent = product.brand;
    elements.notifyProductPrice.textContent = formatCurrency(product.price);
    elements.notifyBrandHint.value = product.brand || '';
    elements.notifyMaxPrice.value = product.price ? Math.ceil(product.price) : '';
  } else {
    elements.notifyProductSummary.classList.add('hidden');
    // Sin producto especifico: si el usuario abre el modal desde el empty
    // state con filtros activos, pre-llenamos brand/maxPrice para ahorrar
    // tipeo. 'all' significa "sin filtro" — lo ignoramos.
    const fb = state.filters || {};
    if (fb.brand && fb.brand !== 'all') elements.notifyBrandHint.value = fb.brand;
    const maxFilter = toNumberOrNull(fb.maxPrice);
    if (maxFilter) elements.notifyMaxPrice.value = String(maxFilter);
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
  renderAdminSuggestions();
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
    const ok = await confirmDialog({
      title: 'Eliminar aviso?',
      message: `Quitas el aviso de ${wish.whatsapp}. Si vuelven a llenar el formulario, entra de nuevo.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      danger: true
    });
    if (!ok) return;
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
  if (f.styles && f.styles.size > 0) n += f.styles.size;
  elements.activeFiltersBadge.textContent = String(n);
  elements.activeFiltersBadge.classList.toggle('hidden', n === 0);
}

// ---------- Filtros ----------
function getFilteredProducts() {
  const minPrice = toNumberOrNull(state.filters.minPrice);
  const maxPrice = toNumberOrNull(state.filters.maxPrice);
  const styles = state.filters.styles; // Set

  return [...state.products]
    .filter((item) => {
      const fullText = `${item.name} ${item.brand} ${item.color}`.toLowerCase();
      if (state.filters.search && !fullText.includes(state.filters.search)) return false;
      if (state.filters.brand !== 'all' && item.brand !== state.filters.brand) return false;
      if (state.filters.color !== 'all' && item.color !== state.filters.color) return false;
      // Style filter (Fase 3): si hay >=1 style activo, el producto debe
      // tener un style valido que este en el Set. Productos sin style (null)
      // no aparecen cuando hay filtro activo — forzando al admin a clasificar
      // para que reaparezcan en busquedas especificas.
      if (styles && styles.size > 0) {
        if (!item.style || !styles.has(item.style)) return false;
      }
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

// ---------- URL sync de filtros (Fase 3) ----------
// Mantiene ?brand= y ?style= en la URL actual para que:
//   - el usuario pueda compartir el link de un filtrado especifico
//   - el back del navegador recupere el estado anterior
// Nota: ?id=<product> se maneja aparte (openProductDetail/openDetailFromURL),
// asi que aqui solo tocamos brand/style y preservamos lo demas.
function syncFiltersToURL() {
  const url = new URL(window.location.href);
  // brand
  if (state.filters.brand && state.filters.brand !== 'all') {
    url.searchParams.set('brand', state.filters.brand);
  } else {
    url.searchParams.delete('brand');
  }
  // style (csv)
  if (state.filters.styles && state.filters.styles.size > 0) {
    url.searchParams.set('style', [...state.filters.styles].join(','));
  } else {
    url.searchParams.delete('style');
  }
  window.history.replaceState(null, '', url.toString());
}

function readFiltersFromURL() {
  const url = new URL(window.location.href);
  const brand = url.searchParams.get('brand');
  if (brand && state.products.some((p) => p.brand === brand)) {
    state.filters.brand = brand;
  }
  const style = url.searchParams.get('style');
  if (style) {
    const wanted = style.split(',').map((s) => s.trim()).filter(isValidStyle);
    state.filters.styles = new Set(wanted);
  }
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
    minPrice: '', maxPrice: '', stock: 'all',
    styles: new Set()
  };
  elements.searchInput.value     = '';
  elements.minPriceFilter.value  = '';
  elements.maxPriceFilter.value  = '';
  elements.stockFilter.value     = 'all';
  renderBrandPills();
  renderStylePills();
  renderColorSwatches();
  renderCatalogAndStats();
  renderActiveFiltersBadge();
  syncFiltersToURL();
}

// ---------- Admin: create / update / delete ----------
// Galeria en construccion (Fase 3): items paralelos { file, previewUrl, origSize }.
// El orden del array = orden en que se guarda en images[] (principal primero).
// dragIndex: indice de la tarjeta que se esta arrastrando (null si nada).
const pendingPhotos = { items: [], dragIndex: null };

async function addProduct({ asDraft = false } = {}) {
  const formData = new FormData(elements.productForm);
  const name     = sanitizeText(formData.get('name'));
  const brand    = sanitizeText(formData.get('brand'));
  const color    = sanitizeText(formData.get('color'));
  const price    = sanitizePrice(formData.get('price'));
  const rawStock = sanitizeStock(formData.get('stock'));
  const imageUrl = sanitizeText(formData.get('imageUrl'));
  const styleRaw = formData.get('style');
  const style    = isValidStyle(styleRaw) ? styleRaw : null;

  if (!name || !brand || !color) {
    setProductFormMessage('Completa nombre, marca y color.', 'error');
    return;
  }

  // Estado de carga: deshabilitamos ambos botones mientras subimos.
  const btns = [elements.publishBtn, elements.saveDraftBtn].filter(Boolean);
  const activeBtn = asDraft ? elements.saveDraftBtn : elements.publishBtn;
  const originalLabel = activeBtn?.textContent;
  btns.forEach((b) => { b.disabled = true; });
  if (activeBtn) activeBtn.textContent = 'Guardando...';
  setProductFormMessage('', null);

  // Galeria: items[] (multi) tiene prioridad. Si no hay, caemos al campo URL.
  let gallery = [];
  let paths   = [];

  try {
    if (pendingPhotos.items.length > 0) {
      const uploaded = await uploadImages(pendingPhotos.items.map((it) => it.file));
      gallery = uploaded.publicUrls;
      paths   = uploaded.paths;
    } else if (imageUrl && isUrlLike(imageUrl)) {
      gallery = [imageUrl];
      paths   = []; // URL externa: no hay path en el bucket
    }
  } catch (error) {
    setProductFormMessage(`No se pudo subir la imagen: ${error?.message ?? 'error'}.`, 'error');
    btns.forEach((b) => { b.disabled = false; });
    if (activeBtn && originalLabel) activeBtn.textContent = originalLabel;
    return;
  }

  // Borrador: available=false, stock=0 — el item no aparece en el grid publico
  // pero queda visible en la tabla admin para editarlo luego.
  const stock = asDraft ? 0 : Math.max(0, rawStock);
  const available = asDraft ? false : stock > 0;

  try {
    await createProduct({
      name, brand, color, price, stock,
      available,
      status: available ? 'available' : 'sold_out',
      style,
      // Galeria nueva (Fase 3).
      images:      gallery,
      imagePaths:  paths,
      // Legacy: primera foto como "casera" para compat con lectores viejos.
      homeImageUrl: gallery[0] || null,
      imagePath:    paths[0] || null
    });
    elements.productForm.reset();
    resetPhotoDrop();
    setProductFormMessage(
      asDraft
        ? 'Borrador guardado. Lo ves en la tabla de abajo para activarlo luego.'
        : 'Publicado. Ya aparece en el catalogo.',
      'success'
    );
  } catch (error) {
    setProductFormMessage(`No se pudo guardar: ${error?.message ?? 'error'}.`, 'error');
  } finally {
    btns.forEach((b) => { b.disabled = false; });
    if (activeBtn && originalLabel) activeBtn.textContent = originalLabel;
  }
}

function setProductFormMessage(text, kind) {
  if (!elements.productFormMessage) return;
  elements.productFormMessage.classList.remove('success');
  if (kind === 'success') elements.productFormMessage.classList.add('success');
  elements.productFormMessage.textContent = text;
}

// --- Fotos: eleccion + compresion + preview (multi Fase 3) -----
// Admite varios archivos a la vez. Cada uno se comprime en paralelo y se
// agrega al final de pendingPhotos.items (sin reemplazar lo que ya habia).
async function handlePhotoChange(event) {
  const files = Array.from(event.target.files ?? []);
  if (files.length === 0) return;

  elements.photoDrop?.classList.add('is-loading');
  try {
    const processed = await Promise.all(
      files.map(async (f) => {
        try {
          const out = await compressImage(f, { maxSide: 1600, quality: 0.82, maxBytes: 420_000 });
          return { file: out, origSize: f.size };
        } catch (err) {
          console.warn('No se pudo comprimir, se usa original:', err);
          return { file: f, origSize: f.size };
        }
      })
    );
    for (const p of processed) {
      const previewUrl = URL.createObjectURL(p.file);
      pendingPhotos.items.push({ file: p.file, previewUrl, origSize: p.origSize });
    }
    // Limpiamos el input para que el mismo archivo pueda elegirse de nuevo.
    if (elements.newImageFile) elements.newImageFile.value = '';
    renderPhotoPreviewArea();
  } finally {
    elements.photoDrop?.classList.remove('is-loading');
  }
}

// Despacha entre preview single (1 foto) y grid thumbs (>=2 fotos).
// 0 fotos: vuelve al estado vacio.
function renderPhotoPreviewArea() {
  const n = pendingPhotos.items.length;
  if (n === 0) {
    elements.photoDropEmpty?.classList.remove('hidden');
    elements.photoDropPreview?.classList.add('hidden');
    elements.photoThumbs?.classList.add('hidden');
    return;
  }
  if (n === 1) {
    // Preview clasico con info de tamano.
    const only = pendingPhotos.items[0];
    elements.photoPreview.src = only.previewUrl;
    const sizeKb = Math.round(only.file.size / 1024);
    const origKb = Math.round(only.origSize / 1024);
    const changed = only.file.size < only.origSize;
    elements.photoPreviewInfo.textContent = changed
      ? `${sizeKb} KB · optimizada (era ${origKb} KB)`
      : `${sizeKb} KB`;
    elements.photoDropEmpty?.classList.add('hidden');
    elements.photoDropPreview?.classList.remove('hidden');
    elements.photoThumbs?.classList.add('hidden');
    return;
  }
  // Galeria: grid de thumbs con reorder/delete.
  elements.photoDropEmpty?.classList.add('hidden');
  elements.photoDropPreview?.classList.add('hidden');
  elements.photoThumbs?.classList.remove('hidden');
  renderPhotoThumbs();
}

function renderPhotoThumbs() {
  const host = elements.photoThumbs;
  if (!host) return;
  const items = pendingPhotos.items;
  host.innerHTML = items.map((it, i) => `
    <div class="photo-thumb${i === 0 ? ' is-primary' : ''}" data-index="${i}" draggable="true">
      <img src="${it.previewUrl}" alt="Foto ${i + 1}" />
      ${i === 0 ? '<span class="photo-thumb-chip">Principal</span>' : ''}
      <button type="button" class="photo-thumb-remove" data-action="remove" data-index="${i}" aria-label="Quitar foto ${i + 1}">&times;</button>
    </div>
  `).join('');
}

function handlePhotoThumbClick(e) {
  const btn = e.target.closest('[data-action="remove"]');
  if (!btn) return;
  const idx = Number(btn.dataset.index);
  const removed = pendingPhotos.items.splice(idx, 1)[0];
  if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
  renderPhotoPreviewArea();
}

function handlePhotoThumbDragStart(e) {
  const card = e.target.closest('.photo-thumb');
  if (!card) return;
  pendingPhotos.dragIndex = Number(card.dataset.index);
  card.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  // Firefox requiere setData para disparar drag.
  try { e.dataTransfer.setData('text/plain', String(pendingPhotos.dragIndex)); } catch {}
}

function handlePhotoThumbDragOver(e) {
  e.preventDefault();
  const card = e.target.closest('.photo-thumb');
  elements.photoThumbs?.querySelectorAll('.is-drop-target').forEach((n) => n.classList.remove('is-drop-target'));
  if (card) card.classList.add('is-drop-target');
  e.dataTransfer.dropEffect = 'move';
}

function handlePhotoThumbDrop(e) {
  e.preventDefault();
  const card = e.target.closest('.photo-thumb');
  const from = pendingPhotos.dragIndex;
  if (!card || from == null) { handlePhotoThumbDragEnd(); return; }
  const to = Number(card.dataset.index);
  if (from !== to) {
    const [moved] = pendingPhotos.items.splice(from, 1);
    pendingPhotos.items.splice(to, 0, moved);
  }
  handlePhotoThumbDragEnd();
  renderPhotoThumbs();
}

function handlePhotoThumbDragEnd() {
  pendingPhotos.dragIndex = null;
  elements.photoThumbs?.querySelectorAll('.is-dragging, .is-drop-target')
    .forEach((n) => n.classList.remove('is-dragging', 'is-drop-target'));
}

function resetPhotoDrop() {
  // Libera memoria de los previews antes de vaciar el array.
  for (const it of pendingPhotos.items) {
    if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
  }
  pendingPhotos.items = [];
  pendingPhotos.dragIndex = null;
  if (elements.newImageFile) elements.newImageFile.value = '';
  if (elements.photoPreview) elements.photoPreview.src = '';
  elements.photoDropEmpty?.classList.remove('hidden');
  elements.photoDropPreview?.classList.add('hidden');
  elements.photoThumbs?.classList.add('hidden');
  if (elements.photoThumbs) elements.photoThumbs.innerHTML = '';
}

// Compresion client-side: reduce piedras (~3MB) a <~400KB sin perder
// calidad visible. El bucket de Supabase es publico y cada foto viaja por
// celular del usuario al subir, asi que esto ahorra tiempo y ancho de banda.
async function compressImage(file, { maxSide = 1600, quality = 0.82, maxBytes = 420_000 } = {}) {
  if (!file || !file.type.startsWith('image/')) return file;
  // Si ya es chica, no tocamos nada (evitamos degradar calidad).
  if (file.size <= maxBytes) return file;

  const img = await loadImageFromFile(file);
  const { width, height } = img;
  const longest = Math.max(width, height);
  const scale = longest > maxSide ? (maxSide / longest) : 1;
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetW, targetH);

  // Intentamos JPEG con calidad decreciente hasta bajar de maxBytes (min 0.55).
  let q = quality;
  let blob = await canvasToBlob(canvas, 'image/jpeg', q);
  while (blob && blob.size > maxBytes && q > 0.55) {
    q = Math.max(0.55, q - 0.08);
    blob = await canvasToBlob(canvas, 'image/jpeg', q);
  }
  if (!blob) return file;

  const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}

function renderAdminSuggestions() {
  if (!elements.brandSuggestions || !elements.colorSuggestions) return;
  const brands = [...new Set(state.products.map((p) => p.brand).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  const colors = [...new Set(state.products.map((p) => p.color).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  elements.brandSuggestions.innerHTML = brands.map((b) => `<option value="${escapeAttribute(b)}"></option>`).join('');
  elements.colorSuggestions.innerHTML = colors.map((c) => `<option value="${escapeAttribute(c)}"></option>`).join('');
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

  const ok = await confirmDialog({
    title: 'Eliminar del catalogo?',
    message: `"${product.name}" se quita del catalogo publico. Sus fotos en Storage se preservan por si la subes de nuevo.`,
    confirmText: 'Eliminar',
    cancelText: 'Cancelar',
    danger: true
  });
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

// ---------- Responsive images ----------
// Supabase Storage soporta transforms via el endpoint /render/image/public
// en vez de /object/public. Nos permite servir variantes por ancho real sin
// re-subir archivos. Para URLs externas (stock, fallback local) devolvemos
// la URL cruda — no hay pipe de transforms fuera de nuestro host.
//
// Widths elegidos para calzar con los breakpoints del CSS:
//   400w -> cards en mobile (2 columnas, viewport ~400px)
//   600w -> cards en tablet (2-3 columnas)
//   900w -> cards en desktop (3-4 columnas)
//   1200w -> detail modal en desktop
const IMG_WIDTHS = [400, 600, 900, 1200];
const SUPABASE_OBJECT_RE = /\/storage\/v1\/object\/public\//;

function supabaseTransformedUrl(url, width) {
  // Reapuntar al endpoint de render con width+quality. La URL original
  // (/object/public/) sirve el archivo crudo; /render/image/public/ aplica
  // el pipeline de transformaciones (resize + encode).
  return url.replace(SUPABASE_OBJECT_RE, '/storage/v1/render/image/public/')
         + (url.includes('?') ? '&' : '?')
         + `width=${width}&quality=75`;
}

function isTransformableUrl(url) {
  return typeof url === 'string' && SUPABASE_OBJECT_RE.test(url);
}

// Devuelve { src, srcset, sizes } listos para inyectar en un <img>.
// Si la URL no es transformable, srcset/sizes van vacios y solo se usa src.
function buildImageSources(url, { sizes = '(max-width: 600px) 50vw, (max-width: 1024px) 33vw, 25vw' } = {}) {
  if (!isTransformableUrl(url)) {
    return { src: url, srcset: '', sizes: '' };
  }
  const srcset = IMG_WIDTHS
    .map((w) => `${supabaseTransformedUrl(url, w)} ${w}w`)
    .join(', ');
  // src apunta al width intermedio como fallback para browsers sin srcset.
  const src = supabaseTransformedUrl(url, 600);
  return { src, srcset, sizes };
}
