import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Every `.logo-stage` on the page mounts its own flower: the hero, the account
// flower, the page-load preloader. Prior versions only ever styled and mounted
// the first stage, so a second stage (the preloader) silently got nothing.
//
// On the sign-in page the temporary preloader veil sits directly on top of an
// already full hero flower, so that stage is skipped: building a second WebGL
// flower only to hide it a moment later is the main cost that made login feel
// slow. The still image covers the brief veil while the real flower comes up.
const hosts = Array.from(document.querySelectorAll('.logo-stage')).filter(
  (host) => !(document.body.classList.contains('auth-body') && host.closest('#preloader'))
);
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const pause = document.querySelector('.motion-toggle');
let paused = motion.matches;
const stillRenderers = new Set();
// Per-instance bookkeeping so the preloader's flower can be released when the
// overlay leaves the screen (see the `kyrolll:preloader-done` listener below).
const instances = new Map();
const flowerControllers = new Set();
function setFlowerProgress(progress) {
  const p = Math.max(0, Math.min(1, progress));
  flowerControllers.forEach((controller) => { try { controller.setProgress(p); } catch (error) { /* ignore */ } });
}
window.KYROlll_FLOWER_PROGRESS = setFlowerProgress;

function renderStillAll() {
  stillRenderers.forEach((render) => { try { render(); } catch (error) { /* ignore */ } });
  // Prefer stable 60fps for the smoothest rotation. Elapsed time-based rather
  // than rAF deltas alone keeps the motion refresh-rate independent.
}
function syncMotion() {
  document.documentElement.classList.toggle('motion-paused', paused);
  if (pause) {
    pause.textContent = paused ? 'PLAY MOTION +' : 'PAUSE MOTION −';
    pause.setAttribute('aria-pressed', String(paused));
  }
  document.dispatchEvent(new CustomEvent('motion-toggle', { detail: { paused } }));
  renderStillAll();
}
// Not every account page carries the motion toggle (library / profile / success
// do not), so guard its wiring; the pause state still propagates to the whole
// page through the class and the shared event.
if (pause) pause.addEventListener('click', () => { paused = !paused; syncMotion(); });
motion.addEventListener('change', () => { paused = motion.matches; syncMotion(); });
syncMotion();

// Shared across instances: the silhouette file is fetched once, never per stage.
let contoursPromise = null;
function getContours() {
  if (!contoursPromise) {
    contoursPromise = fetch('assets/kyrolll-contours.json?v=2').then((response) => {
      if (!response.ok) throw new Error('Logo geometry unavailable');
      return response.json();
    });
  }
  return contoursPromise;
}

