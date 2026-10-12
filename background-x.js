// Falling brown-X background animation. The canvas and every mark live in page
// coordinates, so scrolling passes them instead of carrying them along.
// The pause toggle is owned by brand-logo.js, which dispatches 'motion-toggle'.
const canvas = document.createElement('canvas');
canvas.setAttribute('aria-hidden', 'true');
Object.assign(canvas.style, {
  position: 'absolute',
  top: '0',
  left: '0',
  width: '100%',
  zIndex: '-1',
  pointerEvents: 'none',
  display: 'block',
});
document.body.prepend(canvas);
const ctx = canvas.getContext('2d');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let paused = motion.matches;
motion.addEventListener('change', () => { paused = motion.matches; });
document.addEventListener('motion-toggle', (event) => { paused = event.detail.paused; });

const img = new Image();
img.src = 'assets/kyrolll-brown-x.png';

let sprites = [];
let width = 0;
let height = 0;
let dpr = 1;
let rafId = 0;
let lastTime = 0;
let running = false;

function targetCount() {
  return Math.max(8, Math.min(50, Math.round((width * height) / 70000)));
}

function makeSprite() {
  const size = 22 + Math.random() * 30;
  const landingY = size / 2 + Math.random() * Math.max(0, height - size);
  const landed = paused;
  return {
    x: Math.random() * width,
    y: landed ? landingY : landingY - Math.min(window.innerHeight * (0.3 + Math.random() * 0.7), landingY + size),
    landingY,
    landed,
    size,
    speed: 16 + Math.random() * 30,
    drift: (Math.random() - 0.5) * 22,
    phase: Math.random() * Math.PI * 2,
    rot: (Math.random() - 0.5) * 0.9,
    rotSpeed: (Math.random() - 0.5) * 0.45,
    alpha: 0.12 + Math.random() * 0.18,
  };
}

function seed() {
  const count = targetCount();
  while (sprites.length < count) sprites.push(makeSprite());
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = document.documentElement.clientWidth;
  height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  seed();
  drawFrame(0, performance.now());
}

function drawFrame(dt, t) {
  ctx.clearRect(0, 0, width, height);
  for (const s of sprites) {
    if (!paused) {
      s.y += s.speed * dt;
      s.x = Math.max(s.size / 2, Math.min(width - s.size / 2, s.x + s.drift * dt + Math.sin(t * 0.0006 + s.phase) * 12 * dt));
      s.rot += s.rotSpeed * dt;
      if (s.y >= s.landingY) {
        s.y = -s.size - Math.random() * 200;
        s.landingY = s.size / 2 + Math.random() * Math.max(0, height - s.size);
        s.x = Math.random() * width;
        s.speed = 16 + Math.random() * 30;
        s.drift = (Math.random() - 0.5) * 22;
      }
    }
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.globalAlpha = s.alpha;
    ctx.drawImage(img, -s.size / 2, -s.size / 2, s.size, s.size);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function loop(time) {
  rafId = requestAnimationFrame(loop);
  if (paused || document.hidden || !running) {
    lastTime = time;
    return;
  }
  const dt = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;
  drawFrame(dt, time);
}

function start() {
  if (running) return;
  running = true;
  resize();
  lastTime = performance.now();
  rafId = requestAnimationFrame(loop);
}

function stop() {
  running = false;
  cancelAnimationFrame(rafId);
  ctx.clearRect(0, 0, width, height);
}

let resizeRaf = 0;
function scheduleResize() {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(resize);
}
window.addEventListener('resize', scheduleResize);
new ResizeObserver(scheduleResize).observe(document.body);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
  } else if (running) {
    lastTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }
});

img.addEventListener('load', start, { once: true });
img.addEventListener('error', () => { running = false; }, { once: true });
if (img.complete && img.naturalWidth) start();
