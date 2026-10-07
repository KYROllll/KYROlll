import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const host = document.querySelector('.logo-stage');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const pause = document.querySelector('.motion-toggle');
let paused = motion.matches;
let renderStill = () => {};
function syncMotion() {
  document.documentElement.classList.toggle('motion-paused', paused);
  pause.textContent = paused ? 'PLAY MOTION +' : 'PAUSE MOTION −';
  pause.setAttribute('aria-pressed', String(paused));
  document.dispatchEvent(new CustomEvent('motion-toggle', { detail: { paused } }));
  renderStill();
}
pause.addEventListener('click', () => { paused = !paused; syncMotion(); });
motion.addEventListener('change', () => { paused = motion.matches; syncMotion(); });
syncMotion();

async function init() {
  const response = await fetch('assets/kyrolll-contours.json');
  if (!response.ok) throw new Error('Logo geometry unavailable');
  const { size, contours } = await response.json();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(400, 400, false);
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
  const environment = pmrem.fromScene(room, .015);
  scene.environment = environment.texture;
  room.traverse(child => { child.geometry?.dispose(); child.material?.dispose(); });
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x30343c, .55));
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
    const raw = new THREE.ExtrudeGeometry(shape, { depth: .13, bevelEnabled: true, bevelSegments: 5, steps: 1, bevelSize: .009, bevelOffset: -.009, bevelThickness: .024, curveSegments: 12 });
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
  }
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
    renderer.setSize(width, width, false);
    renderer.render(scene, camera);
  });
  resize.observe(host);
  host.append(renderer.domElement);
  renderer.render(scene, camera);
  host.classList.add('is-ready');
  let visible = true, elapsed = 0, previous = 0;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(host);
  renderStill = () => renderer.render(scene, camera);
  renderer.setAnimationLoop(time => {
    const dt = Math.min((time - previous) / 1000, .05); previous = time;
    if (paused || !visible || document.hidden) return;
    elapsed += dt;
    // Slow, continuous full turns on three axes, composed as quaternions to
    // avoid Euler-angle snapping. Delta time makes the motion refresh-rate
    // independent and keeps the rotation gentle and easy on the eyes.
    spin.setFromAxisAngle(yAxis, elapsed * Math.PI * 2 / 26);
    tumble.setFromAxisAngle(xAxis, elapsed * Math.PI * 2 / 78);
    roll.setFromAxisAngle(zAxis, elapsed * Math.PI * 2 / 156);
    object.quaternion.copy(restingPose).multiply(roll).multiply(tumble).multiply(spin);
    rim.position.x = Math.cos(elapsed * .35) * 4;
    rim.position.y = 1 + Math.sin(elapsed * .25) * 2;
    renderer.render(scene, camera);
  });
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault(); host.classList.remove('is-ready'); renderer.setAnimationLoop(null);
  });
}
init().catch(error => console.warn('Using static metallic logo:', error.message));
