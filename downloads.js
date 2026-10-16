/* KYROIII — the free-download layer.
 *
 * Unifies the "DOWNLOAD FREE" package menu, the lightweight gates (YouTube +
 * email) and the actual browser downloads. No cart, no checkout, no backend.
 *
 * SMART SESSION MEMORY — nothing is ever written down:
 * - no `localStorage`, no `sessionStorage`, no cookie and no unlock set;
 * - a package unlocked in this view is remembered in one plain in-page Map
 *   (`grants`), so the visitor is never made to pass the same gate twice in
 *   one session — and the memory evaporates with the page.
 * A reload, a new tab, a bookmark or a shared link always re-opens the gate from
 * scratch, and the address is never prefilled.
 *
 * STRICT GATING (all three packages):
 * - MP3 LEASE (gate: email): EMAIL + MANDATORY OPT-IN → SUBMIT → UNLOCK + PDF.
 * - STANDARD WAV LEASE (gate: youtube): YOUTUBE SUB + LIKE → EMAIL + OPT-IN → UNLOCK + PDF.
 * - EXCLUSIVE / PRO PACKAGE (gate: exclusive): YOUTUBE SUB + LIKE →
 *   EMAIL + OPT-IN → UNLOCK (STEMS + MP3 + WAV + PDF).
 *
 * The only outbound request is the address itself: a real `fetch` POST to the
 * newsletter provider (Formspree) with `Accept: application/json`, so every
 * submitted address lands in the provider's dashboard. A failed post never
 * blocks the files — they are free — it is logged and the unlock continues.
 *
 * The address the visitor just typed is carried forward to `download.html` in
 * that one flow's query string (see `downloadUrl`), never stored.
 */
