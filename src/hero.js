// ============================================================
// Hero scrollytelling — cartera 3D rotando segun scroll.
//
// 2 capas:
//   (a) Fallback SVG silueta con rotateY (mobile barato, reduce-motion)
//   (b) Upgrade progresivo a three.js con FBX + PBR cuando el hero
//       entra al viewport. Si three.js falla, se queda la silueta.
//
// Convencion del modelo (animatedheaven):
//   mallas -> purse_lower, purse_metal, purse_upper
//   texturas -> <nombre>_Base_color / _normal / _metallic / _roughness (.webp)
// ============================================================

const TAU = Math.PI * 2;

const hero    = document.getElementById('heroVault');
const stage   = document.getElementById('heroStage');
const bagSvg  = document.getElementById('heroBag');
const canvas  = document.getElementById('heroCanvas');
const topbar  = document.querySelector('.topbar');

if (hero && bagSvg) {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Estado compartido entre scroll handler y loop 3D.
  const state = {
    progress: 0,       // 0..1 a lo largo del hero
    threeReady: false, // true cuando el modelo esta cargado
    render3D: null     // callback que el 3D registra para pintar con el progress actual
  };

  // Actos editoriales: 3 headlines que se revelan/reemplazan por scroll.
  // Cacheamos los nodos al cargar para no hacer querySelector en cada scroll.
  // Cada acto tiene un rango de visibilidad [in, out] sobre el progress p:
  //   acto 1 (USA a Peru)                -> entra al abrir, sale antes del giro
  //   acto 2 (Cada pieza, autentica)     -> durante el giro lateral
  //   acto 3 (Lista para ser tuya + CTA) -> zona de frente + settling final
  // En reduce-motion forzamos los 3 a mostrarse a la vez (sin animacion).
  const actEls = Array.from(hero.querySelectorAll('.hero-act'));
  const actRanges = [
    { in: 0.00, out: 0.26 },
    { in: 0.30, out: 0.58 },
    { in: 0.62, out: 1.10 }  // el tercero se queda hasta el final
  ];
  if (prefersReduced) {
    // Sin animacion de scroll: mostramos los 3 apilados (fallback estatico).
    actEls.forEach(el => el.classList.add('is-in'));
  }

  // --- Stock counter (acto 3): count-up animado cuando el acto entra ---
  // El numero real llega via CustomEvent('av:catalog-count') desde app.js
  // cuando el catalogo se renderiza. El count-up se dispara la PRIMERA vez
  // que el acto 3 tiene .is-in, y no se repite (seria chicle visual).
  // Si el numero llega DESPUES del primer is-in (carga lenta), disparamos
  // el count-up al recibir el evento.
  const stockEl = document.getElementById('heroStockNum');
  const stock = {
    target: null,
    played: false,
    scheduled: false
  };
  function animateStockUp(to) {
    if (!stockEl || to == null) return;
    stock.played = true;
    // Reduce-motion: snap al valor final sin tween.
    if (prefersReduced) {
      stockEl.textContent = String(to);
      return;
    }
    const duration = 1200;
    const frameMs = 1000 / 50; // ~50fps es visualmente suficiente para un odometro
    const start = Date.now();
    // easeOutQuart: llega rapido y desacelera.
    const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
    // Usamos setTimeout en vez de rAF por la misma razon que el scroll
    // handler: ciertos entornos de preview no disparan rAF de forma fiable.
    (function tick() {
      const t = Math.min(1, (Date.now() - start) / duration);
      const v = Math.round(easeOutQuart(t) * to);
      stockEl.textContent = String(v);
      if (t < 1) setTimeout(tick, frameMs);
    })();
  }
  function maybePlayStock() {
    if (stock.played || stock.target == null) return;
    const act3 = actEls[2];
    if (!(act3 && act3.classList.contains('is-in'))) return;
    // target===0 suele ser el estado transitorio inicial (antes de que el
    // fetch de Supabase termine). No animamos a 0 — esperamos un valor real.
    // Si al final del fetch el catalogo sigue vacio, se queda el placeholder
    // "0" y la linea dice "0 piezas esperandote" sin animacion (sad path).
    if (stock.target === 0) return;
    animateStockUp(stock.target);
  }
  function handleCatalogCount(detail) {
    const d = detail || {};
    // Priorizamos disponibles (trust signal > inventario total).
    const n = typeof d.available === 'number' ? d.available : d.total;
    if (typeof n !== 'number' || n < 0) return;
    stock.target = n;
    if (stockEl && !stock.played) {
      // Placeholder "—" se reemplaza por "0" para que el count-up
      // arranque de cero cuando entre el acto 3.
      stockEl.textContent = '0';
    }
    maybePlayStock();
  }
  document.addEventListener('av:catalog-count', (e) => handleCatalogCount(e.detail));
  // Fallback para race: si app.js ya disparo el evento antes de que este
  // listener se registrara, leemos el ultimo valor del global.
  if (window.__avCatalog) handleCatalogCount(window.__avCatalog);

  // ---- scroll progress (siempre activo, driver de ambas capas) ----
  // El render 3D se dispara desde aca en vez de rAF-loop: ahorra GPU cuando
  // la pagina esta idle y se alinea naturalmente con los unicos eventos que
  // cambian la escena (scroll + resize).
  // Nota: usamos setTimeout como coalescer en vez de rAF porque ciertos
  // entornos de preview no disparan rAF de forma fiable. El costo en un
  // navegador real es despreciable (~4ms) y la logica se mantiene simple.
  let scheduled = 0;
  function onScroll() {
    if (scheduled) return;
    scheduled = setTimeout(update, 0);
  }

  function update() {
    scheduled = 0;
    const rect  = hero.getBoundingClientRect();
    const range = rect.height - window.innerHeight;
    state.progress = range > 0
      ? Math.max(0, Math.min(1, -rect.top / range))
      : 0;

    // Silueta (fallback): rotateY 0->360 + squash suave al canto
    const p   = state.progress;
    const deg = prefersReduced ? 18 : p * 360;
    const edgeness = Math.abs(Math.sin((deg % 360) * Math.PI / 180));
    const squash   = 1 - edgeness * 0.08;
    bagSvg.style.transform = `rotateY(${deg}deg) scale(${squash})`;

    // Grain parallax: drift vertical sutil (foreground se siente mas cerca
    // que la textura). 64px de recorrido a lo largo del hero (2 pantallas)
    // es apenas perceptible — objetivo buscado: sentirlo, no verlo.
    if (!prefersReduced) {
      hero.style.setProperty('--grain-y', `${(p * -64).toFixed(1)}px`);
    }

    // Actos editoriales: togglear .is-in por rango.
    // Si reduce-motion esta on, actEls ya tienen .is-in y no tocamos nada.
    if (!prefersReduced && actEls.length) {
      for (let i = 0; i < actEls.length; i++) {
        const r = actRanges[i];
        const visible = p >= r.in && p <= r.out;
        // toggle es idempotente; el DOM solo cambia si hace falta, la
        // transicion CSS se encarga del fade + slide.
        actEls[i].classList.toggle('is-in', visible);
      }
      // Dispara el count-up la primera vez que entra el acto 3.
      if (!stock.played) maybePlayStock();
    }

    // ---- topbar dark/light sync con el gradiente del hero ----
    // BUG PREVIO: usabamos IntersectionObserver con threshold 0.35 sobre un
    // hero de 200vh. El ratio empieza en ~0.5 (100vh visible / 200vh total)
    // y cae bajo 0.35 a scroll=130vh, pero visualmente el pixel detras del
    // topbar todavia esta pintado negro hasta ~scroll=148vh (stop #1e1e1e
    // del gradiente). Resultado: topbar se ponia blanco sobre fondo aun
    // oscuro. Ademas, IO es asincrono — en ciertos paths (restore scroll,
    // refresh, scroll-up forzado) el primer callback llegaba tarde y se veia
    // un flash blanco sobre el primer fold negro.
    //
    // FIX: calculamos la fraccion exacta del hero que queda sobre el topbar
    // (hero y=0 esta en -rect.top en coords del hero) y la comparamos contra
    // el stop donde el gradiente deja de leerse como negro (~0.72). Sync
    // con el scroll, cero async, cero flash.
    if (topbar) {
      const heroStillCovers = rect.bottom > 0 && rect.top < window.innerHeight;
      const topFrac = rect.height > 0 ? (-rect.top) / rect.height : 0;
      const overDark = heroStillCovers && topFrac < 0.72;
      topbar.classList.toggle('is-over-dark', overDark);
    }

    // Empuja el nuevo frame 3D si esta listo
    if (state.render3D) state.render3D(p);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', update,   { passive: true });
  update();

  // ---- Upgrade a 3D (lazy, no bloquea la primera pintura) ----
  // Lo lanzamos solo cuando:
  //  - No reduce-motion
  //  - Hay canvas
  //  - WebGL2 disponible
  //  - El hero esta cerca de viewport
  const canUse3D =
    !prefersReduced &&
    canvas &&
    stage &&
    hasWebGL();

  if (canUse3D) {
    // El hero es el primer fold; arranca inmediato tras un micro-delay
    // que le da al navegador tiempo de layoutear el canvas.
    setTimeout(() => {
      init3D().catch(err => {
        console.warn('[hero3D] fallo, se queda silueta SVG:', err);
      });
    }, 0);
  }

  // ==========================================================
  // Three.js init
  // ==========================================================
  async function init3D() {
    const [THREE, { FBXLoader }, { RoomEnvironment }] = await Promise.all([
      import('three'),
      import('three/addons/loaders/FBXLoader.js'),
      import('three/addons/environments/RoomEnvironment.js')
    ]);

    // --- renderer ---
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Exposicion: el bag es cuero negro sobre fondo negro. Queremos que la
    // forma se lea por silueta + specular highlights del cuero (leve) y del
    // herraje dorado (fuerte). 1.05 da buen contraste sin lavar los negros.
    renderer.toneMappingExposure = 1.05;
    sizeRenderer();

    // --- scene ---
    const scene = new THREE.Scene();
    scene.background = null; // dejamos pasar el negro del hero

    // Env map suave para reflejos PBR sin HDR externo.
    // Lo mantenemos porque el herraje dorado necesita reflejos para leerse
    // como metal; pero cada material ajusta su `envMapIntensity` aparte
    // (leather muy bajo, metal alto) para evitar que el cuero negro refleje
    // la sala y se lea como superficie blanca.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // --- camera ---
    const camera = new THREE.PerspectiveCamera(32, aspect(), 0.1, 100);
    camera.position.set(0, 0.05, 3.1);
    camera.lookAt(0, 0, 0);

    // --- luces (clave + rim + fill) ---
    // Setup low-key de estudio: clave calida principal desde arriba-derecha,
    // rim frio desde atras izquierda para recortar la silueta del fondo
    // negro, fill muy suave y hemi de relleno ambiental. Valores pensados
    // para que el cuero negro se lea por highlights + pespunte sin blanquearse.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x0a0a0a, 0.35);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
    key.position.set(2.2, 3.0, 2.4);
    scene.add(key);
    // Posicion base de la key para el orbit parcial en render3D.
    // Clonamos ahora porque key.position muta en cada frame.
    const KEY_BASE = key.position.clone();

    const rim = new THREE.DirectionalLight(0xd6e5ff, 1.4);
    rim.position.set(-3.0, 1.2, -2.0);
    scene.add(rim);

    const fill = new THREE.DirectionalLight(0xffffff, 0.25);
    fill.position.set(0, -2, 2);
    scene.add(fill);

    // --- cargar texturas PBR (paralelo) ---
    const texLoader = new THREE.TextureLoader();
    const base = 'assets/3d/handbag/textures/';

    // loadTex: isColor=true -> SRGB (base color). isColor=false -> NoColorSpace
    // (data maps: normal, metallic, roughness). Lo dejamos explicito para no
    // depender del default del browser/TextureLoader, que cambia entre
    // versiones y puede aplicar gamma a datos que deberian estar en linear.
    const loadTex = (name, isColor) => new Promise((resolve, reject) => {
      texLoader.load(
        base + name,
        (t) => {
          t.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.flipY = false; // FBX usa UV no volteadas
          t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 8);
          resolve(t);
        },
        undefined,
        reject
      );
    });

    // Materiales PBR por region. Las 4 texturas de Substance Painter son
    // datos validos (base color negro con pespunte claro, metalness casi 0
    // en cuero y casi 1 en herraje, roughness alto en cuero, bajo en metal).
    // Dejamos que los mapas manejen metalness/roughness per pixel y solo
    // ajustamos envMapIntensity para balancear: cuero capta poco reflejo,
    // herraje mucho.
    const regions = ['lower', 'metal', 'upper'];
    const ENV = { lower: 0.55, metal: 1.0, upper: 0.55 };
    const materials = {};
    await Promise.all(regions.map(async (r) => {
      const [map, normalMap, metalnessMap, roughnessMap] = await Promise.all([
        loadTex(`purse_${r}_Base_color.webp`, true),
        loadTex(`purse_${r}_normal.webp`,     false),
        loadTex(`purse_${r}_metallic.webp`,   false),
        loadTex(`purse_${r}_roughness.webp`,  false)
      ]);
      materials[r] = new THREE.MeshStandardMaterial({
        map,
        normalMap,
        metalnessMap,
        roughnessMap,
        metalness: 1.0,   // multiplicador del mapa; el mapa decide per pixel
        roughness: 1.0,
        envMapIntensity: ENV[r]
      });
    }));

    // --- cargar FBX ---
    // El FBX trae referencias embedidas a .png que no estan en disco
    // (usamos nuestros WebP optimizados en /textures). Con un LoadingManager
    // que intercepta URLs de imagen y las apunta a un 1x1 inline, evitamos
    // 12 requests 404 y mantenemos el loader contento.
    const blankPx = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const fbxManager = new THREE.LoadingManager();
    fbxManager.setURLModifier((url) => {
      // si el FBX pide texturas cercanas (png/jpg/tga/bmp), devolvemos blank
      if (/\.(png|jpg|jpeg|tga|bmp|gif)(\?.*)?$/i.test(url)) return blankPx;
      return url;
    });
    const loader = new FBXLoader(fbxManager);
    const model = await new Promise((resolve, reject) => {
      loader.load(
        'assets/3d/handbag/handbag.fbx',
        (obj) => resolve(obj),
        undefined,
        reject
      );
    });

    // ROOT CAUSE del render blanco (sesion anterior): el FBX trae 7 PointLights
    // embedidas de la escena de Blender original con intensidades 100-3000.
    // Al agregar el modelo a nuestra escena, esas luces se suman a las
    // nuestras (key/rim/fill) y revientan el PBR — el cuero negro se lee
    // como superficie blanca. Las barremos antes de procesar los meshes.
    const strayLights = [];
    model.traverse((child) => {
      if (child.isLight) strayLights.push(child);
    });
    strayLights.forEach((l) => l.parent && l.parent.remove(l));

    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;

      const nm = (child.name || '').toLowerCase();
      let mat = null;
      if      (nm.includes('lower')) mat = materials.lower;
      else if (nm.includes('metal')) mat = materials.metal;
      else if (nm.includes('upper')) mat = materials.upper;
      // Si el mesh no tiene nombre reconocible, intentamos inferir por
      // material previo (FBX a veces empaqueta varios submeshes).
      if (!mat) {
        const prev = child.material?.name?.toLowerCase?.() || '';
        if      (prev.includes('lower')) mat = materials.lower;
        else if (prev.includes('metal')) mat = materials.metal;
        else if (prev.includes('upper')) mat = materials.upper;
      }
      if (mat) child.material = mat;
    });

    // --- centrar y escalar para que entre en el frame ---
    // Orden: (1) meter el modelo en un pivot, (2) centrar geometria al origen
    // en coordenadas locales, (3) escalar el pivot. Asi la escala se aplica
    // despues del centrado y el bbox resultante queda en el centro del mundo.
    const pivot = new THREE.Group();
    pivot.add(model);
    scene.add(pivot);

    const box0 = new THREE.Box3().setFromObject(model);
    const size0 = box0.getSize(new THREE.Vector3());
    const center0 = box0.getCenter(new THREE.Vector3());
    // Subir el modelo ~8% respecto al centro del bbox: asi la linea
    // inferior de la cartera queda lejos del fade del hero cuando gira,
    // y la masa visual se concentra en el tercio superior del frame
    // (regla del tercio aplicada a fotografia de producto).
    model.position.sub(center0);
    model.position.y += size0.y * 0.08;

    const maxDim = Math.max(size0.x, size0.y, size0.z);
    // altura visible objetivo en unidades 3D — algo mas chico que antes
    // (1.55 vs 1.65) para que aunque gire 360 nunca roce el bottom del
    // viewport sticky.
    const target = 1.55;
    const scale = target / maxDim;
    pivot.scale.setScalar(scale);

    // --- render reactivo (driven por scroll, no por rAF) ---
    // Se llama desde el scroll handler cada vez que el progress cambia.
    // Asi el 3D solo pinta cuando hay algo visualmente que cambiar.
    //
    // Rotacion: entramos en un 3/4 halagador y terminamos de frente
    // pleno a camara (el lado con cadena + herraje). Calibrado
    // empiricamente via framebuffer sampling: el FBX tiene su "front"
    // natural a rotY = 3*PI/2 (270deg). Con START = -PI/4 (315deg) el
    // primer frame ya muestra la 3/4 view. SWEEP de 315deg (7*PI/4)
    // cubre casi una vuelta completa y asienta el front a p=1.
    //   p=0  -> 315deg (3/4 view, lado + frente)
    //   p=1  -> 270deg (frente pleno, front-on)
    // easeOutCubic en la fase final (p>0.7) desacelera la llegada:
    // la cartera no "frena" — se posa.
    const START   = -Math.PI * 0.25;       // 315deg
    const END     = Math.PI * 1.5;         // 270deg (front-on calibrado)
    const SWEEP   = END - START;            // 7PI/4 = 315deg
    let lastP = -1;
    function render3D(p) {
      if (p !== lastP) {
        // easeOutCubic solo en el ultimo 30% para settling final
        let pe = p;
        if (p > 0.7) {
          const t = (p - 0.7) / 0.3; // 0..1 en la zona de asentamiento
          const eased = 1 - Math.pow(1 - t, 3);
          pe = 0.7 + eased * 0.3;
        }
        pivot.rotation.y = START + pe * SWEEP;
        // Dolly-in sutil al cruzar el medio (mas cerca cuando cruza el canto)
        const edge = Math.sin(p * Math.PI); // 0 al inicio/fin, 1 al medio
        camera.position.z = 3.1 - edge * 0.32;
        // Leve inclinacion para que no se vea completamente de perfil,
        // pero en el tramo final (p>0.85) forzamos a 0 para que el
        // encuadre frontal sea perfectamente recto.
        const tiltFactor = p > 0.85 ? Math.max(0, 1 - (p - 0.85) / 0.15) : 1;
        pivot.rotation.x = Math.sin(p * Math.PI * 2) * 0.06 * tiltFactor;

        // ---- Contact shadow: responde al angulo de rotacion ----
        // profileness = 1 cuando la cartera esta 90 grados girada (silueta
        // estrecha, perfil puro); 0 de frente o de espaldas (silueta ancha).
        // La sombra ancha+visible cuando hay mucha base proyectada al piso
        // y angosta+tenue cuando la cartera esta de canto. El delta con END
        // (front-on) mantiene la formula estable aunque el modelo siga rotando.
        const profileness = Math.abs(Math.sin(pivot.rotation.y - END));
        const widthPct = 52 - profileness * 24;    // 28% (perfil) -> 52% (frente)
        const shadowOp = 0.26 - profileness * 0.14; // 0.12 -> 0.26
        stage.style.setProperty('--shadow-width',   widthPct.toFixed(1) + '%');
        stage.style.setProperty('--shadow-opacity', shadowOp.toFixed(3));

        // ---- Key light orbit parcial ----
        // La key light estatica deja al herraje dorado sin highlight cuando
        // la cartera esta de espaldas. Si orbitaramos 1:1 con el bag el
        // reflejo quedaria congelado en la misma zona y se pierde el
        // atractivo de una toma rotante. Compromiso: orbitamos la luz a un
        // ~45% del angulo del bag. Los highlights siguen viajando (perciben
        // movimiento) pero nunca se van completamente.
        //
        // Implementacion: rotamos la posicion base (KEY_BASE) alrededor del
        // eje Y por fracc * delta del bag respecto del front canonico.
        const delta = (pivot.rotation.y - END) * 0.45;
        const cos = Math.cos(delta);
        const sin = Math.sin(delta);
        // rotacion manual alrededor de Y (evita alocar Vector3 por frame)
        key.position.set(
          KEY_BASE.x * cos + KEY_BASE.z * sin,
          KEY_BASE.y,
          -KEY_BASE.x * sin + KEY_BASE.z * cos
        );

        lastP = p;
      }
      renderer.render(scene, camera);
    }

    // --- resize responsivo ---
    function sizeRenderer() {
      const r = canvas.getBoundingClientRect();
      const w = Math.max(1, r.width);
      const h = Math.max(1, r.height);
      renderer.setSize(w, h, false);
    }
    function aspect() {
      const r = canvas.getBoundingClientRect();
      return Math.max(0.1, r.width / Math.max(1, r.height));
    }
    function onResize() {
      sizeRenderer();
      camera.aspect = aspect();
      camera.updateProjectionMatrix();
      // repintamos con el progress actual para no dejar el canvas rancio
      render3D(state.progress);
    }
    window.addEventListener('resize', onResize, { passive: true });

    // --- listo: activar canvas, desvanecer silueta, primer pintado ---
    state.threeReady = true;
    state.render3D = render3D;
    stage.classList.add('hero-has-3d');
    onResize(); // dispara un render inicial

    // debug-only: en dev, expose para inspeccion desde consola.
    // se deja condicionado a hostname local para no filtrar en prod.
    if (/^(localhost|127\.|192\.168\.)/.test(location.hostname)) {
      window.__hero3D = { renderer, scene, camera, model, pivot, materials };
    }
  }

  // ---- util: detectar WebGL ----
  function hasWebGL() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
    } catch {
      return false;
    }
  }
}
