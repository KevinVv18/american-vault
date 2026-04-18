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

    // Hint desliza: se desvanece en cuanto empieza a pasar
    const hint = hero.querySelector('.hero-scroll-hint');
    if (hint) hint.style.opacity = String(Math.max(0, 1 - p * 2.2));

    // Empuja el nuevo frame 3D si esta listo
    if (state.render3D) state.render3D(p);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', update,   { passive: true });
  update();

  // ---- topbar invertido mientras el hero esta visible ----
  if (topbar) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const overDark = e.isIntersecting && e.intersectionRatio > 0.35;
        topbar.classList.toggle('is-over-dark', overDark);
      }
    }, { threshold: [0, 0.2, 0.35, 0.6, 0.85, 1] });
    io.observe(hero);
  }

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
    // Exposicion baja: el bag es cuero negro sobre fondo negro. Con exposicion
    // alta + RoomEnvironment brillante el PBR leia la piel como superficie
    // espejo y salia "blanca". 0.85 deja ver la forma por el specular pero
    // sin overexpose.
    renderer.toneMappingExposure = 0.85;
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
    // Setup low-key: clave principal calida desde arriba-derecha, rim frio
    // desde atras para silueta, hemi suave de relleno. Intensidades bajas
    // para que el cuero negro se lea como cuero y no como superficie
    // espejeada blanca.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x0a0a0a, 0.18);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff4e6, 1.1);
    key.position.set(2.2, 3.0, 2.4);
    scene.add(key);

    const rim = new THREE.DirectionalLight(0xe6f0ff, 0.55);
    rim.position.set(-3.0, 1.2, -2.0);
    scene.add(rim);

    const fill = new THREE.DirectionalLight(0xffffff, 0.12);
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

    // Materiales: split deliberado leather vs metal.
    //
    // Leather (lower/upper): dielectrico puro. Solo base color + normal.
    // Eliminar metalnessMap/roughnessMap es crucial: si el canal metallic
    // del paquete PBR esta mal codificado (p.ej. webp con alpha o gamma
    // mal), el shader lee el cuero como superficie metalica y el env map
    // blanquea todo. Fijamos metalness=0 forzoso y roughness alto (cuero
    // mate). envMapIntensity muy baja para que no capture la sala.
    //
    // Metal (hardware): full PBR con las 4 mapas. El herraje dorado necesita
    // metalness=1 y reflejos del env map para leerse como metal.
    const loadLeatherMaps = async (r) => {
      const [map, normalMap] = await Promise.all([
        loadTex(`purse_${r}_Base_color.webp`, true),
        loadTex(`purse_${r}_normal.webp`,     false)
      ]);
      return new THREE.MeshStandardMaterial({
        map,
        normalMap,
        color: 0x1a1a1a,       // leve tinte negro por si el base color sale gris
        metalness: 0.0,
        roughness: 0.78,
        envMapIntensity: 0.22
      });
    };
    const loadMetalMaps = async () => {
      const [map, normalMap, metalnessMap, roughnessMap] = await Promise.all([
        loadTex('purse_metal_Base_color.webp', true),
        loadTex('purse_metal_normal.webp',     false),
        loadTex('purse_metal_metallic.webp',   false),
        loadTex('purse_metal_roughness.webp',  false)
      ]);
      return new THREE.MeshStandardMaterial({
        map,
        normalMap,
        metalnessMap,
        roughnessMap,
        metalness: 1.0,
        roughness: 0.55,
        envMapIntensity: 0.9
      });
    };
    const [leatherLower, leatherUpper, metalMat] = await Promise.all([
      loadLeatherMaps('lower'),
      loadLeatherMaps('upper'),
      loadMetalMaps()
    ]);
    const materials = { lower: leatherLower, upper: leatherUpper, metal: metalMat };

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
    // bajar 4% para dar respiro abajo
    model.position.sub(center0);
    model.position.y -= size0.y * 0.04;

    const maxDim = Math.max(size0.x, size0.y, size0.z);
    const target = 1.65; // altura visible objetivo en unidades 3D
    const scale = target / maxDim;
    pivot.scale.setScalar(scale);

    // --- render reactivo (driven por scroll, no por rAF) ---
    // Se llama desde el scroll handler cada vez que el progress cambia.
    // Asi el 3D solo pinta cuando hay algo visualmente que cambiar.
    // Offset de rotacion: el FBX carga con la cara lateral hacia la camara.
    // Para que el hero entre con un 3/4 halagador (no de canto), empujamos
    // la fase -45deg; asi p=0 muestra frente-3/4, p=0.25 costado, etc.
    const Y_OFFSET = -Math.PI * 0.25;
    let lastP = -1;
    function render3D(p) {
      if (p !== lastP) {
        // Rotacion: giro completo a lo largo del hero, offseted a 3/4 view
        pivot.rotation.y = Y_OFFSET + p * TAU;
        // Dolly-in sutil al cruzar el medio (mas cerca cuando cruza el canto)
        const edge = Math.sin(p * Math.PI); // 0 al inicio/fin, 1 al medio
        camera.position.z = 3.1 - edge * 0.32;
        // Leve inclinacion para que no se vea completamente de perfil
        pivot.rotation.x = Math.sin(p * Math.PI * 2) * 0.06;
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