(function () {
  "use strict";

  try {
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function helpers() { return window.KYROlll_HELPERS || null; }
  function newsletterEndpoint() {
    const h = helpers();
    return h && h.newsletterEndpoint ? h.newsletterEndpoint() : "";
  }

  /* ------------------------------------------------------ low-level download */
  /* A same-origin file gets `dl`/`name` appended so the server can answer with
     `Content-Disposition: attachment` — the only reliable way to make a phone
     save an audio file instead of playing it inline. */
  function downloadHref(file, name) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(file)) return file;
    const query = "dl=1" + (name ? "&name=" + encodeURIComponent(name) : "");
    return file + (file.indexOf("?") === -1 ? "?" : "&") + query;
  }
  function triggerDownload(href, name) {
    const link = document.createElement("a");
    link.href = downloadHref(href, name);
    if (name) link.download = name;
    link.rel = "noopener noreferrer";
    link.target = "_self";
    link.style.display = "none";
    document.body.appendChild(link);
    try { link.click(); } catch (err) { /* ignore */ }
    link.remove();
  }
  function downloadItem(item) {
    if (!item || !item.file) { showToast("DOWNLOAD UNAVAILABLE"); return; }
    triggerDownload(item.file, item.name || "");
    showToast("DOWNLOAD STARTED — CHECK YOUR DOWNLOADS");
  }

  /* -------------------------------------------------------------- the flow */
  /* A one-shot token handed from a passed gate to `download.html`. It is not
     stored anywhere: it only says "this browser passed the gate in this flow a
     moment ago", so the download page does not ask a second time. Loading the
     same URL cold (no token) re-opens the gate, which is the whole point. */
  function grantToken() {
    const bytes = new Uint8Array(8);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(bytes, (b) => ("0" + b.toString(16)).slice(-2)).join("");
  }
  function downloadUrl(beatId, packageId, email) {
    let url = "download.html?beat=" + encodeURIComponent(beatId) +
      "&package=" + encodeURIComponent(packageId) + "&t=" + grantToken();
    const address = String(email == null ? "" : email).trim();
    if (address) url += "&email=" + encodeURIComponent(address);
    return url;
  }
  function goToDownload(beat, pack, email) {
    window.location.assign(downloadUrl(beat.id, pack.id, email));
  }
  /* ------------------------------------------------------ session memory
     One unlocked package per beat, remembered only for the life of this page.
     It is a plain Map — no `localStorage`, no `sessionStorage`, no cookie and
     no server — so the store keeps asking on the next visit and the browser
     keeps nothing. */
  const grants = new Map();
  function grantKey(beatId, packageId) { return String(beatId) + "::" + String(packageId); }
  function grantedEmail(beatId, packageId) {
    const key = grantKey(beatId, packageId);
    return grants.has(key) ? grants.get(key) : null;
  }
  function rememberGrant(beatId, packageId, email) {
    grants.set(grantKey(beatId, packageId), String(email == null ? "" : email).trim());
  }
  /* True only while this page view holds a grant for that package. */
  function isUnlocked(beatId, packageId) {
    return !!beatId && !!packageId && grants.has(grantKey(beatId, packageId));
  }

  /* --------------------------------------------------- the licensee identity
     The LICENSEE line of the license is the signature the visitor types on the
     download page; when nothing is typed it falls back to the address this flow
     submitted at the gate (carried in `?email=…`). Both live here because this
     module already owns "who this flow is", `license-pdf.js` only reads the
     result — and neither is stored anywhere. */
  let signature = "";
  function setSignature(value) {
    signature = String(value == null ? "" : value).trim().slice(0, 64);
    return signature;
  }
  function getSignature() { return signature; }
  function licenseeName(fallback) {
    const typed = signature || String(fallback == null ? "" : fallback).trim();
    return typed.trim();
  }

  function start(beatId, packageId) {
    const catalog = helpers();
    const beat = catalog && catalog.beatById(beatId);
    const pack = catalog && catalog.packageById(packageId);
    if (!beat || !pack) { showToast("BEAT OR PACKAGE NOT FOUND"); return; }
    const remembered = grantedEmail(beat.id, pack.id);
    if (remembered !== null) {
      showToast("ALREADY UNLOCKED THIS SESSION");
      goToDownload(beat, pack, remembered);
      return;
    }
    if (pack.gate === "instant") { goToDownload(beat, pack, ""); return; }
    openGate(beat, pack, (b, p, email) => { goToDownload(b, p, email); });
  }

  /* ------------------------------------------------------ menu */
  let activeMenu = null;
  function openMenu(trigger, beatId) {
    closeMenu();
    const catalog = helpers();
    const beat = catalog && catalog.beatById(beatId);
    if (!beat) { showToast("BEAT NOT FOUND"); return; }
    const menu = document.createElement("div");
    menu.className = "download-menu";
    menu.setAttribute("role", "menu");
    const packs = (window.KYROlll_PACKAGES || []).map((pack, i) => {
      return '<button type="button" class="download-tier" role="menuitem" data-package="' + escapeHTML(pack.id) + '" style="--tier-i:' + i + '">' +
        '<span class="download-tier__top"><span class="download-tier__name">' + escapeHTML(pack.name) + '</span>' +
        '<span class="download-tier__tag">' + escapeHTML(pack.tag || "") + '</span></span>' +
        '<span class="download-tier__blurb">' + escapeHTML(pack.blurb || "") + '</span>' +
      '</button>';
    }).join("");
    menu.innerHTML = '<div class="download-menu__head">' +
        '<span class="download-menu__kicker">DOWNLOAD FREE</span>' +
        '<span class="download-menu__beat">' + escapeHTML(beat.title) + '</span>' +
      '</div>' +
      '<div class="download-menu__list">' + packs + '</div>';
    document.body.appendChild(menu);
    activeMenu = { el: menu, anchor: trigger };
    requestAnimationFrame(() => {
      menu.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    menu.querySelectorAll(".download-tier").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeMenu();
        start(beat.id, btn.getAttribute("data-package"));
      });
    });
    trigger.setAttribute("aria-expanded", "true");
    menu.classList.add("is-open");
    positionMenu();
    window.addEventListener("scroll", guardMenuScroll, true);
    window.addEventListener("resize", closeMenu, true);
    document.addEventListener("keydown", handleMenuKey);
    document.addEventListener("click", handleMenuOutside, true);
  }
  function guardMenuScroll() { positionMenu(); }
  function handleMenuOutside(e) {
    if (activeMenu && !activeMenu.el.contains(e.target) && !activeMenu.anchor.contains(e.target)) closeMenu();
  }
  function handleMenuKey(e) { if (e.key === "Escape") closeMenu(); }
  function closeMenu() {
    if (!activeMenu) return;
    if (activeMenu.anchor) activeMenu.anchor.setAttribute("aria-expanded", "false");
    if (activeMenu.el) activeMenu.el.classList.remove("is-open");
    activeMenu.el.remove();
    activeMenu = null;
    window.removeEventListener("scroll", guardMenuScroll, true);
    window.removeEventListener("resize", closeMenu, true);
    document.removeEventListener("keydown", handleMenuKey);
    document.removeEventListener("click", handleMenuOutside, true);
  }
  function positionMenu() {
    if (!activeMenu) return;
    const { el, anchor } = activeMenu;
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(rect.width, 300);
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    el.style.width = width + "px";
    el.style.left = left + "px";
    let top = Math.max(12, rect.bottom + 10);
    let maxHeight = window.innerHeight - top - 12;
    if (maxHeight < 140) {
      top = Math.max(12, window.innerHeight - 140 - 12);
      maxHeight = window.innerHeight - top - 12;
    }
    el.style.top = top + "px";
    el.style.maxHeight = Math.max(80, maxHeight) + "px";
    el.style.overflowY = "auto";
  }

  /* escapeHTML for gate body rendering */
  function escapeHTML(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ 
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" 
    }[c]));
  }

  /* gates */
  let gate = null;
  let gateKeyHandler = null;

  function closeGate() {
    if (!gate) return;
    const node = gate;
    gate = null;
    if (gateKeyHandler) { document.removeEventListener("keydown", gateKeyHandler); gateKeyHandler = null; }
    document.removeEventListener("click", closeGate); // defensive
    node.classList.remove("is-visible");
    document.documentElement.classList.remove("gate-open");
    setTimeout(() => node.remove(), 260);
  }

  function gateShell(pack, beat, stageTitle, body) {
    const titleText = stageTitle ? (escapeHTML(stageTitle) + ' — ' + escapeHTML(beat.title)) : escapeHTML(beat.title);
    return '<div class="gate-modal__backdrop" data-gate-cancel></div>' +
      '<div class="gate-modal__card" role="dialog" aria-modal="true" aria-labelledby="gate-title">' +
        '<span class="gate-modal__kicker">' + escapeHTML(pack.name) + '</span>' +
        '<h2 class="gate-modal__title" id="gate-title">' + titleText + '</h2>' + body + '</div>';
  }

  /* The animated tick used by every completed step (and by the email field once
     the address is valid). The path draws itself on `.is-done` / `.is-valid`. */
  function tickSVG() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 12.7 9.7 17.6 19.4 6.9"/></svg>';
  }

  /* The email form used by every gate: one address field, the mandatory opt-in
     checkbox (required and pre-ticked, so it must be deliberately kept) and a
     real POST action so the form also works with scripting out of the way. */
  function emailFormHTML(optin) {
    const endpoint = newsletterEndpoint();
    return '<form class="gate-form" data-gate-form novalidate' +
        (endpoint ? ' action="' + escapeHTML(endpoint) + '" method="post"' : '') + '>' +
        '<label class="gate-field" data-gate-field><span class="gate-field__label">EMAIL' +
          '<span class="gate-field__tick" aria-hidden="true">' + tickSVG() + '</span></span>' +
          '<input class="gate-input" id="gate-email" name="email" type="email" inputmode="email" autocomplete="off" spellcheck="false" placeholder="you@email.com" required>' +
        '</label>' +
        '<label class="gate-optin"><input type="checkbox" id="gate-optin" name="opt_in" checked required><span>' + (optin || "EMAIL ME FUTURE BEAT DROPS &amp; UPDATES") + '</span></label>' +
        '<input type="hidden" name="embed" value="1">' +
        '<input type="hidden" name="tag" value="beat-download">' +
        '<input type="hidden" name="_subject" value="KYROIII BEAT DOWNLOAD">' +
      '</form>';
  }

  /* The address field turns into a satisfied tick the moment it is well formed. */
  function setFieldValid(modal, ok) {
    const field = modal.querySelector("[data-gate-field]");
    if (field) field.classList.toggle("is-valid", !!ok);
  }

  /* Email gate body — the gate every package passes through. `opts.hint: false`
     suppresses its own hint line, because a gate that already shows numbered
     steps carries a richer hint of its own (and two #gate-hint nodes in one
     dialog would be a duplicate id). */
  function emailGateBody(pack, opts) {
    const label = (opts && opts.submit) || "UNLOCK DOWNLOAD";
    return '<p class="gate-modal__copy">ENTER YOUR EMAIL TO UNLOCK THE ' + escapeHTML(pack.name) + '.</p>' +
      emailFormHTML(opts && opts.optin) +
      '<p class="gate-error" id="gate-error" role="alert" hidden></p>' +
      '<div class="gate-modal__actions">' +
        '<button type="button" class="kyrolll-btn kyrolll-btn--ghost" data-gate-cancel>CANCEL</button>' +
        '<button type="button" class="kyrolll-btn" data-gate-submit disabled>' + escapeHTML(label) + '</button>' +
      '</div>' +
      ((opts && opts.hint === false) ? '' : '<p class="gate-modal__hint" id="gate-hint">ENTER EMAIL, TICK THE BOX AND SUBMIT</p>');
  }

  /* The two YouTube steps, shared by the WAV gate and the Pro gate so both read
     exactly the same: open the channel, open the beat's own video. Each step
     carries the tick that draws itself once it has been opened. */
  function youtubeSteps(channel, video) {
    const step = (n, href, title, meta) =>
      '<a class="gate-step" href="' + escapeHTML(href) + '" target="_blank" rel="noopener noreferrer" data-gate-step="' + n + '">' +
        '<span class="gate-step__num"><span>' + (n + 1) + '</span><span class="gate-step__tick" aria-hidden="true">' + tickSVG() + '</span></span>' +
        '<span class="gate-step__body"><span class="gate-step__title">' + title + '</span><span class="gate-step__meta">' + meta + '</span></span>' +
        '<span class="gate-step__go">OPEN ↗</span>' +
      '</a>';
    return step(0, channel, "SUBSCRIBE", "TO THE KYROIII CHANNEL") +
      step(1, video, "LIKE THIS VIDEO", "THE BEAT YOU ARE GRABBING");
  }

  /* YouTube gate body - for the Standard WAV package: sub + like → email */
  function youtubeGateBody(pack, beat) {
    const channel = window.KYROlll_YOUTUBE_CHANNEL || "https://www.youtube.com/";
    const video = helpers() ? helpers().videoFor(beat.id) : channel;
    return '<p class="gate-modal__copy">THREE QUICK STEPS TO UNLOCK THE ' + escapeHTML(pack.name) + '.</p>' +
      '<div class="gate-steps">' + youtubeSteps(channel, video) + '</div>' +
      emailGateBody(pack, { hint: false }) +
      '<p class="gate-modal__hint" id="gate-hint">COMPLETE STEPS 1-2, THEN THE EMAIL</p>';
  }

  /* Exclusive gate body - for the Pro package: the same two YouTube steps as the
     Standard WAV, then the email form. There is no comment step. */
  function exclusiveGateBody(pack, beat) {
    const channel = window.KYROlll_YOUTUBE_CHANNEL || "https://www.youtube.com/";
    const video = helpers() ? helpers().videoFor(beat.id) : channel;
    return '<p class="gate-modal__copy">TWO QUICK STEPS TO UNLOCK THE ' + escapeHTML(pack.name) + '.</p>' +
      '<div class="gate-steps">' + youtubeSteps(channel, video) + '</div>' +
      emailGateBody(pack, { hint: false, submit: "UNLOCK EXCLUSIVE" }) +
      '<p class="gate-modal__hint" id="gate-hint">COMPLETE STEPS 1-2, THEN THE EMAIL</p>';
  }

  function showSuccessModal() {
    const modal = document.createElement("div");
    modal.className = "gate-modal gate-modal--success";
    modal.innerHTML =
      '<div class="gate-modal__backdrop gate-modal__backdrop--static"></div>' +
      '<div class="gate-modal__card gate-modal__card--success" role="dialog" aria-modal="true" aria-live="polite">' +
        '<div class="checkmark" aria-hidden="true">' +
          '<svg class="checkmark__svg" viewBox="0 0 52 52"><circle class="checkmark__circle" cx="26" cy="26" r="25" fill="none"/><path class="checkmark__path" fill="none" d="M14 27 21 34 38 17"/></svg>' +
        '</div>' +
        '<h3 class="gate-modal__title">ALL SET</h3>' +
        '<p class="gate-modal__copy">GATE PASSED. UNLOCKING YOUR DOWNLOAD PAGE…</p>' +
      '</div>';
    document.body.appendChild(modal);
    document.documentElement.classList.add("gate-open");
    requestAnimationFrame(() => modal.classList.add("is-visible"));
    return modal;
  }

  /* Common completion: show the success beat, remember the grant for this page
     view only, then proceed and hand the just-submitted address to the next
     step. Nothing is ever written down. */
  function finalizeGate(beat, pack, onUnlocked, email) {
    rememberGrant(beat.id, pack.id, email);
    const sm = showSuccessModal();
    setTimeout(() => {
      if (sm && sm.parentNode) sm.remove();
      if (onUnlocked) onUnlocked(beat, pack, email || "");
    }, 1400);
  }

  /* ------------------------------------------------------------ gate errors */
  function showGateError(el, message) {
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }
  function hideGateError(el) {
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
  }

  /* ------------------------------------------------------- the one submission
     Every gate funnels through here: validate, POST the address, unlock. The
     button is only ever enabled once the whole form is valid, so this is also
     the Enter-key and defensive path. */
  function submitGate(beat, pack, modal, onUnlocked, read) {
    const errEl = modal.querySelector("#gate-error");
    const submit = modal.querySelector("[data-gate-submit]");
    const input = modal.querySelector("#gate-email");
    const state = (read && read()) || {};
    if (!EMAIL_RE.test(String(state.email || ""))) {
      showGateError(errEl, "ENTER A VALID EMAIL ADDRESS");
      try { if (input) input.focus(); } catch (err) { /* ignore */ }
      return;
    }
    if (!state.optin) {
      showGateError(errEl, "TICK THE BOX TO UNLOCK YOUR DOWNLOAD");
      return;
    }
    if (!state.stepsOk) {
      showGateError(errEl, "COMPLETE THE STEPS ABOVE TO UNLOCK");
      return;
    }
    hideGateError(errEl);
    if (submit) submit.disabled = true;
    const hint = modal.querySelector("#gate-hint");
    if (hint) hint.textContent = "RECORDING YOUR EMAIL...";
    postSubscribe(state.email).then((res) => {
      if (!res.ok && typeof console !== "undefined") console.warn("KYROIII newsletter post failed:", res.error);
      closeGate();
      finalizeGate(beat, pack, onUnlocked, state.email);
    });
  }

  /* ---------------------------------------------------------- openGate dispatcher */
  function openGate(beat, pack, onUnlocked) {
    closeGate();
    /* Session memory, consulted first: a package already unlocked during this
       view never asks again (and this page's memory is all it is — see
       `grants`). A reload or a new tab has no memory and asks from scratch. */
    const remembered = grantedEmail(beat.id, pack.id);
    if (remembered !== null) {
      showToast("ALREADY UNLOCKED THIS SESSION");
      if (onUnlocked) onUnlocked(beat, pack, remembered);
      return;
    }
    const modal = document.createElement("div");
    modal.className = "gate-modal";
    
    // Build gate body based on gate type
    let body;
    if (pack.gate === "youtube") {
      body = youtubeGateBody(pack, beat);
    } else if (pack.gate === "exclusive") {
      body = exclusiveGateBody(pack, beat);
    } else {
      // email gate — the first stop for the MP3 lease
      body = emailGateBody(pack, {});
    }
    modal.innerHTML = gateShell(pack, beat, null, body);
    document.body.appendChild(modal);
    gate = modal;
    document.documentElement.classList.add("gate-open");
    requestAnimationFrame(() => modal.classList.add("is-visible"));

    const submit = modal.querySelector("[data-gate-submit]");

    // --- EMAIL GATE (MP3) — email + mandatory opt-in, nothing remembered ---
    if (pack.gate === "email") {
      const input = modal.querySelector("#gate-email");
      const optin = modal.querySelector("#gate-optin");
      const form = modal.querySelector("[data-gate-form]");
      const errEl = modal.querySelector("#gate-error");
      if (form) form.addEventListener("submit", (ev) => ev.preventDefault());
      setTimeout(() => { try { input.focus(); input.select(); } catch (err) {} }, 40);

      // The email itself never prefills and the box never checks itself later
      // than this render: a fresh gate is always a fresh gate.
      const hint = modal.querySelector("#gate-hint");
      function refresh() {
        const email = String(input && input.value || "").trim();
        const emailOk = EMAIL_RE.test(email);
        const ready = emailOk && !!(optin && optin.checked);
        submit.disabled = !ready;
        setFieldValid(modal, emailOk);
        hideGateError(errEl);
        if (hint) hint.textContent = ready ? "ALL SET — UNLOCK YOUR DOWNLOAD" : "ENTER EMAIL, TICK THE BOX AND SUBMIT";
      }
      refresh();
      const readState = () => ({
        email: String(input && input.value || "").trim(),
        optin: !!(optin && optin.checked),
        stepsOk: true
      });
      input && input.addEventListener("input", refresh);
      optin && optin.addEventListener("change", refresh);
      input && input.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        submitGate(beat, pack, modal, onUnlocked, readState);
      });
      submit.addEventListener("click", () => submitGate(beat, pack, modal, onUnlocked, readState));
    }

    // --- YOUTUBE GATE (WAV) ---
    if (pack.gate === "youtube") {
      const done = [false, false];
      const form = modal.querySelector("[data-gate-form]");
      const input = modal.querySelector("#gate-email");
      const errEl = modal.querySelector("#gate-error");
      const optin = modal.querySelector("#gate-optin");
      const hint = modal.querySelector("#gate-hint");
      if (form) form.addEventListener("submit", (ev) => ev.preventDefault());

      // Step click handlers
      modal.querySelectorAll("[data-gate-step]").forEach((step) => {
        step.addEventListener("click", () => {
          const i = Number(step.getAttribute("data-gate-step"));
          if (!done[i]) { done[i] = true; step.classList.add("is-done"); step.querySelector(".gate-step__go").textContent = "DONE ✓"; }
          refreshSubmit();
        });
      });

      function refreshSubmit() {
        const emailOk = EMAIL_RE.test(String(input && input.value || "").trim());
        const checked = optin ? optin.checked : false;
        submit.disabled = !(done[0] && done[1] && emailOk && checked);
        setFieldValid(modal, emailOk);
        hideGateError(errEl);
        if (hint) hint.textContent = (done[0] && done[1] && emailOk && checked) ? "ALL SET — UNLOCK YOUR DOWNLOAD" : "COMPLETE STEPS 1-2, THEN THE EMAIL";
      }

      // Initialize submit disabled until all conditions met
      submit.disabled = true;
      input && input.addEventListener("input", refreshSubmit);
      optin && optin.addEventListener("change", refreshSubmit);

      const readState = () => ({
        email: String(input && input.value || "").trim(),
        optin: !!(optin && optin.checked),
        stepsOk: done[0] && done[1]
      });
      submit.addEventListener("click", () => submitGate(beat, pack, modal, onUnlocked, readState));
      input && input.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        submitGate(beat, pack, modal, onUnlocked, readState);
      });
    }

    // --- EXCLUSIVE GATE (Pro) --- the same two YouTube steps as the WAV gate,
    // then the email form. There is no comment step.
    if (pack.gate === "exclusive") {
      const done = [false, false];
      const hint = modal.querySelector("#gate-hint");
      const form = modal.querySelector("[data-gate-form]");
      const input = modal.querySelector("#gate-email");
      const optin = modal.querySelector("#gate-optin");
      const errEl = modal.querySelector("#gate-error");

      if (form) form.addEventListener("submit", (ev) => ev.preventDefault());

      // Step click handlers for the two YouTube steps
      modal.querySelectorAll("[data-gate-step]").forEach((step) => {
        step.addEventListener("click", () => {
          const i = Number(step.getAttribute("data-gate-step"));
          if (i < 2 && !done[i]) { done[i] = true; step.classList.add("is-done"); step.querySelector(".gate-step__go").textContent = "DONE"; }
          checkExclusive();
        });
      });

      if (optin) optin.addEventListener("change", () => { checkExclusive(); });
      if (input) input.addEventListener("input", () => { checkExclusive(); });

      // Unlocked once both steps are opened, the address is valid and the
      // mandatory opt-in is still ticked.
      function checkExclusive() {
        const emailOk = EMAIL_RE.test(String(input && input.value || "").trim());
        const optOk = optin ? optin.checked : false;
        const all = done[0] && done[1] && emailOk && optOk;
        submit.disabled = !all;
        setFieldValid(modal, emailOk);
        hideGateError(errEl);
        if (hint) hint.textContent = all ? "ALL SET — UNLOCK YOUR DOWNLOAD" : "COMPLETE STEPS 1-2, THEN THE EMAIL";
      }

      // Initial state
      checkExclusive();

      const readState = () => ({
        email: String(input && input.value || "").trim(),
        optin: !!(optin && optin.checked),
        stepsOk: done[0] && done[1]
      });
      submit.addEventListener("click", () => submitGate(beat, pack, modal, onUnlocked, readState));
      input && input.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        submitGate(beat, pack, modal, onUnlocked, readState);
      });
    }

    // Cancel + outside-click handler
    modal.querySelectorAll("[data-gate-cancel]").forEach((el) => el.addEventListener("click", closeGate));
    const outsideClick = (e) => { if (gate && !gate.contains(e.target)) closeGate(); };
    document.addEventListener("click", outsideClick, true);
    gateKeyHandler = (ev) => { if (ev.key === "Escape") { closeGate(); document.removeEventListener("click", outsideClick, true); } };
    document.addEventListener("keydown", gateKeyHandler);
  }

  /* --------------------------------------------------- newsletter submission
     A real AJAX POST to the configured provider (Formspree), with
     `Accept: application/json` so the provider answers JSON instead of a
     redirect and the address lands in the dashboard. The body is
     form-urlencoded — a CORS-safelisted content type, so no preflight — which
     is the same shape the provider's own form sends. The promise never
     rejects; a failure is reported to the caller and the free files still
     unlock. */
  function postSubscribe(email) {
    const endpoint = newsletterEndpoint();
    if (!endpoint) return Promise.resolve({ ok: false, error: "no newsletter endpoint configured" });
    const body = new URLSearchParams();
    body.set("email", String(email || "").trim());
    body.set("opt_in", "yes");
    body.set("embed", "1");
    body.set("tag", "beat-download");
    body.set("_subject", "KYROIII BEAT DOWNLOAD");
    return fetch(endpoint, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body: body.toString()
    }).then((res) => {
      if (!res || !res.ok) return { ok: false, error: "HTTP " + (res ? res.status : "0") };
      return { ok: true };
    }).catch((err) => ({ ok: false, error: (err && err.message) || "network error" }));
  }

  /* toast */
  let toastTimer = 0;
  function showToast(message) {
    let toast = document.querySelector(".kyrolll-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "kyrolll-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  // Foolproof global listener — handles any download trigger across the page.
  document.addEventListener("click", (event) => {
    try {
      const btn = event.target.closest && event.target.closest(".download-btn, .download-dropdown-toggle, .download-trigger, [data-download-trigger]");
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      const trigger = btn.closest && btn.closest("[data-download-trigger]") ? btn.closest("[data-download-trigger]") : btn;
      const beatId = trigger && trigger.getAttribute ? trigger.getAttribute("data-beat-id") : null;
      if (beatId) {
        openMenu(trigger, beatId);
      }
    } catch (e) { /* ignore */ }
  }, true);

  /* The only memory in this module is the in-page `grants` Map: no storage
     write, no cookie, no unlock set that outlives the page and no remembered
     address. `isUnlocked` answers from that Map alone, so it is false on every
     fresh load, and the address a visitor typed only travels forward inside the
     current flow's URL. */
  window.KYROlll_DOWNLOADS = {
    PACKAGES: window.KYROlll_PACKAGES || [],
    isUnlocked: isUnlocked,
    setSignature: setSignature,
    getSignature: getSignature,
    licenseeName: licenseeName,
    downloadUrl, start, goToDownload, openMenu, closeMenu, openGate, closeGate,
    deliverablesFor: (beatId, packageId) => (helpers() ? helpers().deliverablesFor(beatId, packageId) : []),
    newsletterEndpoint, postSubscribe,
    downloadItem, showToast
  };
  } catch (e) { /* ignore top-level errors */ }
})();