/* KYROIII — THE VINYL ROOM
 *
 * The storefront's first screen: a dark listening room with a physical record
 * shelf and a turntable. Every beat is a sleeve on the shelf; the newest one is
 * still sealed in shrink-wrap, which peels when it is chosen. Choosing a record
 * raises two paths — LISTEN cues it on the 3D deck, FREE DOWNLOAD opens the
 * packages — and the deck's own chassis control strip carries the download
 * buttons, the pitch fader and the transport.
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
  const deckPitch = room.querySelector("[data-deck-pitch]");
  const deckPitchOut = room.querySelector("[data-deck-pitch-out]");
  const deckPacks = room.querySelector("[data-deck-packs]");
  const deckEject = room.querySelector("[data-deck-eject]");
  const fallbackLink = room.querySelector("[data-room-fallback]");

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
  const shortTitle = (beat) => beat.shortTitle || String(beat.title || "").replace(/^\[FREE 100%\]\s*/i, "");
  const specLine = (beat) => `${beat.bpm} BPM // ${String(beat.key || "").toUpperCase()} // TAGGED AUDIO`;

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
  let pitchCap = null;
  let wrap = null;
  let wallDecal = null;
  let flowerTexture = null;
  let vinylTexture = null;
  let labelTexture = null;
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
    const coverGeo = new THREE.BoxGeometry(0.66, 0.66, 0.022);
    const discGeo = new THREE.CylinderGeometry(0.315, 0.315, 0.006, 48);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.54, metalness: 0.2 });

    records = BEATS.map((beat, index) => {
      const group = new THREE.Group();
      group.userData.index = index;

      const coverMat = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.84, metalness: 0.02, emissive: 0x000000, envMapIntensity: 0.3 });
      const cover = new THREE.Mesh(coverGeo, [edgeMat, edgeMat, edgeMat, edgeMat, coverMat, edgeMat]);
      group.add(cover);

      const discMat = new THREE.MeshStandardMaterial({ map: vinylTexture, transparent: true, alphaTest: 0.5, roughness: 0.5, metalness: 0.08 });
      const disc = new THREE.Mesh(discGeo, [edgeMat, discMat, discMat]);
      disc.rotation.x = Math.PI / 2;
      disc.position.set(0.165, 0, -0.026);
      group.add(disc);

      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(coverGeo), new THREE.LineBasicMaterial({ color: 0x565656, transparent: true, opacity: 0.5 }));
      group.add(edge);

      shelfRoot.add(group);

      const record = { beat, index, group, cover, coverMat, disc, edge, lift: 0, targetLift: 0, home: new THREE.Vector3() };

      loader.load(beat.img, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        coverMat.map = texture;
        coverMat.emissiveMap = texture;
        coverMat.emissive = new THREE.Color(0xffffff);
        coverMat.emissiveIntensity = 0.05;
        coverMat.needsUpdate = true;
      }, undefined, () => { /* a missing cover stays a black sleeve */ });

      return record;
    });
  }

  /* ---------------------------------------------------------------- shrink */
  function buildWrap() {
    if (!records.length) return;
    const group = new THREE.Group();
    group.position.set(0, 0, 0.024);

    /* A faint crinkle map is what separates shrink-wrap from a flat plastic
       sheet under the key light; it is data, not colour, so the film stays
       equal-channel. */
    const wrinkles = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 46; i += 1) {
        const x = (i * 61) % w;
        const y = (i * 97) % h;
        const grad = ctx.createLinearGradient(x, y, x + 90, y + 46);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.5, i % 2 ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.18)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(x - 40, y - 20, 150, 80);
      }
    });
    wrinkles.colorSpace = THREE.NoColorSpace;
    wrinkles.wrapS = THREE.RepeatWrapping;
    wrinkles.wrapT = THREE.RepeatWrapping;

    const filmMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.09,
      transparent: true,
      opacity: 0.19,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 2.4,
      bumpMap: wrinkles,
      bumpScale: 0.012,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const film = new THREE.Mesh(new THREE.BoxGeometry(0.694, 0.694, 0.05), filmMat);
    film.renderOrder = 3;
    group.add(film);

    const seamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, toneMapped: false });
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.68, 0.056), seamMat);
    seam.position.set(-0.344, 0, 0);
    group.add(seam);
    const seamTop = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.004, 0.056), seamMat);
    seamTop.position.set(0, 0.344, 0);
    group.add(seamTop);

    const flapTexture = canvasTexture(256, 256, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "rgba(255,255,255,0.5)");
      grad.addColorStop(0.5, "rgba(255,255,255,0.18)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(w, 0);
      ctx.lineTo(w * 0.12, h * 0.88);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    });
    const flap = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: flapTexture, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    flap.geometry.translate(-0.1, -0.1, 0);
    flap.position.set(0.247, 0.247, 0.03);
    group.add(flap);

    const stickerTexture = canvasTexture(256, 128, (ctx, w, h) => {
      ctx.fillStyle = "rgba(12,12,12,0.86)";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 3;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 30px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      ctx.fillText("SEALED", w / 2, h * 0.39);
      ctx.font = "700 18px 'Helvetica Neue', Helvetica, Arial, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText("KYROIII", w / 2, h * 0.68);
    });
    const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), new THREE.MeshBasicMaterial({ map: stickerTexture, transparent: true, toneMapped: false }));
    sticker.position.set(0.2, -0.26, 0.032);
    group.add(sticker);

    /* Parented to the newest sleeve so the seal lifts and leans with it. */
    records[0].group.add(group);
    wrap = { group, film, filmMat, flap, sticker, seam, seamTop, t: 0, peeling: false };
  }

  function peel() {
    if (!wrap || wrap.peeling || state.peeled) return;
    wrap.peeling = true;
    wrap.started = performance.now();
    if (reduced) { finishPeel(); return; }
  }

  function finishPeel() {
    if (!wrap) return;
    wrap.peeling = false;
    wrap.film.visible = false;
    wrap.seam.visible = false;
    wrap.seamTop.visible = false;
    wrap.flap.visible = false;
    wrap.sticker.visible = false;
    state.peeled = true;
    room.classList.add("is-unsealed");
    if (cardKicker && state.selected === 0 && !card.hidden) cardKicker.textContent = "LATEST DROP — UNSEALED";
  }

  /* One disc = the photographed pressing + the original flower label plate,
     exactly the record the beat page shows. */
  function makeVinylFace(radius) {
    const group = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 64),
      new THREE.MeshStandardMaterial({ map: vinylTexture, transparent: true, alphaTest: 0.5, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide })
    );
    group.add(disc);
    const label = new THREE.Mesh(
      new THREE.CircleGeometry(radius * 0.28, 48),
      new THREE.MeshBasicMaterial({ map: labelTexture, toneMapped: false })
    );
    label.position.z = 0.0012;
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
    platterDisc = makeVinylFace(0.4);
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

    const faderSlot = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.008, 0.38), new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.8, metalness: 0.1 }));
    faderSlot.position.set(-0.55, 0.872, 0.3);
    deckGroup.add(faderSlot);
    pitchCap = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.02, 0.046), silverMat());
    pitchCap.position.set(-0.55, 0.88, 0.3);
    deckGroup.add(pitchCap);

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
    /* Wall-clock progress: a slow renderer must not turn the peel into a
       slideshow, so the clock is the clock, not the frame budget. */
    wrap.t = clamp((performance.now() - wrap.started) / 900, 0, 1);
    const t = easeInOut(wrap.t);
    wrap.film.rotation.z = -0.34 * t;
    wrap.film.rotation.y = -0.65 * t;
    wrap.film.position.x = -0.34 * t;
    wrap.film.position.y = 0.22 * t;
    wrap.filmMat.opacity = 0.19 * (1 - t);
    wrap.flap.rotation.z = -1.15 * t;
    wrap.flap.rotation.x = -0.5 * t;
    wrap.flap.scale.setScalar(1 + 0.75 * t);
    wrap.sticker.rotation.z = -0.5 * t;
    wrap.sticker.position.y = -0.26 + 0.12 * t;
    wrap.seam.material.opacity = 0.5 * (1 - t);
    wrap.seamTop.material.opacity = 0.5 * (1 - t);
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
    if (pitchCap) {
      const p = clamp(Number(deckPitch.value) || 0, -8, 8);
      pitchCap.position.z = 0.3 + (p / 8) * 0.14;
    }
    if (state.playing && spinGroup && !deck.flying && !reduced && !manualPaused) {
      spinGroup.rotation.z -= dt * 3.49 * (audio ? audio.playbackRate : 1);
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
  let audio = null;
  let audioContext = null;

  function ensureAudio() {
    if (!audio) {
      audio = new Audio();
      audio.preload = "metadata";
      audio.loop = true;
      audio.addEventListener("timeupdate", updateDeckProgress);
      audio.addEventListener("play", () => { state.playing = true; updatePlayGlyph(); });
      audio.addEventListener("pause", () => { state.playing = false; updatePlayGlyph(); });
      audio.addEventListener("loadedmetadata", updateDeckProgress);
    }
    return audio;
  }

  function ensureAnalyser() {
    if (analyser || !audio) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioContext = new Ctx();
      const source = audioContext.createMediaElementSource(audio);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);
      analyser.connect(audioContext.destination);
      analyserData = new Uint8Array(analyser.frequencyBinCount);
    } catch (error) {
      analyser = null;
    }
  }

  function playAudio() {
    const el = ensureAudio();
    ensureAnalyser();
    if (audioContext && audioContext.state === "suspended") audioContext.resume().catch(() => {});
    el.volume = 0.0001;
    const started = el.play();
    if (started && started.catch) started.catch(() => { state.playing = false; updatePlayGlyph(); });
    fadeVolume(el, 0.9, 900);
  }

  function fadeVolume(el, to, ms) {
    const from = el.volume;
    const start = performance.now();
    const tick = (now) => {
      const t = clamp((now - start) / ms, 0, 1);
      try { el.volume = from + (to - from) * t; } catch (error) { /* iOS volume is read-only */ }
      if (t < 1 && !el.paused) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function pauseAudio() {
    if (audio && !audio.paused) audio.pause();
    state.playing = false;
    updatePlayGlyph();
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
    deckBar.style.width = percent.toFixed(2) + "%";
    deckTime.textContent = formatTime(current) + " / " + (duration ? formatTime(duration) : "--:--");
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
    card.hidden = false;
    room.classList.add("has-card");
    if (index === 0 && !state.peeled) peel();
    if (listenBtn) listenBtn.disabled = !isReleased(beat);
    if (downloadBtn) downloadBtn.disabled = !isReleased(beat) || isLocked(beat.id);
    if (!isReleased(beat) && cardKicker) cardKicker.textContent = "DROPPING SOON — LOCKED";
    if (hintEl) hintEl.textContent = "LISTEN ON THE DECK OR TAKE THE FILES";
    records.forEach((record, i) => { record.targetLift = i === index ? 1 : 0; });
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
  function packageRow(pack, locked) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "room-tray__tier";
    row.dataset.roomPack = pack.id;
    if (locked) {
      row.disabled = true;
      row.classList.add("is-locked");
    }
    const name = document.createElement("span");
    name.className = "room-tray__name";
    name.textContent = pack.name;
    const tag = document.createElement("span");
    tag.className = "room-tray__tag";
    tag.textContent = locked ? "CLAIMED / SOLD OUT" : (pack.tag || "FREE");
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

  /* The tray prints the full package rows; the chassis strip stays compact. */
  function renderDeckPacks() {
    if (!deckPacks) return;
    deckPacks.textContent = "";
    const beat = BEATS[state.selected];
    if (!beat) return;
    const locked = isLocked(beat.id);
    PACKAGES.forEach((pack) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.roomPack = pack.id;
      button.textContent = pack.id === "exclusive" ? "EXCLUSIVE" : String(pack.id).toUpperCase();
      button.title = pack.name;
      if (locked) button.disabled = true;
      deckPacks.appendChild(button);
    });
  }

  function renderPacks(container) {
    if (!container) return;
    container.textContent = "";
    const beat = BEATS[state.selected];
    if (!beat) return;
    const locked = isLocked(beat.id);
    PACKAGES.forEach((pack) => {
      container.appendChild(packageRow(pack, locked && pack.id === "exclusive"));
    });
  }

  function openTray() {
    const beat = BEATS[state.selected];
    if (!beat) return;
    card.hidden = true;
    room.classList.add("has-tray");
    if (trayKicker) trayKicker.textContent = "FREE DOWNLOAD — " + (beat.bpm || "") + " BPM";
    if (trayTitle) trayTitle.textContent = shortTitle(beat);
    renderPacks(trayList);
    tray.hidden = false;
  }

  function hideTray() {
    if (!tray) return;
    tray.hidden = true;
    room.classList.remove("has-tray");
  }

  function downloadPack(packId) {
    const beat = BEATS[state.selected];
    const api = window.KYROlll_DOWNLOADS;
    if (!beat || !api || typeof api.start !== "function") return;
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
    audio.src = record.beat.preview;
    audio.playbackRate = 1 + (Number(deckPitch.value) || 0) / 100;
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

    const group = makeVinylFace(0.315);
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
    if (deckPitchOut) deckPitchOut.textContent = (Number(deckPitch.value) || 0).toFixed(1) + "%";
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
    });

    canvas.addEventListener("pointermove", (event) => {
      const rect = canvas.getBoundingClientRect();
      cameraState.wantX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      cameraState.wantY = ((event.clientY - rect.top) / rect.height) * 2 - 1;
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
      if (pointer.moved) applyCamera(state.view);
      if (!wasMoved && event) {
        const index = pick(event.clientX, event.clientY);
        if (state.listening) return;
        if (index >= 0) choose(index);
        else if (!card.hidden || !tray.hidden) close();
      }
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", () => { pointer.down = false; });
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
    trayClose && trayClose.addEventListener("click", () => { hideTray(); showCard(state.selected); });
    deckEject && deckEject.addEventListener("click", eject);
    deckPlay && deckPlay.addEventListener("click", toggleAudio);

    deckPitch && deckPitch.addEventListener("input", () => {
      const value = Number(deckPitch.value) || 0;
      if (audio) audio.playbackRate = 1 + value / 100;
      if (deckPitchOut) deckPitchOut.textContent = value.toFixed(1) + "%";
    });

    deckEl && deckEl.addEventListener("click", (event) => {
      const button = event.target.closest && event.target.closest("[data-room-pack]");
      if (!button || button.disabled) return;
      downloadPack(button.dataset.roomPack);
    });

    /* Clicking the dark room closes an open card/tray, but never a deck that is
       playing — the deck is dismissed only by its own RETURN TO SHELF control. */
    room.addEventListener("click", (event) => {
      if (state.listening) return;
      if (event.target.closest(".room__card, .room__tray, .room__hud a, .room__hud button, canvas, .room__fallback")) return;
      close();
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

  /* One-second frame sampler, exposed for the smoke test. */
  setInterval(() => {
    if (!state.frames) return;
    state.fps = state.frames;
    state.frames = 0;
  }, 1000);
})();
