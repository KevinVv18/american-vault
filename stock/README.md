# /stock/ — Imagenes stock (editoriales)

Este directorio contiene imagenes "stock" de carteras (fondo limpio, producto aislado, vibra editorial) que se usan como **imagen principal** en el catalogo. La foto "casera" (real, subida por el admin al bucket `carteras` de Supabase) queda como **imagen secundaria** accesible en swipe/hover.

## Como se usa

1. Cada producto puede tener una columna `stock_image_url` en la tabla `products`.
2. Si existe, se muestra como primera imagen en la tarjeta y la hero del producto.
3. Si no existe, la tarjeta cae al `image_url` tradicional (foto casera).
4. Si tampoco existe, se usa `stock/default-bag.jpg` como ultimo recurso.

## Convencion de archivos

- Formato: `.jpg` o `.webp`, 1200px lado largo, calidad 85%.
- Fondo neutro (blanco, gris claro, studio).
- **Sin logos de marca visibles** — si la cartera muestra un logo obvio de otra marca, no la uses como stock (problema legal/reputacional).
- Nombres sugeridos: `{marca-slug}-{modelo-slug}.jpg` (ej. `michael-kors-jet-set.jpg`).

## Futuro uso (wishlist expandida)

Cuando implementemos la feature de "wishlist de carteras que aun no tenemos":
- Este folder contendra un **catalogo extendido** de modelos disponibles de importacion.
- Los clientes podran marcarlas desde un feed separado (sin tener stock real todavia).
- Al llegar una cartera similar a la DB, el sistema cruzara con estos wishlists y disparara notificaciones por WhatsApp.

## Default actual

`default-bag.jpg` — Unsplash (photo-1566150905458), editorial studio, sin logo visible. Placeholder hasta que el admin suba imagenes dedicadas.
