/* The record on a beat page is a physical object, not a picture: pick it up and
   carry it onto the player, and the player becomes a miniature turntable. The
   full-size disc never leaves its sleeve — a fixed-position ghost, painted from
   the same photographed pressing and flower plate, does the travelling — so the
   reveal geometry, the stage, the sleeve and the label print all stay exactly
   where style.css puts them. Dropping the ghost on the player docks the deck:
   the platter fades in under the play button, the tonearm lowers, and playback
   starts inside the same pointer gesture (so the browser still treats it as a
   user-initiated play).

   The motion is a small spring, not a follow-the-cursor snap: the ghost carries
   a little velocity, tilts with its horizontal travel and settles onto the
   platter on the brand's `cubic-bezier(.16, 1, .3, 1)` curve. It is pointer
   driven only — the play button remains the fully accessible control. */
(() => {
  const LIFT_THRESHOLD = 6;
  const DROP_PADDING = 28;
  const SPRING = 0.18;
  const DAMPING = 0.78;
  const TILT_LIMIT = 10;
  const DOCK_MS = 560;
  const RETURN_MS = 420;

  const reduceMotion = () =>
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let drag = null;

  function playerFor(detail) {
    return detail ? detail.querySelector(".beat-preview") : null;
  }

  function makeGhost(rect) {
    const ghost = document.createElement("div");
    ghost.className = "vinyl-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.left = rect.left + "px";
    ghost.style.top = rect.top + "px";
    ghost.style.width = rect.width + "px";
    ghost.style.height = rect.height + "px";
    const label = document.createElement("span");
    label.className = "vinyl-ghost__label";
    ghost.appendChild(label);
    document.body.appendChild(ghost);
    return ghost;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function overPlayer(player, x, y) {
    if (!player) return false;
    const rect = player.getBoundingClientRect();
    return (
      x >= rect.left - DROP_PADDING &&
      x <= rect.right + DROP_PADDING &&
      y >= rect.top - DROP_PADDING &&
      y <= rect.bottom + DROP_PADDING
    );
  }

  function startSpring() {
    const step = () => {
      if (!drag) return;
      drag.vx += (drag.tx - drag.cx) * SPRING;
      drag.vy += (drag.ty - drag.cy) * SPRING;
      drag.vx *= DAMPING;
      drag.vy *= DAMPING;
      drag.cx += drag.vx;
      drag.cy += drag.vy;
      const tilt = clamp(drag.vx * 0.55, -TILT_LIMIT, TILT_LIMIT);
      drag.ghost.style.transform =
        "translate3d(" + drag.cx.toFixed(2) + "px, " + drag.cy.toFixed(2) + "px, 0) " +
        "rotate(" + tilt.toFixed(2) + "deg) scale(1.045)";
      drag.frame = requestAnimationFrame(step);
    };
    drag.frame = requestAnimationFrame(step);
  }

  function lift() {
    if (!drag || drag.lifted) return;
    drag.lifted = true;
    drag.ghost = makeGhost(drag.rect);
    drag.record.classList.add("is-lifted");
    document.documentElement.classList.add("vinyl-dragging");
    drag.cx = 0;
    drag.cy = 0;
    drag.vx = 0;
    drag.vy = 0;
    drag.tx = 0;
    drag.ty = 0;
    startSpring();
  }

  function release() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    if (drag && drag.frame) cancelAnimationFrame(drag.frame);
  }

  function cleanup() {
    release();
    if (!drag) return;
    if (drag.ghost && drag.ghost.parentNode) drag.ghost.remove();
    if (drag.record) drag.record.classList.remove("is-lifted");
    if (drag.player) drag.player.classList.remove("is-vinyl-target");
    document.documentElement.classList.remove("vinyl-dragging");
    drag = null;
  }

  function settle(ghost, transform, duration, done) {
    const reduce = reduceMotion();
    let settled = false;
    const finish = () => {
      /* Both the transition and its safety timer can arrive; the first one wins,
         so a stale timer can never clean up a drag that started afterwards. */
      if (settled) return;
      settled = true;
      ghost.removeEventListener("transitionend", finish);
      if (done) done();
    };
    if (reduce || !duration) {
      ghost.style.transform = transform;
      ghost.style.opacity = "1";
      finish();
      return;
    }
    ghost.style.transition =
      "transform " + duration + "ms cubic-bezier(.16, 1, .3, 1), opacity " + duration + "ms ease";
    // Force the current (spring) frame to commit before the destination is
    // written, so the browser interpolates the two instead of jumping.
    void ghost.offsetWidth;
    ghost.style.transform = transform;
    if (done) {
      ghost.addEventListener("transitionend", finish, { once: true });
      // A background tab may never deliver transitionend; the timer is the
      // safety net so a finished drag can never leave a ghost on the page.
      window.setTimeout(finish, duration + 120);
    }
  }

  function dock() {
    if (!drag) return;
    const { ghost, player, rect } = drag;
    const toggle = player.querySelector(".beat-preview__toggle");
    const target = (toggle || player).getBoundingClientRect();
    const dx = (target.left + target.width / 2) - (rect.left + rect.width / 2);
    const dy = (target.top + target.height / 2) - (rect.top + rect.height / 2);
    const scale = clamp(target.width / rect.width, 0.05, 1);
    player.classList.remove("is-vinyl-target");
    player.classList.add("is-vinyl-docked");
    const detail = player.closest(".beat-detail");
    if (detail) detail.classList.add("is-vinyl-docked");
    settle(
      ghost,
      "translate3d(" + dx.toFixed(2) + "px, " + dy.toFixed(2) + "px, 0) rotate(0deg) scale(" + scale.toFixed(3) + ")",
      reduceMotion() ? 0 : DOCK_MS,
      () => {
        if (drag) drag.record.classList.remove("is-lifted");
        cleanup();
      }
    );
    // The drop is the play gesture. A deck that is already playing is left
    // alone; a paused or fresh one starts from the top of its own state machine.
    if (toggle && toggle.getAttribute("aria-pressed") !== "true") toggle.click();
  }

  function sendBack() {
    if (!drag) return;
    const { ghost } = drag;
    settle(ghost, "translate3d(0, 0, 0) rotate(0deg) scale(1)", reduceMotion() ? 0 : RETURN_MS, () => {
      if (drag) drag.record.classList.remove("is-lifted");
      cleanup();
    });
  }

  function onMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.lifted && Math.hypot(dx, dy) < LIFT_THRESHOLD) return;
    if (!drag.lifted) lift();
    if (!drag) return;
    event.preventDefault();
    // Keep the disc's centre inside the viewport so it can never be lost off an
    // edge mid-gesture, while still letting it travel the whole screen.
    const radius = Math.max(drag.rect.width, drag.rect.height) / 2;
    const centerX = drag.rect.left + drag.rect.width / 2;
    const centerY = drag.rect.top + drag.rect.height / 2;
    const limitX = window.innerWidth - radius;
    const limitY = window.innerHeight - radius;
    drag.tx = clamp(centerX + dx, radius, Math.max(radius, limitX)) - centerX;
    drag.ty = clamp(centerY + dy, radius, Math.max(radius, limitY)) - centerY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    const over = overPlayer(drag.player, event.clientX, event.clientY);
    drag.player.classList.toggle("is-vinyl-target", over);
  }

  function onUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.lifted) {
      cleanup();
      return;
    }
    event.preventDefault();
    const over = overPlayer(drag.player, event.clientX, event.clientY);
    if (over) dock();
    else sendBack();
  }

  function onCancel(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.lifted) sendBack();
    else cleanup();
  }

  function onPointerDown(event) {
    if (drag) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const record = event.target.closest ? event.target.closest(".vinyl-record") : null;
    if (!record) return;
    const detail = record.closest(".beat-detail");
    if (!detail || !detail.classList.contains("vinyl-open")) return;
    const player = playerFor(detail);
    // A scheduled drop has no player yet, and a card with no preview has no
    // deck to receive the record; in both cases the disc stays a still image.
    if (!player) return;
    const rect = record.getBoundingClientRect();
    if (rect.width < 1) return;
    event.preventDefault();
    drag = {
      pointerId: event.pointerId,
      record,
      detail,
      player,
      rect,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      ghost: null,
      lifted: false,
      frame: 0,
      cx: 0,
      cy: 0,
      vx: 0,
      vy: 0,
      tx: 0,
      ty: 0,
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }

  document.addEventListener("pointerdown", onPointerDown, { passive: false });
  // A native drag (a selected label image, for instance) would fight the ghost.
  document.addEventListener("dragstart", (event) => {
    if (event.target.closest && event.target.closest(".vinyl-record")) event.preventDefault();
  });
})();
