// brand-page.js — Renderer de las landing pages SEO por marca
// (/carteras-guess/, /carteras-tommy-hilfiger/, ...).
//
// Reusa la capa de datos del catalogo (products.fetchAll) y las clases CSS
// de styles.css para que las tarjetas se vean identicas al catalogo, SIN
// depender de app.js (que arrastra hero/admin/wishlist/modales).
//
// La marca a mostrar se lee de <body data-brand="Guess">. El match es
// case-insensitive y exacto sobre el campo brand del producto.

import { WHATSAPP_URL, FALLBACK_IMAGE } from './config.js?v=__BUILD_HASH__';
import { fetchAll } from './products.js?v=__BUILD_HASH__';

const BRAND = (document.body.dataset.brand || '').trim();
const grid = document.getElementById('brandGrid');
const countEl = document.getElementById('brandCount');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE');

function card(p) {
  const out = !(p.available && Number(p.stock) > 0);
  const origin = window.location.origin;
  const deep = `${origin}/?id=${encodeURIComponent(p.id)}&b=${encodeURIComponent(p.brand)}`;
  const waText = encodeURIComponent(
    `Hola, me interesa la *${p.name}* (${p.brand}) — S/${p.price}. Link: ${deep}`
  );
  const waHref = `${WHATSAPP_URL}?text=${waText}`;
  return `
    <article class="product-card${out ? ' is-out' : ''}">
      <a class="product-image-wrap" href="${esc(deep)}" aria-label="Ver ${esc(p.name)}">
        <img class="product-image"
             src="${esc(p.imageUrl || FALLBACK_IMAGE)}"
             width="600" height="800"
             alt="Cartera ${esc(p.name)} ${esc(p.brand)}"
             loading="lazy" decoding="async"
             onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'" />
      </a>
      <div class="product-info">
        <p class="product-brand">${esc(p.brand)}</p>
        <h3 class="product-title">${esc(p.name)}</h3>
        <div class="product-price-row">
          <span class="product-price">${soles(p.price)}</span>
          <span class="product-stock">${out ? 'Agotado' : esc(p.stock) + ' disp.'}</span>
        </div>
        ${out ? '' : `
          <a class="wa-button" href="${waHref}" target="_blank" rel="noopener noreferrer"
             aria-label="Pedir ${esc(p.name)} por WhatsApp">
            <span class="wa-label-full">Pedir por WhatsApp</span>
            <span class="wa-label-short">Pedir</span>
          </a>`}
      </div>
    </article>`;
}

(async () => {
  if (!grid) return;
  try {
    const all = await fetchAll();
    const items = all
      .filter((p) => (p.brand || '').trim().toLowerCase() === BRAND.toLowerCase())
      .sort((a, b) => Number(b.available) - Number(a.available)); // disponibles primero
    if (countEl) {
      countEl.textContent = items.length
        ? `${items.length} ${items.length === 1 ? 'pieza disponible' : 'piezas en catalogo'} · Precios en S/`
        : 'Pronto llegaran piezas de esta marca';
    }
    grid.innerHTML = items.length
      ? items.map(card).join('')
      : `<p class="brand-empty">Por ahora no hay piezas de ${esc(BRAND)} en stock.
         <a href="/">Mira todo el catalogo</a> o escribenos por WhatsApp y te avisamos cuando llegue una.</p>`;
  } catch (e) {
    grid.innerHTML = `<p class="brand-empty">No se pudo cargar el catalogo en este momento.
      <a href="/">Ir al catalogo principal</a>.</p>`;
  }
})();