async function init(host) {
  const { size, contours } = await getContours();
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  // Software rasterisers (SwiftShader, llvmpipe — what a machine without a GPU
  // falls back to) spend far longer on this pearl material than a GPU does.
  // There the flower is built from a slightly coarser bevel, a smaller
  // environment map and a ~30fps cadence, and the shader compile skips three's
  // error reporting: that reporting reads back every program's status and log,
  // which forces the driver's compile onto the main thread instead of letting
  // it finish in its own time. The silhouette, the material and the light are
  // untouched, and the rotation is far too slow for the cadence to read.
  // Machines with a GPU keep the full scene, error reporting included.
  const rendererContext = renderer.getContext();
  const rendererInfo = rendererContext.getExtension('WEBGL_debug_renderer_info');
  const softwareRasteriser = rendererInfo
    ? /swiftshader|llvmpipe|softpipe|software|basic render/i.test(String(rendererContext.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)))
    : false;
  if (softwareRasteriser) renderer.debug.checkShaderErrors = false;
  const stageSize = host.getBoundingClientRect().width;
  let renderedSize = stageSize;
  renderer.setSize(stageSize, stageSize, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, 1, .1, 50);
  camera.position.z = 6.4;
  const pmrem = new THREE.PMREMGenerator(renderer);
  // Soft studio: large dim panels plus gentle ambient fill for a pearl-white
  // finish. These are reflection sources, never visible backings.
  const room = new THREE.Scene();
  room.background = new THREE.Color(0x2a2c33);
  for (const [x, y, z, width, height, intensity] of [
    [-4, 3, 4, 6, 10, 1.6], [4, 1, 3, 4, 9, 2.2],
    [0, 6, -2, 10, 4, 1.4], [-3, -3, -4, 6, 8, 1.0], [3, 0, -5, 3, 10, 1.8]
  ]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(intensity), side: THREE.DoubleSide }));
    panel.position.set(x, y, z); panel.lookAt(0, 0, 0); room.add(panel);
  }
  // The room only ever reaches the flower as a blurred reflection of soft dim
  // panels, so on a software rasteriser the smallest cube reads the same.
  if (softwareRasteriser) renderer.setSize(128, 128, false);
  const environment = pmrem.fromScene(room, .015);
  if (softwareRasteriser) renderer.setSize(stageSize, stageSize, false);
  scene.environment = environment.texture;
  room.traverse(child => { child.geometry?.dispose(); child.material?.dispose(); });
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x30343c, .55));
  // Everything below is split across frames on purpose: this scene is heavy to
  // build on a software rasteriser, and the page has to stay answerable while
  // it is built. Each await hands the browser a frame to do that in, and the
  // crossfade only starts once the whole flower has painted.
  await nextFrame();
  // Build the flower from the traced contours: each positive contour becomes an
  // extruded, beveled petal mesh; negative contours (the two center cutouts)
  // become holes. The contour JSON is fetched once and shared by every stage.
  const object = new THREE.Group();
  const point = ([x, y]) => new THREE.Vector2((x / size - .5) * 3, (.5 - y / size) * 3);
  function contains(points, p) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  const material = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f2, metalness: .12, roughness: .52, clearcoat: .35, clearcoatRoughness: .45, envMapIntensity: .55 });
  for (const contour of contours.filter(c => c.area > 0)) {
    const shape = new THREE.Shape(contour.points.map(point));
    for (const hole of contours.filter(c => c.area < 0 && contains(contour.points, c.points[0]))) shape.holes.push(new THREE.Path(hole.points.map(point)));
    // Inset the bevel: its widest edge stays on the imported silhouette.
    const raw = new THREE.ExtrudeGeometry(shape, { depth: .13, bevelEnabled: true, bevelSegments: softwareRasteriser ? 2 : 5, steps: 1, bevelSize: .009, bevelOffset: -.009, bevelThickness: .024, curveSegments: 12 });
    // Weld the traced segments so the bevel reads as polished metal rather
    // than hundreds of disconnected, flat-shaded pixel-edge facets.
    raw.deleteAttribute('normal'); raw.deleteAttribute('uv');
    const geometry = mergeVertices(raw, .0001);
    raw.dispose();
    geometry.translate(0, 0, -.065);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    // A subtle convex normal field mimics the broad face of stamped silver,
    // keeping every source outline and cutout in its original position.
    for (let i = 0; i < normals.count; i++) {
      if (Math.abs(positions.getZ(i)) < .0889) continue;
      const n = new THREE.Vector3((positions.getX(i) - center.x) * .85, (positions.getY(i) - center.y) * .85, Math.sign(positions.getZ(i))).normalize();
      normals.setXYZ(i, n.x, n.y, n.z);
    }
    object.add(new THREE.Mesh(geometry, material));
    await nextFrame();
  }
  // Track meshes for bottom-up reveal. Group by vertical position (bottom to top).
  const petalMeshes = [];
  for (const mesh of object.children) {
    if (mesh.isMesh) {
      const box = mesh.geometry.boundingBox;
      if (box) {
        petalMeshes.push({ mesh, minY: box.min.y, maxY: box.max.y });
      } else {
        petalMeshes.push({ mesh, minY: -1, maxY: 1 });
      }
    }
  }
  // Sort: bottom (smaller Y, more negative) first, then top last.
  petalMeshes.sort((a, b) => a.minY - b.minY);
  const totalPetals = petalMeshes.length || 1;
  petalMeshes.forEach((entry) => { entry.mesh.visible = false; });
  let currentProgress = 0;
  object.rotation.set(.15, -.22, -.12);
  const restingPose = object.quaternion.clone();
  const spin = new THREE.Quaternion(), tumble = new THREE.Quaternion(), roll = new THREE.Quaternion();
  const xAxis = new THREE.Vector3(1, 0, 0), yAxis = new THREE.Vector3(0, 1, 0), zAxis = new THREE.Vector3(0, 0, 1);
  scene.add(object);
  const key = new THREE.DirectionalLight(0xe4edff, 1.4);
  key.position.set(-3, 4, 5); scene.add(key);
  const rim = new THREE.PointLight(0xffffff, 16, 20);
  rim.position.set(3, 1, 3); scene.add(rim);
  const warm = new THREE.PointLight(0xc19785, 6, 20);
  warm.position.set(-3, -2, -2); scene.add(warm);
  const resize = new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width;
    if (!width || Math.abs(width - renderedSize) < .5) return;
    renderedSize = width;
    renderer.setSize(width, width, false);
    renderer.render(scene, camera);
  });
  host.append(renderer.domElement);
  resize.observe(host);
  // The pearl program is the most expensive thing this scene compiles.
  // compileAsync keeps that off the main thread wherever the driver exposes
  // KHR_parallel_shader_compile (it silently compiles synchronously where it
  // does not), so the first paint below has nothing left to compile.
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  // Give the correctly sized, fully lit first frame time to paint behind the
  // still image before crossfading it in; never expose an empty or re-sized canvas.
  await nextFrame();
  await nextFrame();
  // Hide the still fallback once the WebGL flower has painted at least the
  // first frame and starts its reveal; the build-in will reveal geometry.
  host.classList.add('is-ready');
  const revealAt = performance.now() + 450;
  let visible = true, elapsed = 0, previous = 0, lastDraw = 0;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(host);
  stillRenderers.add(() => renderer.render(scene, camera));
  const controller = {
    setProgress(p) {
      currentProgress = p;
      const revealCount = Math.floor(p * totalPetals);
      for (let i = 0; i < petalMeshes.length; i++) {
        petalMeshes[i].mesh.visible = i <= revealCount;
      }
    }
  };
  controller.setProgress(0);
  flowerControllers.add(controller);
  renderer.setAnimationLoop(time => {
    const now = time || performance.now();
    const dt = Math.min((now - previous) / 1000, 1 / 30);
    previous = now;
    if (now < revealAt || paused || !visible || document.hidden) return;
    elapsed += dt;
    spin.setFromAxisAngle(yAxis, elapsed * Math.PI * 2 / 24);
    tumble.setFromAxisAngle(xAxis, elapsed * Math.PI * 2 / 72);
    roll.setFromAxisAngle(zAxis, elapsed * Math.PI * 2 / 144);
    object.quaternion.copy(restingPose).multiply(roll).multiply(tumble).multiply(spin);
    rim.position.x = Math.cos(elapsed * .3) * 4;
    rim.position.y = 1 + Math.sin(elapsed * .2) * 2;
    renderer.render(scene, camera);
  });
  instances.set(host, { renderer, controller });
  // Ensure all petals start hidden (defensive) and let progress drive reveal.
  petalMeshes.forEach((entry) => { entry.mesh.visible = false; });
  if (typeof window.KYROlll_FLOWER_PROGRESS === 'function') {
    // Non-preloader flowers get a brief auto-build-in when they become ready.
    let auto = 0;
    const buildIn = () => {
      auto += 0.018;
      if (auto > 1) auto = 1;
      if (window.KYROlll_FLOWER_PROGRESS) window.KYROlll_FLOWER_PROGRESS(auto);
      if (auto < 1) requestAnimationFrame(buildIn);
      else setTimeout(() => { if (window.KYROlll_FLOWER_PROGRESS) window.KYROlll_FLOWER_PROGRESS(1); }, 120);
    };
    buildIn();
  }
}

// The preloader's flower exists only to make page load feel deliberate. Once
// the overlay has faded (preloader.js dispatches this), stop its render loop
// and hand the WebGL context back so the page keeps just the hero flower.
document.addEventListener('kyrolll:preloader-done', () => {
  if (window.KYROlll_FLOWER_PROGRESS) window.KYROlll_FLOWER_PROGRESS(1);
  flowerControllers.clear();
  document.querySelectorAll('#preloader .logo-stage').forEach((stage) => {
    const instance = instances.get(stage);
    if (!instance) return;
    instance.renderer.setAnimationLoop(null);
    try { instance.renderer.dispose(); } catch (error) { /* ignore */ }
    instances.delete(stage);
  });
});

if (hosts.length) {
  const failures = hosts.map(async (host) => {
    try {
      await init(host);
    } catch (error) {
      console.warn('Using static metallic logo:', error.message);
    }
  });
  Promise.all(failures);
} else {
  // No stages on the page (e.g. a stripped-down view): still keep the brand
  // pause state working, but there is nothing to draw.
}