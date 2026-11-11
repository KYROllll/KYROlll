/* KYROIII — ambient falling petals.
 *
 * One fixed canvas behind the archive paints a slow drift of white and silver
 * petals. It is deliberately tiny: a capped count, a 1x backing store, a 30 fps
 * paint cadence and no shadows or filters, so it never competes with the grid's
 * images. Reduced motion gets one still scatter; a hidden tab stops the loop.
 */
(function () {
  "use strict";

  const canvas = document.getElementById("yx-petals");
  if (!canvas) return;
  if (document.documentElement.classList.contains("beat-page")) {
    canvas.remove();
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const state = { width: 0, height: 0, petals: [], raf: 0, last: 0, paused: false };

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function makePetal(seedY) {
    const size = random(5, 15);
    return {
      x: random(-20, state.width + 20),
      y: seedY == null ? random(-state.height * 0.2, state.height) : seedY,
      size,
      alpha: random(0.08, 0.34),
      shade: Math.round(random(190, 255)),
      vy: random(7, 21),
      sway: random(4, 16),
      phase: random(0, Math.PI * 2),
      spin: random(0, Math.PI * 2),
      spinSpeed: random(-0.5, 0.5),
      squash: random(0.5, 0.8),
    };
  }

  function seed() {
    const count = Math.max(12, Math.min(34, Math.round((state.width * state.height) / 52000)));
    state.petals = Array.from({ length: count }, () => makePetal());
  }

  function resize() {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    // A 1x store is enough for soft, translucent marks and keeps the paint
    // cheap on a retina phone.
    canvas.width = state.width;
    canvas.height = state.height;
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;
    seed();
    draw(0);
  }

  function paintPetal(petal, dt) {
    petal.y += petal.vy * dt;
    petal.phase += 0.45 * dt;
    petal.x += Math.sin(petal.phase) * petal.sway * dt;
    petal.spin += petal.spinSpeed * dt;
    if (petal.y > state.height + 24) {
      Object.assign(petal, makePetal(-24));
      petal.x = random(-20, state.width + 20);
    }
    if (petal.x < -30) petal.x = state.width + 20;
    if (petal.x > state.width + 30) petal.x = -20;
  }

  function drawPetal(petal) {
    ctx.save();
    ctx.translate(petal.x, petal.y);
    ctx.rotate(petal.spin);
    ctx.scale(1, petal.squash);
    const s = petal.size;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.58);
    ctx.bezierCurveTo(s * 0.68, -s * 0.5, s * 0.54, s * 0.46, 0, s * 0.64);
    ctx.bezierCurveTo(-s * 0.54, s * 0.46, -s * 0.68, -s * 0.5, 0, -s * 0.58);
    ctx.closePath();
    ctx.fillStyle = `rgba(${petal.shade}, ${petal.shade}, ${petal.shade}, ${petal.alpha})`;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.5);
    ctx.quadraticCurveTo(s * 0.1, 0, 0, s * 0.54);
    ctx.strokeStyle = `rgba(0, 0, 0, ${petal.alpha * 0.45})`;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.restore();
  }

  function draw(dt) {
    ctx.clearRect(0, 0, state.width, state.height);
    for (const petal of state.petals) {
      if (dt) paintPetal(petal, dt);
      drawPetal(petal);
    }
  }

  function frame(now) {
    if (state.paused) return;
    state.raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - state.last) / 1000);
    if (state.last && now - state.last < 32) return;
    state.last = now;
    draw(dt || 0);
  }

  function start() {
    if (reduced.matches || state.raf) return;
    state.last = 0;
    state.raf = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.last = 0;
  }

  function setPaused(paused) {
    state.paused = !!paused;
    if (state.paused) stop();
    else start();
  }

  resize();
  if (reduced.matches) draw(0);
  else start();

  window.addEventListener("resize", () => {
    resize();
    if (!reduced.matches) start();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (!reduced.matches) start();
  });

  document.addEventListener("motion-toggle", (event) => {
    setPaused(event.detail && event.detail.paused);
  });

  reduced.addEventListener("change", () => {
    stop();
    draw(0);
    if (!reduced.matches) start();
  });

  window.KYROlll_PETALS = { pause: () => setPaused(true), resume: () => setPaused(false) };
})();
