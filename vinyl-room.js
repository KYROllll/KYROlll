/* KYROIII — THE VINYL ROOM
 *
 * The storefront's first screen: a dark listening room with a physical record
 * shelf and a turntable. Every beat is a sleeve on the shelf; the newest one is
 * still sealed in shrink-wrap, which tears open when it is chosen (a drag on
 * the seal scrubs the tear). Choosing a record raises two paths — LISTEN cues
 * it on the 3D deck, FREE DOWNLOAD slides the package drawer in — and the deck's
 * own chassis control strip carries the transport and the package buttons.
 *
 * The room is the store's only home surface: browsing, streaming, the free /
 * exclusive package hand-off and the support/profile links all live here. There
 * is no catalog document below it.
 *
 * Everything visual is neutral (black, white, silver): the only colour in the
 * room comes from the supplied cover art and the photographed vinyl label.
 * The module is bundled to `assets/vinyl-room.min.js` with esbuild; it needs
 * `three` from the root node_modules and no other runtime dependency.
 *
 * The commerce stays in the store's existing modules: package buttons call
 * `KYROlll_DOWNLOADS.start`, so every hand-off still passes the email gate and
 * the REVIEW & SIGN stage. The room only ever plays the public preview.
 */
import * as THREE from "three";

(function () {
  "use strict";

  const room = document.querySelector("[data-room]");
  if (!room) return;

  const stageEl = room.querySelector("[data-room-stage]");
  const countEl = room.querySelector("[data-room-count]");
  const hintEl = room.querySelector("[data-room-hint]");
  const card = room.querySelector("[data-room-card]");
  const cardKicker = room.querySelector("[data-card-kicker]");
  const cardTitle = room.querySelector("[data-card-title]");
  const cardSpecs = room.querySelector("[data-card-specs]");
  const listenBtn = room.querySelector("[data-room-listen]");
  const downloadBtn = room.querySelector("[data-room-download]");
  const closeBtn = room.querySelector("[data-room-close]");
  const tray = room.querySelector("[data-room-tray]");
  const trayKicker = room.querySelector("[data-room-tray-kicker]");
  const trayTitle = room.querySelector("[data-room-tray-title]");
  const trayList = room.querySelector("[data-room-tray-list]");
  const trayClose = room.querySelector("[data-room-tray-close]");
  const deckEl = room.querySelector("[data-room-deck]");
  const deckTitle = room.querySelector("[data-deck-title]");
  const deckPlay = room.querySelector("[data-deck-play]");
  const deckBar = room.querySelector("[data-deck-bar]");
  const deckTime = room.querySelector("[data-deck-time]");
  const deckPacks = room.querySelector("[data-deck-packs]");
  const deckEject = room.querySelector("[data-deck-eject]");
  const fallbackLink = room.querySelector("[data-room-fallback]");
  const cardStatus = room.querySelector("[data-card-status]");
  const traySpecs = room.querySelector("[data-room-tray-specs]");
  const scrim = room.querySelector("[data-room-scrim]");

  const HELPERS = window.KYROlll_HELPERS || {};
  const PACKAGES = Array.isArray(window.KYROlll_PACKAGES) ? window.KYROlll_PACKAGES : [];
  const BEATS = (Array.isArray(window.KYROlll_CATALOG) ? window.KYROlll_CATALOG : []).slice().reverse();

  if (!BEATS.length || !stageEl) return;

  if (countEl) countEl.textContent = String(BEATS.length).padStart(2, "0") + " RELEASES ON THE SHELF";

  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = reducedQuery.matches;
  /* Read the button's already-published state: brand-logo dispatches its first
     `motion-toggle` before this bundle may have loaded. */
  let manualPaused = document.documentElement.classList.contains("motion-paused");
  reducedQuery.addEventListener("change", (event) => { reduced = event.matches; });
  /* The storefront's PAUSE MOTION control is shared by every animated surface;
     the deck's platter and the room's idle drift answer it too. */
  document.addEventListener("motion-toggle", (event) => {
    manualPaused = !!(event.detail && event.detail.paused);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.playing) pauseAudio();
  });

  const isReleased = (beat) => !HELPERS.isReleased || HELPERS.isReleased(beat);
  const isLocked = (beatId) => !!(HELPERS.isExclusiveLocked && HELPERS.isExclusiveLocked(beatId));
  const isOwned = (beatId) => !!(HELPERS.isExclusiveOwned && HELPERS.isExclusiveOwned(beatId));
  const shortTitle = (beat) => beat.shortTitle || String(beat.title || "").replace(/^\[FREE 100%\]\s*/i, "");
  const specLine = (beat) => `${beat.bpm} BPM // ${String(beat.key || "").toUpperCase()} // TAGGED AUDIO`;
  const countdown = (beat) => (HELPERS.msUntilRelease && HELPERS.formatCountdown)
    ? HELPERS.formatCountdown(HELPERS.msUntilRelease(beat))
    : "";

  /* ------------------------------------------------------------------ state */
  const state = {
    ready: false,
    view: "wide",
    selected: -1,
    listening: false,
    playing: false,
    peeled: false,
    hovered: -1,
    dragging: false,
    booted: false,
    fps: 0,
    frames: 0,
    tearDrag: false,
    tearStartX: 0,
    tearStartY: 0,
    tearStartT: 0,
  };

  let renderer = null;
  let scene = null;
  let camera = null;
  let compact = false;
  let lowPower = false;
  let frameSkip = false;

  /* --------------------------------------------------------------- utilities */
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  function canvasTexture(width, height, paint) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    paint(canvas.getContext("2d"), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  function textTexture(text, width, height, size) {
    return canvasTexture(width, height, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const font = "700 " + size + "px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      ctx.font = font;
      /* Manual tracking keeps the wordmark airy in every engine (canvas
         `letterSpacing` is not universal). */
      const tracking = size * 0.16;
      const chars = Array.from(text);
      const widths = chars.map((ch) => ctx.measureText(ch).width);
      const total = widths.reduce((sum, value) => sum + value, 0) + tracking * (chars.length - 1);
      let x = (w - total) / 2;
      chars.forEach((ch, i) => {
        ctx.fillText(ch, x + widths[i] / 2, h / 2);
        x += widths[i] + tracking;
      });
    });
  }

  /* ------------------------------------------------------- surface detail maps
     The room never ships a flat sleeve or a painted record. Every gloss surface
     gets a real tangent-space normal map generated here (grooves for the disc,
     a fine paper tooth for the jacket) plus a physical clearcoat layer, so the
     highlight travels across the object as it turns instead of sitting on a
     flat raster. The maps are data, never colour: the store stays monochrome. */
  function heightToNormal(size, height, strength) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = height(x + 1, y) - height(x - 1, y);
        const dy = height(x, y + 1) - height(x, y - 1);
        const nx = -dx * strength;
        const ny = -dy * strength;
        const nz = 1;
        const len = Math.hypot(nx, ny, nz) || 1;
        const i = (y * size + x) * 4;
        image.data[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
        image.data[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
        image.data[i + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.anisotropy = 8;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    return texture;
  }

  /* Concentric micro-grooves, denser toward the rim, plus the fine lathe haze
     a real pressing carries between tracks. */
  function makeGrooveNormal(size) {
    const half = size / 2;
    return heightToNormal(size, (x, y) => {
      const nx = (x - half) / half;
      const ny = (y - half) / half;
      const r = Math.min(1, Math.hypot(nx, ny));
      const groove = Math.sin(r * size * 0.62) * 0.5;
      const lathe = Math.sin(r * size * 0.11 + 1.7) * 0.35;
      const fringe = Math.sin((x * 0.9 + y * 0.6) * 0.55) * 0.18;
      return (groove + lathe) * (0.25 + r * 0.75) + fringe;
    }, 0.55);
  }

  function makePaperNormal(size) {
    return heightToNormal(size, (x, y) => {
      const a = Math.sin(x * 1.7 + Math.cos(y * 0.11) * 3);
      const b = Math.sin(y * 2.3 + Math.cos(x * 0.13) * 2);
      const c = Math.sin((x + y) * 0.37);
      return (a + b + c) * 0.09;
    }, 0.4);
  }

  /* One material factory for every glossy surface in the room. A software
     rasteriser gets the Standard fallback (same lighting, no clearcoat cost);
     a GPU gets the layered Physical response. */
  function glossMaterial(options) {
    const base = Object.assign({
      color: 0xffffff,
      metalness: 0.04,
      roughness: 0.46,
      envMapIntensity: 0.9,
    }, options || {});
    const clearcoat = base.clearcoat;
    const clearcoatRoughness = base.clearcoatRoughness;
    delete base.clearcoat;
    delete base.clearcoatRoughness;
    if (lowPower) return new THREE.MeshStandardMaterial(base);
    return new THREE.MeshPhysicalMaterial(Object.assign({}, base, {
      clearcoat: clearcoat === undefined ? 0.75 : clearcoat,
      clearcoatRoughness: clearcoatRoughness === undefined ? 0.18 : clearcoatRoughness,
    }));
  }

  /* --------------------------------------------------------------- boot gate */
  /* The preloader waits on the hero's flower, and that flower is the page's
     first WebGL job. The room therefore builds only once the veil has lifted:
     a second scene compiling while the flower initialises would stretch the
     load and starve both. A page without the preloader starts immediately. */
  let veilLifted = !document.getElementById("preloader") || !document.documentElement.classList.contains("preloader-armed");
  document.addEventListener("kyrolll:preloader-done", () => {
    veilLifted = true;
    if (state.visible && !state.booted) boot();
  });

  const io = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    if (entry.isIntersecting && !state.booted && veilLifted) boot();
    state.visible = entry.isIntersecting;
    if (!entry.isIntersecting && state.playing) pauseAudio();
  }, { threshold: 0.02 });
  io.observe(room);

  function detectLowPower() {
    try {
      const probe = document.createElement("canvas");
      const gl = probe.getContext("webgl2") || probe.getContext("webgl");
      if (!gl) return true;
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    } catch (error) {
      return true;
    }
  }

  function boot() {
    if (state.booted) return;
    state.booted = true;
    lowPower = detectLowPower();
    try {
      initThree();
    } catch (error) {
      room.classList.add("room--fallback");
      if (fallbackLink) fallbackLink.hidden = false;
      return;
    }
  }

  /* ------------------------------------------------------------------ scene */
  let shelfRoot = null;
  let frameGroup = null;
  let records = [];
  let deckGroup = null;
  let spinGroup = null;
  let platterDisc = null;
  let armPivot = null;
  let wrap = null;
  let wallDecal = null;
  let flowerTexture = null;
  let vinylTexture = null;
  let labelTexture = null;
  let grooveNormal = null;
  let paperNormal = null;
  let ringLevel = 0;
  let levelTarget = 0;

  const envMap = { texture: null };
  const clock = { last: 0, elapsed: 0 };

  function initThree() {
    const width = Math.max(1, stageEl.clientWidth || room.clientWidth || 1);
    const height = Math.max(1, stageEl.clientHeight || room.clientHeight || 1);
    compact = width < 760 || width / height < 0.95;

    renderer = new THREE.WebGLRenderer({
      antialias: !lowPower,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.setAttribute("aria-label", "KYROIII vinyl room — drag to look, select a record with the arrow keys and Enter");
    renderer.domElement.setAttribute("role", "application");
    renderer.domElement.tabIndex = 0;
    stageEl.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.075);

    camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 60);

    envMap.texture = buildEnvironment(renderer);
    scene.environment = envMap.texture;

    const loader = new THREE.TextureLoader();
    flowerTexture = loader.load("assets/kyrolll-flower-rest.png?v=5");
    flowerTexture.colorSpace = THREE.SRGBColorSpace;
    vinylTexture = loader.load("assets/vinyl-classic.png?v=3");
    vinylTexture.colorSpace = THREE.SRGBColorSpace;
    vinylTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    /* The photographed pressing's centre label is its own tan print; the
       store's record always carries the black flower plate instead (see the
       catalogue's vinyl), so every disc in the room is assembled from the same
       two pieces: the photograph plus that plate. */
    labelTexture = loader.load("assets/kyrolll-flower-label.png?v=3");
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    labelTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    grooveNormal = makeGrooveNormal(lowPower ? 256 : 512);
    paperNormal = makePaperNormal(lowPower ? 128 : 256);

    buildRoom();
    buildShelf();
    buildDeck();
    buildRecords(loader);
    layoutRecords();
    buildWrap();

    attachEvents();
    resize();
    /* Start on the wide room, then ease in once the covers are on the sleeves. */
    applyCamera("wide", true);
    renderer.render(scene, camera);
    updatePixelRatio();
    room.classList.add("is-ready");
    state.ready = true;
    clock.last = performance.now();
    requestAnimationFrame(frame);
    window.KYROlll_ROOM = { ready: true, state, select, listen, eject, close, screenPoint, stats };
  }

  function buildEnvironment(engine) {
    const texture = canvasTexture(512, 256, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "#030303");
      grad.addColorStop(0.34, "#151515");
      grad.addColorStop(0.46, "#3d3d3d");
      grad.addColorStop(0.62, "#121212");
      grad.addColorStop(1, "#020202");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      const hotspot = ctx.createRadialGradient(w * 0.28, h * 0.42, 2, w * 0.28, h * 0.42, h * 0.42);
      hotspot.addColorStop(0, "rgba(255,255,255,0.95)");
      hotspot.addColorStop(0.2, "rgba(255,255,255,0.34)");
      hotspot.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hotspot;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(0, Math.round(h * 0.3), w, 2);
    });
    texture.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(engine);
    const target = pmrem.fromEquirectangular(texture);
    pmrem.dispose();
    texture.dispose();
    return target.texture;
  }

  const metalMat = () => new THREE.MeshStandardMaterial({ color: 0x101010, metalness: 0.78, roughness: 0.34 });
  const darkMat = () => new THREE.MeshStandardMaterial({ color: 0x070707, roughness: 0.62, metalness: 0.28 });
  const silverMat = () => new THREE.MeshStandardMaterial({ color: 0x8d8d8d, metalness: 0.95, roughness: 0.3 });

  function buildRoom() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.52, metalness: 0.12 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    scene.add(floor);

    const pool = canvasTexture(512, 512, (ctx, w, h) => {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, "rgba(255,255,255,0.13)");
      grad.addColorStop(0.35, "rgba(255,255,255,0.045)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    });
    const poolMesh = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 8.5), new THREE.MeshBasicMaterial({ map: pool, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    poolMesh.rotation.x = -Math.PI / 2;
    poolMesh.position.set(-0.3, 0.003, 0.4);
    scene.add(poolMesh);

    const wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 7), new THREE.MeshStandardMaterial({ color: 0x040404, roughness: 0.94, metalness: 0.04 }));
    wall.position.set(0, 3, -1.72);
    scene.add(wall);

    const slatMat = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.72, metalness: 0.08 });
    const slatGeometry = new THREE.BoxGeometry(0.055, 4.4, 0.06);
    for (let i = 0; i < 18; i += 1) {
      const slat = new THREE.Mesh(slatGeometry, slatMat);
      slat.position.set(-4.3 + i * 0.5, 2.1, -1.66);
      scene.add(slat);
    }

    /* A vertical light seam on each side of the frame gives the black room an
       edge without a second coloured source. */
    const seamMat = new THREE.MeshBasicMaterial({ color: 0xb9bdc2, toneMapped: false });
    [-3.5, 3.3].forEach((x) => {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.014, 2.9, 0.014), seamMat);
      seam.position.set(x, 2.05, -1.6);
      scene.add(seam);
    });

    const ambient = new THREE.HemisphereLight(0xc7cbd1, 0x000000, 0.26);
    scene.add(ambient);

    const rim = new THREE.DirectionalLight(0xffffff, 0.9);
    rim.position.set(-4.5, 3.4, -2.4);
    scene.add(rim);

    const key = new THREE.SpotLight(0xffffff, 130, 14, Math.PI / 4.6, 0.78, 1.35);
    key.position.set(1.1, 4.1, 2.9);
    key.target.position.set(-0.5, 1.2, -0.8);
    scene.add(key, key.target);

    const wash = new THREE.SpotLight(0xffffff, 80, 12, Math.PI / 3.6, 0.9, 1.4);
    wash.position.set(-2.1, 3.4, 2.2);
    wash.target.position.set(-1.1, 1.1, -0.9);
    scene.add(wash, wash.target);

    const tableGlow = new THREE.PointLight(0xffffff, 7.5, 5.5, 1.6);
    tableGlow.position.set(1.9, 1.8, 1.9);
    scene.add(tableGlow);

    wallDecal = new THREE.Group();
    const decalMat = new THREE.MeshBasicMaterial({ map: flowerTexture, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.92 });
    const flower = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), decalMat);
    flower.position.set(0, 0.34, 0);
    wallDecal.add(flower);
    wallDecal.position.set(1.2, 2.9, -1.64);
    scene.add(wallDecal);
  }

  /* ------------------------------------------------------------------ shelf */
  function shelfMetrics() {
    const cols = compact ? 2 : 4;
    const rows = compact ? 4 : 2;
    const slotW = 0.84;
    const slotH = 0.86;
    return {
      cols,
      rows,
      slotW,
      slotH,
      width: cols * slotW + 0.12,
      height: rows * slotH + 0.12,
      x: compact ? -0.35 : -1.05,
      y: compact ? 1.98 : 1.16,
      z: -0.92,
    };
  }

  function buildShelf() {
    const m = shelfMetrics();
    if (!shelfRoot) {
      shelfRoot = new THREE.Group();
      scene.add(shelfRoot);
    }
    shelfRoot.position.set(m.x, 0, m.z);
    /* Only the frame is rebuilt when the room changes layout. The record groups
       (and the shrink-wrap child of the newest one) are re-parented untouched,
       so a responsive rebuild can never dispose their geometry. */
    if (frameGroup) {
      shelfRoot.remove(frameGroup);
      frameGroup.traverse((node) => {
        if (node.isMesh && node.geometry) node.geometry.dispose();
      });
    }
    frameGroup = new THREE.Group();
    shelfRoot.add(frameGroup);

    const frameMat = metalMat();
    const addBox = (w, h, d, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
      mesh.position.set(x, y, z);
      frameGroup.add(mesh);
      return mesh;
    };

    addBox(m.width, m.height, 0.02, 0, m.y, -0.2);                 // back
    addBox(0.022, m.height, 0.44, -m.width / 2, m.y, 0);           // sides
    addBox(0.022, m.height, 0.44, m.width / 2, m.y, 0);
    for (let row = 0; row <= m.rows; row += 1) {
      const y = m.y - m.height / 2 + row * m.slotH + 0.06;
      addBox(m.width, row === 0 || row === m.rows ? 0.028 : 0.016, 0.42, 0, y, 0);
    }
    for (let col = 0; col <= m.cols; col += 1) {
      const x = -m.width / 2 + col * m.slotW + 0.06;
      addBox(0.014, m.height, 0.36, x, m.y, 0);
    }
    addBox(m.width + 0.08, 0.12, 0.5, 0, m.y - m.height / 2 - 0.06, 0); // base

    /* The warm-white light strips under each shelf are the only thing painting
       the records; a real light per slot would be too many draws. */
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xd7dade, toneMapped: false });
    for (let row = 0; row < m.rows; row += 1) {
      const y = m.y + m.height / 2 - row * m.slotH - m.slotH - 0.02;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(m.width - 0.18, 0.008, 0.016), stripMat);
      strip.position.set(0, y, 0.19);
      frameGroup.add(strip);
    }

    layoutRecords(m);
  }

  function layoutRecords(m) {
    if (!records.length) return;
    const metrics = m || shelfMetrics();
    const left = -metrics.width / 2 + 0.06 + metrics.slotW / 2;
    const top = metrics.y + metrics.height / 2 - 0.06 - metrics.slotH / 2;
    records.forEach((record, index) => {
      const col = index % metrics.cols;
      const row = Math.floor(index / metrics.cols);
      const home = new THREE.Vector3(left + col * metrics.slotW, top - row * metrics.slotH, 0.02);
      record.home = home.clone();
      record.group.position.copy(home);
      record.group.rotation.set(-0.05, 0, (index % 3 - 1) * 0.012);
    });
    if (wallDecal) {
      wallDecal.visible = !compact;
      wallDecal.position.y = metrics.y + metrics.height / 2 + 0.62;
      wallDecal.position.x = 1.2;
    }
  }

  function buildRecords(loader) {
    const coverGeo = new THREE.BoxGeometry(0.66, 0.66, 0.026);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x070707, roughness: 0.5, metalness: 0.34 });
    const backMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.62, metalness: 0.12 });

    records = BEATS.map((beat, index) => {
      const group = new THREE.Group();
      group.userData.index = index;

      /* The jacket is laminated card stock: a physical clearcoat over the cover
         print, with a fine paper tooth normal map underneath. The behaviour is
         the same on every sleeve — only the supplied art differs. */
      const coverMat = glossMaterial({
        color: 0x101010,
        roughness: 0.42,
        metalness: 0.02,
        envMapIntensity: 0.8,
        clearcoat: 0.9,
        clearcoatRoughness: 0.2,
        normalMap: paperNormal,
        normalScale: new THREE.Vector2(0.22, 0.22),
      });
      const cover = new THREE.Mesh(coverGeo, [edgeMat, edgeMat, edgeMat, edgeMat, coverMat, backMat]);
      group.add(cover);

      /* A thin machined edge catches the key light and separates the sleeve
         from the black shelf behind it. */
      const rim = new THREE.Mesh(
        new THREE.BoxGeometry(0.668, 0.668, 0.006),
        new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.28, metalness: 0.85 })
      );
      rim.position.z = 0.002;
      group.add(rim);

      const disc = makeVinylDisc(0.315);
      disc.position.set(0.17, 0, -0.036);
      group.add(disc);

      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(coverGeo), new THREE.LineBasicMaterial({ color: 0x6a6a6a, transparent: true, opacity: 0.4 }));
      group.add(edge);

      shelfRoot.add(group);

      const record = { beat, index, group, cover, coverMat, disc, edge, lift: 0, targetLift: 0, home: new THREE.Vector3() };

      loader.load(beat.img, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        coverMat.map = texture;
        coverMat.needsUpdate = true;
      }, undefined, () => { /* a missing cover stays a black sleeve */ });

      return record;
    });
  }

  /* ---------------------------------------------------------------- shrink
     A premium shrink-wrap is a stack, not one translucent box: a clearcoat
     film with a crinkle normal map, a crimped seam around the perimeter, a
     printed seal and a pull tab. The film is split down a jagged tear line
     into two halves, so the peel opens from the middle like a real sealed
     sleeve instead of fading a single sheet away. */
  function tearMask(side) {
    return canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      for (let y = 0; y <= h; y += 6) {
        const x = w / 2 + Math.sin(y * 0.11) * 6 + Math.sin(y * 0.37) * 2.5;
        ctx.lineTo(x, y);
      }
      if (side === "left") {
        ctx.lineTo(0, h);
        ctx.lineTo(0, 0);
      } else {
        ctx.lineTo(w, h);
        ctx.lineTo(w, 0);
      }
      ctx.closePath();
      ctx.fill();
    });
  }

  function buildWrap() {
    if (!records.length) return;
    const group = new THREE.Group();
    group.position.set(0, 0, 0.026);

    const crinkle = heightToNormal(256, (x, y) => {
      const a = Math.sin(x * 0.19 + y * 0.13) * 0.5;
      const b = Math.sin(x * 0.06 - y * 0.27) * 0.4;
      const c = Math.sin(x * 0.41 + y * 0.05) * 0.16;
      const d = Math.cos(x * 0.03 + y * 0.09) * 0.35;
      return a + b + c + d;
    }, 0.85);

    const filmOptions = (mask) => ({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.045,
      transparent: true,
      opacity: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.015,
      envMapIntensity: 3.1,
      normalMap: crinkle,
      normalScale: new THREE.Vector2(0.4, 0.4),
      alphaMap: mask,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const leftGeo = new THREE.PlaneGeometry(0.696, 0.696);
    leftGeo.translate(0.348, 0, 0);
    const rightGeo = new THREE.PlaneGeometry(0.696, 0.696);
    rightGeo.translate(-0.348, 0, 0);

    const leftMat = glossMaterial(filmOptions(tearMask("left")));
    const rightMat = glossMaterial(filmOptions(tearMask("right")));
    const filmL = new THREE.Mesh(leftGeo, leftMat);
    filmL.position.set(-0.348, 0, 0);
    filmL.renderOrder = 3;
    group.add(filmL);
    const filmR = new THREE.Mesh(rightGeo, rightMat);
    filmR.position.set(0.348, 0, 0);
    filmR.renderOrder = 3;
    group.add(filmR);

    const tearLine = new THREE.Mesh(
      new THREE.PlaneGeometry(0.004, 0.69),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, toneMapped: false, depthWrite: false })
    );
    tearLine.position.z = 0.004;
    group.add(tearLine);

    const seams = [];
    const addSeam = (w, h, x, y) => {
      const seam = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, 0.06),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.46, toneMapped: false })
      );
      seam.position.set(x, y, 0);
      group.add(seam);
      seams.push(seam);
    };
    addSeam(0.006, 0.692, -0.346, 0);
    addSeam(0.006, 0.692, 0.346, 0);
    addSeam(0.692, 0.006, 0, 0.346);
    addSeam(0.692, 0.006, 0, -0.346);

    const stickerTexture = canvasTexture(320, 176, (ctx, w, h) => {
      ctx.fillStyle = "rgba(10,10,10,0.9)";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 3;
      ctx.strokeRect(7, 7, w - 14, h - 14);
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 36px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      ctx.fillText("SEALED", w / 2, h * 0.36);
      ctx.font = "700 20px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.62)";
      ctx.fillText("KYROIII", w / 2, h * 0.6);
      ctx.font = "700 13px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      ctx.fillText("PULL TO OPEN", w / 2, h * 0.8);
    });
    const sticker = new THREE.Mesh(
      new THREE.PlaneGeometry(0.23, 0.127),
      new THREE.MeshBasicMaterial({ map: stickerTexture, transparent: true, toneMapped: false })
    );
    sticker.position.set(0.19, -0.255, 0.034);
    group.add(sticker);

    const tabTexture = canvasTexture(160, 64, (ctx, w, h) => {
      ctx.fillStyle = "rgba(245,245,245,0.94)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 22px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      ctx.fillText("PULL", w / 2, h / 2);
    });
    const tab = new THREE.Mesh(
      new THREE.PlaneGeometry(0.13, 0.052),
      new THREE.MeshBasicMaterial({ map: tabTexture, toneMapped: false, side: THREE.DoubleSide })
    );
    tab.position.set(0.27, 0.3, 0.036);
    tab.rotation.z = -0.12;
    group.add(tab);

    /* Parented to the newest sleeve so the seal lifts and leans with it. */
    records[0].group.add(group);
    wrap = {
      group, filmL, filmR, leftMat, rightMat, tearLine, seams, sticker, tab,
      t: 0, peeling: false, started: 0,
    };
  }

  function peel() {
    if (!wrap || wrap.peeling || state.peeled) return;
    wrap.peeling = true;
    wrap.started = performance.now();
    room.classList.add("is-tearing");
    if (reduced) { finishPeel(); return; }
  }

  function finishPeel() {
    if (!wrap) return;
    wrap.peeling = false;
    state.tearDrag = false;
    wrap.group.visible = false;
    state.peeled = true;
    room.classList.remove("is-tearing");
    room.classList.add("is-unsealed");
    if (state.selected === 0 && !card.hidden) {
      if (cardKicker) cardKicker.textContent = "LATEST DROP — UNSEALED";
      paintStatus(BEATS[0], 0);
    }
  }

  /* One disc = the photographed pressing + the original flower label plate,
     exactly the record the beat page shows. The realism comes from three
     stacked layers rather than a flat raster: a physical vinyl base carrying
     the photographed surface, a generated micro-groove normal map that lets
     the environment slide across the playing surface, a machined rim torus for
     the edge specular, and the printed label plate on top. */
  function makeVinylDisc(radius) {
    const group = new THREE.Group();

    const discMat = glossMaterial({
      map: vinylTexture,
      transparent: true,
      alphaTest: 0.5,
      roughness: 0.26,
      metalness: 0.08,
      envMapIntensity: 1.5,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      normalMap: grooveNormal,
      normalScale: new THREE.Vector2(0.4, 0.4),
      side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), discMat);
    group.add(disc);

    /* A second, purely specular pass: the wet-looking sheen that sits over a
       black pressing under a hard light. It is additive and never writes depth,
       so it can only brighten the record, never tint it. */
    const sheen = canvasTexture(256, 256, (ctx, w, h) => {
      const grad = ctx.createRadialGradient(w * 0.5, h * 0.42, w * 0.05, w * 0.5, h * 0.5, w * 0.5);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.38, "rgba(255,255,255,0.02)");
      grad.addColorStop(0.58, "rgba(255,255,255,0.2)");
      grad.addColorStop(0.63, "rgba(255,255,255,0.03)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    });
    const sheenMesh = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.995, 96),
      new THREE.MeshBasicMaterial({ map: sheen, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.7 })
    );
    sheenMesh.position.z = 0.0008;
    group.add(sheenMesh);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.988, radius * 0.011, 8, 96),
      new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.22, metalness: 0.95 })
    );
    group.add(rim);

    const label = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.3, 64),
      glossMaterial({ map: labelTexture, roughness: 0.42, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 0.6 })
    );
    label.position.z = 0.0014;
    group.add(label);

    return group;
  }

  /* ------------------------------------------------------------------- deck */
  function buildDeck() {
    deckGroup = new THREE.Group();
    deckGroup.position.set(1.78, 0, 0.95);
    deckGroup.rotation.y = -0.4;
    scene.add(deckGroup);

    const consoleMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.6, metalness: 0.3 });
    const consoleBody = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.72, 1.26), consoleMat);
    consoleBody.position.y = 0.36;
    deckGroup.add(consoleBody);

    const consoleTop = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.035, 1.34), new THREE.MeshStandardMaterial({ color: 0x0b0b0b, metalness: 0.85, roughness: 0.4 }));
    consoleTop.position.y = 0.735;
    deckGroup.add(consoleTop);

    const trim = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.006, 1.36), new THREE.MeshBasicMaterial({ color: 0x8d8d8d, toneMapped: false }));
    trim.position.y = 0.754;
    deckGroup.add(trim);

    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.1, 1.04), new THREE.MeshStandardMaterial({ color: 0x070707, metalness: 0.5, roughness: 0.5 }));
    plinth.position.y = 0.805;
    deckGroup.add(plinth);

    const topPlate = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.014, 0.98), new THREE.MeshStandardMaterial({ color: 0x191919, metalness: 0.9, roughness: 0.3 }));
    topPlate.position.y = 0.861;
    deckGroup.add(topPlate);

    const well = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.018, 64), darkMat());
    well.position.y = 0.872;
    deckGroup.add(well);

    const platter = new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.03, 64), new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0.8, roughness: 0.3 }));
    platter.position.y = 0.886;
    deckGroup.add(platter);

    const mat = new THREE.Mesh(new THREE.CylinderGeometry(0.455, 0.455, 0.006, 64), new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.9, metalness: 0.05 }));
    mat.position.y = 0.903;
    deckGroup.add(mat);

    spinGroup = new THREE.Group();
    spinGroup.position.y = 0.907;
    spinGroup.rotation.x = -Math.PI / 2;
    deckGroup.add(spinGroup);
    platterDisc = makeVinylDisc(0.4);
    platterDisc.rotation.z = 0.4;
    spinGroup.add(platterDisc);
    platterDisc.visible = false;

    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 16), silverMat());
    spindle.position.y = 0.93;
    deckGroup.add(spindle);

    /* Flower etched flat into the chassis, plus the wordmark on the front
       face — the two brand marks the deck wears. */
    const flower = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      new THREE.MeshBasicMaterial({ map: flowerTexture, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.88 })
    );
    flower.rotation.x = -Math.PI / 2;
    flower.position.set(-0.42, 0.871, -0.1);
    deckGroup.add(flower);

    const frontMark = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.09),
      new THREE.MeshBasicMaterial({ map: textTexture("KYROIII", 512, 72, 52), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.92 })
    );
    frontMark.position.set(0, 0.81, 0.526);
    deckGroup.add(frontMark);

    /* The chassis is a fixed 33 RPM deck: no pitch fader. A machined blank
       plate keeps the deck's face balanced where the fader used to sit. */
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.006, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.32, metalness: 0.9 })
    );
    plate.position.set(-0.52, 0.873, 0.14);
    deckGroup.add(plate);

    /* Tonearm: base, pillar, counterweight, tube and headshell. */
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.09, 0.03, 32), metalMat());
    base.position.set(0.56, 0.874, -0.36);
    deckGroup.add(base);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.15, 24), silverMat());
    pillar.position.set(0.56, 0.955, -0.36);
    deckGroup.add(pillar);

    armPivot = new THREE.Group();
    armPivot.position.set(0.56, 1.02, -0.36);
    armPivot.rotation.y = -1.32;
    deckGroup.add(armPivot);

    const armTube = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.016, 0.016), silverMat());
    armTube.position.x = 0.31;
    armPivot.add(armTube);

    const counter = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.05, 24), metalMat());
    counter.rotation.z = Math.PI / 2;
    counter.position.x = -0.17;
    armPivot.add(counter);

    const head = new THREE.Group();
    head.position.set(0.6, -0.02, 0);
    head.rotation.z = -0.14;
    armPivot.add(head);
    const headshell = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.022, 0.05), metalMat());
    headshell.position.x = 0.03;
    head.add(headshell);
    const cartridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.018, 0.032), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.3, roughness: 0.55 }));
    cartridge.position.set(0.04, -0.019, 0);
    head.add(cartridge);
    const stylus = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.001, 0.02, 8), silverMat());
    stylus.position.set(0.045, -0.038, 0);
    head.add(stylus);

    const armLift = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.07, 0.03), metalMat());
    armLift.position.set(0.71, 0.92, 0.24);
    deckGroup.add(armLift);
  }

  /* ----------------------------------------------------------------- camera */
  const cameraState = {
    pos: new THREE.Vector3(),
    target: new THREE.Vector3(),
    fromPos: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
    start: 0,
    duration: 0,
    active: false,
    parallaxX: 0,
    parallaxY: 0,
    wantX: 0,
    wantY: 0,
  };

  function cameraPreset(kind) {
    const aspect = camera.aspect;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const fit = (worldW, worldH) => Math.max(
      (worldH / 2) / Math.tan(vFov / 2),
      (worldW / 2) / (Math.tan(vFov / 2) * aspect)
    );

    if (kind === "deck") {
      /* Aim below the plinth so the deck rides above the chassis control strip
         rather than sitting underneath it. */
      const target = new THREE.Vector3(1.78, 0.74, 0.95);
      const dir = new THREE.Vector3(0.2, 0.5, 1).normalize();
      const distance = fit(compact ? 1.9 : 2.5, 1.2) + (compact ? 0.2 : 0.3);
      return { target, pos: target.clone().add(dir.multiplyScalar(distance)) };
    }

    const target = new THREE.Vector3(compact ? -0.3 : 0.18, compact ? 2.05 : 1.45, -0.35);
    const dir = new THREE.Vector3(0.03, compact ? 0.3 : 0.24, 1).normalize();
    const distance = fit(compact ? 2.5 : 7.4, compact ? 4.3 : 3.2) + 0.35;
    return { target, pos: target.clone().add(dir.multiplyScalar(distance)) };
  }

  function applyCamera(kind, instant) {
    const preset = cameraPreset(kind);
    state.view = kind;
    room.classList.toggle("is-deck-view", kind === "deck");
    if (instant || reduced) {
      cameraState.active = false;
      cameraState.pos.copy(preset.pos);
      cameraState.target.copy(preset.target);
      camera.position.copy(preset.pos);
      camera.lookAt(preset.target);
      return;
    }
    cameraState.fromPos.copy(cameraState.pos);
    cameraState.fromTarget.copy(cameraState.target);
    cameraState.toPos.copy(preset.pos);
    cameraState.toTarget.copy(preset.target);
    cameraState.start = performance.now();
    cameraState.duration = 1.5;
    cameraState.active = true;
  }

  function updateCamera(dt) {
    if (cameraState.active) {
      const t = clamp((performance.now() - cameraState.start) / (cameraState.duration * 1000), 0, 1);
      const e = easeInOut(t);
      cameraState.pos.lerpVectors(cameraState.fromPos, cameraState.toPos, e);
      cameraState.target.lerpVectors(cameraState.fromTarget, cameraState.toTarget, e);
      if (t >= 1) cameraState.active = false;
    }
    cameraState.parallaxX += (cameraState.wantX - cameraState.parallaxX) * Math.min(1, dt * 4);
    cameraState.parallaxY += (cameraState.wantY - cameraState.parallaxY) * Math.min(1, dt * 4);
    const drift = reduced || manualPaused ? 0 : Math.sin(clock.elapsed * 0.24) * 0.02;
    camera.position.copy(cameraState.pos);
    camera.position.x += cameraState.parallaxX * 0.11 + drift;
    camera.position.y += -cameraState.parallaxY * 0.05;
    camera.lookAt(cameraState.target);
  }

  /* ------------------------------------------------------------------ frame */
  function frame(now) {
    requestAnimationFrame(frame);
    if (!state.visible || document.hidden || !renderer) return;
    /* A software rasteriser can take >200 ms a frame; the animation clock
       follows real time so the record still lands and the arm still drops in
       roughly a second, instead of playing in slow motion. */
    const dt = Math.min(0.2, (now - clock.last) / 1000 || 0.016);
    clock.last = now;
    clock.elapsed += dt;

    if (lowPower) {
      frameSkip = !frameSkip;
      if (frameSkip) return;
    }

    updateCamera(dt);
    updateRecords(dt);
    updateWrap();
    updateDeck(dt);
    updateLevel();

    renderer.render(scene, camera);
    state.frames += 1;
  }

  function updateRecords(dt) {
    for (const record of records) {
      record.lift += (record.targetLift - record.lift) * Math.min(1, dt * 9);
      if (record.group.position) {
        record.group.position.z = record.home.z + record.lift * 0.1;
        record.group.position.y = record.home.y + record.lift * 0.02;
      }
    }
  }

  function updateWrap() {
    if (!wrap || !wrap.peeling) return;
    /* Wall-clock progress, unless a finger is scrubbing the tear: then the
       pointer drives `t` directly and the clock is re-based on release. A slow
       renderer must never turn the peel into a slideshow. */
    if (!state.tearDrag) {
      wrap.t = clamp((performance.now() - wrap.started) / 1600, 0, 1);
    }
    const t = easeInOut(wrap.t);

    /* The two halves tear apart and curl away from the middle seam. */
    wrap.filmL.rotation.y = -1.25 * t;
    wrap.filmL.rotation.z = 0.24 * t;
    wrap.filmL.position.x = -0.348 - 0.3 * t;
    wrap.filmL.position.y = 0.16 * t;
    wrap.filmL.position.z = 0.12 * t;
    wrap.filmR.rotation.y = 1.25 * t;
    wrap.filmR.rotation.z = -0.24 * t;
    wrap.filmR.position.x = 0.348 + 0.3 * t;
    wrap.filmR.position.y = 0.16 * t;
    wrap.filmR.position.z = 0.12 * t;

    const fade = 1 - Math.max(0, (t - 0.35) / 0.65);
    wrap.leftMat.opacity = 0.3 * fade;
    wrap.rightMat.opacity = 0.3 * fade;

    /* The tear itself catches the light first, then vanishes with the film. */
    wrap.tearLine.material.opacity = Math.sin(Math.min(1, wrap.t * 1.8) * Math.PI) * 0.95;
    wrap.tearLine.scale.y = 1 + t * 0.12;

    wrap.sticker.rotation.z = -0.6 * t;
    wrap.sticker.rotation.x = 0.5 * t;
    wrap.sticker.position.y = -0.255 + 0.2 * t;
    wrap.sticker.position.z = 0.034 + 0.14 * t;
    wrap.tab.rotation.z = -0.12 - 0.8 * t;
    wrap.tab.position.x = 0.27 + 0.12 * t;
    wrap.tab.position.y = 0.3 + 0.16 * t;
    wrap.seams.forEach((seam) => {
      seam.material.opacity = 0.46 * fade;
      seam.position.z = 0.02 * t;
    });
    if (wrap.t >= 1) finishPeel();
  }

  const deck = { arm: 0, armTarget: 0, armFrom: 0, armStart: 0, spin: 0, flight: null, flying: false };

  function setArm(target) {
    if (target === deck.armTarget) return;
    deck.armTarget = target;
    deck.armFrom = deck.arm;
    deck.armStart = performance.now();
  }

  function updateDeck(dt) {
    if (deck.arm !== deck.armTarget) {
      const t = clamp((performance.now() - deck.armStart) / (reduced ? 120 : 620), 0, 1);
      deck.arm = deck.armFrom + (deck.armTarget - deck.armFrom) * easeInOut(t);
      if (t >= 1) deck.arm = deck.armTarget;
    }
    if (armPivot) armPivot.rotation.y = REST_ARM + deck.arm * (PLAY_ARM - REST_ARM);
    if (state.playing && spinGroup && !deck.flying && !reduced && !manualPaused) {
      /* A fixed 33⅓ RPM platter. The audio is never resampled: the record turns
         at the deck's speed and the preview plays at its native rate. */
      spinGroup.rotation.z -= dt * 3.491;
    } else if (spinGroup && !reduced && !manualPaused) {
      spinGroup.rotation.z -= dt * 0.06;
    }

    if (deck.flight) {
      const flight = deck.flight;
      flight.t = clamp((performance.now() - flight.started) / flight.duration, 0, 1);
      const e = easeInOut(flight.t);
      flight.group.position.copy(flight.curve.getPoint(e));
      flight.group.rotation.z = flight.spin0 + e * Math.PI * 2.6;
      flight.group.rotation.x = -Math.PI / 2 + Math.sin(e * Math.PI) * 0.5;
      const scale = 1 + Math.sin(e * Math.PI) * 0.12;
      flight.group.scale.setScalar(scale);
      if (flight.t >= 1) {
        deck.flying = false;
        scene.remove(flight.group);
        flight.group.traverse((node) => { if (node.isMesh) node.geometry.dispose(); });
        deck.flight = null;
        if (flight.arrive) flight.arrive();
      }
    }
  }

  /* ------------------------------------------------------------------ level */
  let analyser = null;
  let analyserData = null;
  let lastSpectrum = null;

  function updateLevel() {
    if (!analyser || !analyserData) return;
    if (!state.playing) {
      levelTarget = 0;
    } else {
      analyser.getByteFrequencyData(analyserData);
      if (!lastSpectrum) lastSpectrum = new Uint8Array(analyserData.length);
      let flux = 0;
      let bins = 24;
      for (let i = 1; i <= bins; i += 1) {
        const rise = analyserData[i] - lastSpectrum[i];
        if (rise > 0) flux += rise;
      }
      lastSpectrum.set(analyserData);
      levelTarget = clamp(flux / (bins * 32), 0, 1);
    }
    ringLevel += (levelTarget - ringLevel) * 0.18;
    if (deckEl) deckEl.style.setProperty("--room-level", ringLevel.toFixed(3));
  }

  /* ------------------------------------------------------------------ audio */
  /* One media element for the whole room, created once. The Web Audio graph
     only does gain and analysis: the preview is never resampled, never
     restarted and never re-fetched mid-play, so placing a record on the deck is
     a single buffered start with a click-free gain ramp instead of a cold
     range request. If Web Audio is unavailable the element still plays at a
     fixed volume — audio is never gated on the graph. */
  let audio = null;
  let audioContext = null;
  let gainNode = null;
  let pauseTimer = 0;
  let lastBarPercent = -1;
  let lastTimeText = "";

  function ensureAudio() {
    if (!audio) {
      audio = new Audio();
      audio.preload = "auto";
      audio.loop = true;
      audio.setAttribute("playsinline", "");
      audio.addEventListener("timeupdate", updateDeckProgress);
      audio.addEventListener("progress", updateDeckProgress);
      audio.addEventListener("play", () => { state.playing = true; updatePlayGlyph(); });
      audio.addEventListener("pause", () => { state.playing = false; updatePlayGlyph(); });
      audio.addEventListener("loadedmetadata", updateDeckProgress);
      audio.addEventListener("canplay", updateDeckProgress);
    }
    return audio;
  }

  function ensureGraph() {
    if (audioContext || !audio) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioContext = new Ctx({ latencyHint: "interactive" });
      gainNode = audioContext.createGain();
      gainNode.gain.value = 0;
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      analyserData = new Uint8Array(analyser.frequencyBinCount);
      /* Create the element source last: it may only ever be created once. */
      const source = audioContext.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(gainNode);
      gainNode.connect(audioContext.destination);
    } catch (error) {
      /* No graph means the element plays directly at its own volume. */
      analyser = null;
      gainNode = null;
    }
  }

  function setPreviewSource(beat) {
    const el = ensureAudio();
    if (!beat || !beat.preview) return el;
    if (el.dataset.src === beat.preview) return el;
    el.dataset.src = beat.preview;
    el.src = beat.preview;
    el.preload = "auto";
    try { el.load(); } catch (error) { /* the play() call will report it */ }
    return el;
  }

  /* Selection warms the preview without playing it, so the first tap on LISTEN
     opens from buffered bytes rather than a cold fetch. Never called while a
     record is playing (that would abort the stream). */
  function warmPreview(beat) {
    if (state.playing || !state.ready) return;
    setPreviewSource(beat);
  }

  function playAudio() {
    const el = ensureAudio();
    ensureGraph();
    window.clearTimeout(pauseTimer);
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    try { el.volume = 1; } catch (error) { /* iOS volume is read-only */ }
    if (gainNode && audioContext) {
      const now = audioContext.currentTime;
      const gain = gainNode.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(Math.max(0.0001, gain.value || 0.0001), now);
      gain.linearRampToValueAtTime(0.92, now + 0.35);
    }
    const started = el.play();
    if (started && started.catch) {
      started.catch(() => { state.playing = false; updatePlayGlyph(); });
    }
  }

  function pauseAudio() {
    state.playing = false;
    updatePlayGlyph();
    if (!audio || audio.paused) return;
    if (gainNode && audioContext) {
      const now = audioContext.currentTime;
      const gain = gainNode.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0.0001, now + 0.12);
      /* Let the ramp land before the element stops, so the stop is silent. */
      pauseTimer = window.setTimeout(() => {
        if (audio && !audio.paused) audio.pause();
      }, 140);
      return;
    }
    audio.pause();
  }

  function toggleAudio() {
    if (!state.listening) return;
    if (audio && !audio.paused) pauseAudio();
    else playAudio();
  }

  function updateDeckProgress() {
    if (!audio || !deckBar || !deckTime) return;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const percent = duration ? clamp(current / duration, 0, 1) * 100 : 0;
    /* `timeupdate` fires several times a second; only touch the DOM when a
       frame would actually look different. */
    if (Math.abs(percent - lastBarPercent) > 0.12) {
      lastBarPercent = percent;
      deckBar.style.width = percent.toFixed(2) + "%";
    }
    const text = formatTime(current) + " / " + (duration ? formatTime(duration) : "--:--");
    if (text !== lastTimeText) {
      lastTimeText = text;
      deckTime.textContent = text;
    }
  }

  function formatTime(value) {
    const total = Math.max(0, Math.floor(value));
    return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
  }

  function updatePlayGlyph() {
    if (!deckPlay) return;
    deckPlay.dataset.playing = state.playing ? "true" : "false";
    deckPlay.setAttribute("aria-label", state.playing ? "Pause the record" : "Play the record");
    deckPlay.setAttribute("aria-pressed", state.playing ? "true" : "false");
  }

  /* -------------------------------------------------------------- selection */
  function statusFor(beat, index) {
    if (isLocked(beat.id)) {
      return isOwned(beat.id)
        ? "EXCLUSIVE RIGHTS // PRIVATE MASTER — THIS PRESSING AND EVERY FILE ARE YOURS."
        : "EXCLUSIVE RIGHTS // ARCHIVED — THE ONE LICENSE FOR THIS BEAT HAS BEEN ISSUED.";
    }
    if (!isReleased(beat)) {
      return "DROPPING SOON — THE DECK AND THE FILES UNLOCK IN " + countdown(beat) + ".";
    }
    if (index === 0 && !state.peeled && wrap) {
      return "SEALED PRESSING — SELECT IT (OR DRAG THE FILM) TO TEAR THE SHRINK-WRAP.";
    }
    return "";
  }

  function paintStatus(beat, index) {
    if (!cardStatus) return;
    const text = statusFor(beat, index);
    cardStatus.textContent = text;
    cardStatus.hidden = !text;
  }

  function showCard(index) {
    const beat = BEATS[index];
    if (!beat) return;
    state.selected = index;
    hideTray();
    if (cardKicker) {
      cardKicker.textContent = index === 0
        ? (state.peeled ? "LATEST DROP — UNSEALED" : "LATEST DROP — SEALED")
        : "IN THE ROOM — " + String(index + 1).padStart(2, "0");
    }
    if (cardTitle) cardTitle.textContent = shortTitle(beat);
    if (cardSpecs) cardSpecs.textContent = specLine(beat);
    if (cardKicker && !isReleased(beat)) cardKicker.textContent = "DROPPING SOON — LOCKED";
    if (cardKicker && isLocked(beat.id)) cardKicker.textContent = isOwned(beat.id) ? "PRIVATE MASTER // YOURS" : "EXCLUSIVE RIGHTS // ARCHIVED";
    paintStatus(beat, index);
    card.hidden = false;
    room.classList.add("has-card");
    if (index === 0 && !state.peeled) peel();
    if (listenBtn) listenBtn.disabled = !isReleased(beat);
    if (downloadBtn) {
      downloadBtn.disabled = !isReleased(beat) || isLocked(beat.id);
      const label = downloadBtn.querySelector(".room-path__label");
      if (label) label.textContent = isLocked(beat.id) ? "ARCHIVED" : "FREE DOWNLOAD";
    }
    if (hintEl) hintEl.textContent = "LISTEN ON THE DECK OR TAKE THE FILES";
    records.forEach((record, i) => { record.targetLift = i === index ? 1 : 0; });
    warmPreview(beat);
  }

  function hideCard() {
    card.hidden = true;
    room.classList.remove("has-card");
    records.forEach((record) => { record.targetLift = 0; });
    if (hintEl) hintEl.textContent = "DRAG TO LOOK · SELECT A RECORD";
  }

  function close() {
    hideCard();
    hideTray();
    if (state.listening) eject();
  }

  function choose(index) {
    if (state.listening) return;
    if (state.selected === index && !card.hidden) return;
    showCard(index);
  }

  function select(index) {
    if (!state.ready || index < 0 || index >= BEATS.length) return;
    choose(index);
  }

  /* ------------------------------------------------------------------- tray */
  function packageRow(pack, disabled, note) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "room-tray__tier";
    row.dataset.roomPack = pack.id;
    if (disabled) {
      row.disabled = true;
      row.classList.add("is-locked");
    }
    const name = document.createElement("span");
    name.className = "room-tray__name";
    name.textContent = pack.name;
    const tag = document.createElement("span");
    tag.className = "room-tray__tag";
    tag.textContent = note || pack.tag || "FREE";
    const blurb = document.createElement("span");
    blurb.className = "room-tray__blurb";
    blurb.textContent = pack.blurb || "";
    row.append(name, tag, blurb);
    row.addEventListener("click", () => {
      if (row.disabled) return;
      downloadPack(pack.id);
    });
    return row;
  }

  /* The drawer prints the full package rows; the chassis strip stays compact. */
  function renderDeckPacks() {
    if (!deckPacks) return;
    deckPacks.textContent = "";
    const beat = BEATS[state.selected];
    if (!beat) return;
    const locked = isLocked(beat.id);
    const pending = !isReleased(beat);
    PACKAGES.forEach((pack) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.roomPack = pack.id;
      button.textContent = pack.id === "exclusive" ? "EXCLUSIVE" : String(pack.id).toUpperCase();
      button.title = pending ? "DROPPING SOON" : pack.name;
      if (locked || pending) button.disabled = true;
      deckPacks.appendChild(button);
    });
  }

  function renderPacks(container) {
    if (!container) return;
    container.textContent = "";
    const beat = BEATS[state.selected];
    if (!beat) return;
    const locked = isLocked(beat.id);
    const pending = !isReleased(beat);
    if (locked) {
      const note = document.createElement("p");
      note.className = "room-tray__note";
      note.textContent = isOwned(beat.id)
        ? "PRIVATE MASTER // YOURS — THE EXCLUSIVE LICENSE IS ON FILE. THE LEASES ARE RETIRED."
        : "EXCLUSIVE RIGHTS // ARCHIVED — THIS BEAT HAS LEFT THE STORE.";
      container.appendChild(note);
      return;
    }
    PACKAGES.forEach((pack) => {
      container.appendChild(packageRow(
        pack,
        pending,
        pending ? "DROPPING SOON" : (locked && pack.id === "exclusive" ? "CLAIMED / SOLD OUT" : "")
      ));
    });
  }

  function setScrim(open) {
    if (!scrim) return;
    if (open) {
      scrim.hidden = false;
      requestAnimationFrame(() => scrim.classList.add("is-open"));
    } else {
      scrim.classList.remove("is-open");
      scrim.hidden = true;
    }
  }

  let trayTimer = 0;

  function openTray() {
    const beat = BEATS[state.selected];
    if (!beat) return;
    hideCard();
    window.clearTimeout(trayTimer);
    if (trayKicker) {
      trayKicker.textContent = isLocked(beat.id)
        ? "EXCLUSIVE RIGHTS"
        : !isReleased(beat)
          ? "DROPPING SOON"
          : "FREE DOWNLOAD — " + (beat.bpm || "") + " BPM";
    }
    if (trayTitle) trayTitle.textContent = shortTitle(beat);
    if (traySpecs) traySpecs.textContent = specLine(beat);
    renderPacks(trayList);
    setScrim(true);
    tray.hidden = false;
    requestAnimationFrame(() => tray.classList.add("is-open"));
    room.classList.add("has-tray");
  }

  function hideTray(immediate) {
    if (!tray) return;
    window.clearTimeout(trayTimer);
    tray.classList.remove("is-open");
    setScrim(false);
    room.classList.remove("has-tray");
    if (immediate || reduced) {
      tray.hidden = true;
      return;
    }
    trayTimer = window.setTimeout(() => {
      if (!tray.classList.contains("is-open")) tray.hidden = true;
    }, 560);
  }

  function downloadPack(packId) {
    const beat = BEATS[state.selected];
    const api = window.KYROlll_DOWNLOADS;
    if (!beat || !api || typeof api.start !== "function") return;
    if (!isReleased(beat) || isLocked(beat.id)) return;
    api.start(beat.id, packId);
  }

  /* ------------------------------------------------------------------ listen */
  const REST_ARM = -1.32;
  const PLAY_ARM = -2.0;

  function listen(index) {
    const record = records[index];
    if (!record || state.listening || !state.ready) return;
    if (!isReleased(record.beat)) return;
    hideTray();
    hideCard();
    state.selected = index;
    state.listening = true;
    deck.arm = 0;
    deck.armTarget = 0;
    deck.armFrom = 0;
    deck.armStart = performance.now();
    if (armPivot) armPivot.rotation.y = REST_ARM;
    platterDisc.visible = false;
    record.disc.visible = false;

    ensureAudio();
    setPreviewSource(record.beat);
    playAudio();

    showDeck(record.beat);
    applyCamera("deck");

    const start = new THREE.Vector3();
    record.group.getWorldPosition(start);
    start.z += 0.03;
    const end = new THREE.Vector3();
    platterDisc.getWorldPosition(end);
    const mid = start.clone().lerp(end, 0.5);
    mid.y = Math.max(start.y, end.y) + 0.55;
    mid.z += 0.5;
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);

    const group = makeVinylDisc(0.315);
    group.rotation.x = -Math.PI / 2;
    group.position.copy(start);
    scene.add(group);

    deck.flight = {
      group,
      curve,
      t: 0,
      started: performance.now(),
      duration: reduced ? 220 : 1150,
      spin0: 0,
      arrive: () => {
        platterDisc.visible = true;
        setArm(1);
        updateDeckProgress();
      },
    };
    deck.flying = true;
  }

  function showDeck(beat) {
    if (deckTitle) deckTitle.textContent = shortTitle(beat);
    renderDeckPacks();
    deckEl.hidden = false;
    room.classList.add("is-listening");
    updatePlayGlyph();
    updateDeckProgress();
  }

  function eject() {
    if (!state.listening) return;
    if (deck.flight) {
      const flight = deck.flight;
      deck.flight = null;
      deck.flying = false;
      scene.remove(flight.group);
      flight.group.traverse((node) => { if (node.isMesh) node.geometry.dispose(); });
    }
    pauseAudio();
    state.listening = false;
    setArm(0);
    platterDisc.visible = false;
    deckEl.hidden = true;
    room.classList.remove("is-listening");
    applyCamera("wide");
    const record = records[state.selected];
    if (record) record.disc.visible = true;
    if (audio) {
      try { audio.currentTime = 0; } catch (error) { /* not loaded yet */ }
    }
  }

  /* --------------------------------------------------------------- interaction */
  let pointer = { down: false, x: 0, y: 0, startX: 0, startY: 0, moved: false, id: null };

  /* The shelf is a fixed grid of covers facing the camera, so the honest hit
     test is the projected cover itself: the raycast against the bevel edges
     could resolve a neighbour at a cover's seam, and a tap must always select
     the sleeve under the finger. `projectRecord` measures each cover's screen
     centre and half-size once per pointer event. */
  function projectRecord(record) {
    const rect = renderer.domElement.getBoundingClientRect();
    const center = new THREE.Vector3();
    const edgeX = new THREE.Vector3();
    const edgeY = new THREE.Vector3();
    record.group.getWorldPosition(center);
    edgeX.copy(center).add(new THREE.Vector3(0.33, 0, 0));
    edgeY.copy(center).add(new THREE.Vector3(0, 0.33, 0));
    const toScreen = (vector) => {
      vector.project(camera);
      return { x: (vector.x * 0.5 + 0.5) * rect.width, y: (-vector.y * 0.5 + 0.5) * rect.height };
    };
    const c = toScreen(center);
    const ex = toScreen(edgeX);
    const ey = toScreen(edgeY);
    return {
      x: rect.left + c.x,
      y: rect.top + c.y,
      halfW: Math.max(8, Math.abs(ex.x - c.x)),
      halfH: Math.max(8, Math.abs(ey.y - c.y)),
    };
  }

  function pick(clientX, clientY) {
    let best = -1;
    let score = Infinity;
    for (const record of records) {
      const box = projectRecord(record);
      if (Math.abs(clientX - box.x) > box.halfW * 1.06) continue;
      if (Math.abs(clientY - box.y) > box.halfH * 1.06) continue;
      const distance = Math.hypot((clientX - box.x) / box.halfW, (clientY - box.y) / box.halfH);
      if (distance < score) { score = distance; best = record.index; }
    }
    return best;
  }

  function attachEvents() {
    const canvas = renderer.domElement;

    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      pointer = { down: true, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, id: event.pointerId };
      canvas.setPointerCapture && canvas.setPointerCapture(event.pointerId);
      /* The seal is a physical object: pressing the still-sealed sleeve lets the
         visitor scrub the tear with the pointer, not just watch it play. */
      if (!state.peeled && wrap && state.ready) {
        const hit = pick(event.clientX, event.clientY);
        if (hit === 0) {
          state.tearDrag = true;
          state.tearStartX = event.clientX;
          state.tearStartY = event.clientY;
          state.tearStartT = wrap.t;
          if (!wrap.peeling) {
            wrap.peeling = true;
            wrap.started = performance.now();
            room.classList.add("is-tearing");
          }
        }
      }
    });

    canvas.addEventListener("pointermove", (event) => {
      const rect = canvas.getBoundingClientRect();
      cameraState.wantX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      cameraState.wantY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
      if (state.tearDrag && wrap) {
        if (Math.abs(event.clientX - pointer.startX) > 4 || Math.abs(event.clientY - pointer.startY) > 4) pointer.moved = true;
        /* Down OR right pulls the film open — a phone's pan-y gesture still
           reaches the tear without trapping the page scroll. */
        const pull = (event.clientY - state.tearStartY) + (event.clientX - state.tearStartX) * 0.6;
        wrap.t = clamp(state.tearStartT + pull / 210, 0, 1);
        wrap.started = performance.now() - wrap.t * 1600;
        return;
      }
      if (pointer.down) {
        if (Math.abs(event.clientX - pointer.startX) > 7 || Math.abs(event.clientY - pointer.startY) > 7) pointer.moved = true;
        if (pointer.moved && !state.listening) {
          /* A short look-around, clamped inside the frame. Releasing the drag
             eases the camera back to its preset. */
          const preset = cameraPreset(state.view);
          cameraState.pos.x = preset.pos.x + clamp((event.clientX - pointer.startX) * 0.0014, -0.28, 0.28);
          cameraState.pos.y = preset.pos.y + clamp(-(event.clientY - pointer.startY) * 0.0009, -0.16, 0.16);
          cameraState.parallaxX = 0;
        }
        return;
      }
      if (state.listening) return;
      const hover = pick(event.clientX, event.clientY);
      if (hover !== state.hovered) {
        state.hovered = hover;
        canvas.style.cursor = hover >= 0 ? "pointer" : "grab";
        records.forEach((record, i) => { record.targetLift = i === hover ? 0.7 : (i === state.selected ? 1 : 0); });
      }
    });

    const endPointer = (event) => {
      if (!pointer.down) return;
      const wasMoved = pointer.moved;
      pointer.down = false;
      if (state.tearDrag) {
        state.tearDrag = false;
        if (wrap && wrap.peeling) {
          if (wrap.t >= 0.995) finishPeel();
          else wrap.started = performance.now() - wrap.t * 1600;
        }
      }
      if (pointer.moved) applyCamera(state.view);
      if (!wasMoved && event) {
        const index = pick(event.clientX, event.clientY);
        if (state.listening) return;
        if (index >= 0) choose(index);
        else if (!card.hidden || !tray.hidden) close();
      }
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", () => { pointer.down = false; state.tearDrag = false; });
    canvas.addEventListener("pointerleave", () => {
      cameraState.wantX = 0;
      cameraState.wantY = 0;
      if (!pointer.down) {
        state.hovered = -1;
        canvas.style.cursor = "grab";
      }
    });

    canvas.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        choose((Math.max(0, state.selected) + 1) % BEATS.length);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        choose((state.selected <= 0 ? BEATS.length : state.selected) - 1);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (state.selected >= 0) choose(state.selected);
      } else if (event.key === "Escape") {
        close();
      }
    });

    listenBtn && listenBtn.addEventListener("click", () => listen(state.selected));
    downloadBtn && downloadBtn.addEventListener("click", openTray);
    closeBtn && closeBtn.addEventListener("click", close);
    const closeDrawer = () => {
      hideTray();
      if (state.selected >= 0 && !state.listening) showCard(state.selected);
    };
    room.querySelectorAll("[data-room-tray-close]").forEach((button) => {
      button.addEventListener("click", closeDrawer);
    });
    scrim && scrim.addEventListener("click", closeDrawer);
    deckEject && deckEject.addEventListener("click", eject);
    deckPlay && deckPlay.addEventListener("click", toggleAudio);

    deckEl && deckEl.addEventListener("click", (event) => {
      const button = event.target.closest && event.target.closest("[data-room-pack]");
      if (!button || button.disabled) return;
      downloadPack(button.dataset.roomPack);
    });

    /* Clicking the dark room closes an open card/tray, but never a deck that is
       playing — the deck is dismissed only by its own RETURN TO SHELF control. */
    room.addEventListener("click", (event) => {
      if (state.listening) return;
      if (event.target.closest(".room__card, .room__tray, .room__scrim, .room__hud a, .room__hud button, canvas, .room__fallback")) return;
      close();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (tray && !tray.hidden) {
        hideTray();
        if (state.selected >= 0 && !state.listening) showCard(state.selected);
      } else if (!card.hidden) {
        close();
      }
    });

    window.addEventListener("resize", onResize);
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => onResize());
      observer.observe(stageEl);
    }
  }

  let resizeFrame = 0;
  function onResize() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      resize();
    });
  }

  function resize() {
    if (!renderer) return;
    const width = Math.max(1, stageEl.clientWidth);
    const height = Math.max(1, stageEl.clientHeight);
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    updatePixelRatio();
    const nextCompact = width < 760 || width / height < 0.95;
    if (nextCompact !== compact) {
      compact = nextCompact;
      buildShelf();
    }
    if (!cameraState.active) applyCamera(state.view, true);
  }

  function updatePixelRatio() {
    if (!renderer) return;
    const native = window.devicePixelRatio || 1;
    const cap = lowPower ? 1 : 1.6;
    const width = Math.max(1, stageEl.clientWidth);
    const height = Math.max(1, stageEl.clientHeight);
    /* Keep the drawing buffer inside a phone-GPU budget. */
    const budget = lowPower ? 7.5e5 : 2.4e6;
    let ratio = Math.min(native, cap);
    if (width * height * ratio * ratio > budget) ratio = Math.sqrt(budget / (width * height));
    renderer.setPixelRatio(Math.max(0.75, ratio));
  }

  /* -------------------------------------------------------------- diagnostics */
  function screenPoint(index) {
    const record = records[index];
    if (!record || !camera) return null;
    const box = projectRecord(record);
    return { x: box.x, y: box.y, halfW: box.halfW, halfH: box.halfH, index };
  }

  function stats() {
    return {
      fps: state.fps, frames: state.frames, lowPower, compact, view: state.view,
      selected: state.selected, listening: state.listening, playing: state.playing, peeled: state.peeled,
      flight: deck.flight ? Number(deck.flight.t.toFixed(2)) : null,
      flying: deck.flying, arm: Number(deck.arm.toFixed(2)),
      platter: platterDisc ? platterDisc.visible : null,
      wrapT: wrap ? Number(wrap.t.toFixed(2)) : null,
      peeling: wrap ? wrap.peeling : null,
      reduced,
    };
  }

  /* A claim (here or on another device) or a scheduled drop landing repaints the
     selected record in place. The room keeps no copy of the catalog: every read
     goes back through the shared helpers. */
  function refreshSelected() {
    const beat = BEATS[state.selected];
    if (!beat || !state.ready) return;
    if (!card.hidden) {
      paintStatus(beat, state.selected);
      if (listenBtn) listenBtn.disabled = !isReleased(beat);
      if (downloadBtn) downloadBtn.disabled = !isReleased(beat) || isLocked(beat.id);
    }
    if (!tray.hidden) renderPacks(trayList);
    renderDeckPacks();
  }
  window.addEventListener("kyrolll:exclusive-claims", refreshSelected);
  window.addEventListener("kyrolll:exclusive-locked", refreshSelected);
  setInterval(() => {
    const beat = BEATS[state.selected];
    if (!beat || card.hidden) return;
    if (!isReleased(beat) || isLocked(beat.id)) refreshSelected();
  }, 1000);

  /* One-second frame sampler, exposed for the smoke test. */
  setInterval(() => {
    if (!state.frames) return;
    state.fps = state.frames;
    state.frames = 0;
  }, 1000);
})();
