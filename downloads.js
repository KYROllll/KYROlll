/* KYROlll — the free-download layer.
 * 
 * Unifies the "DOWNLOAD FREE" package menu, the lightweight gates (YouTube +
 * email) and the actual browser downloads. No network calls, no cart, no
 * checkout: the only state is what lives in `localStorage` (unlocked packages,
 * remembered email and the marketing list).
 *
 * STRICT GATING:
 * - MP3 LEASE (gate: email): Email input + submit → instant unlock + PDF.
 * - STANDARD WAV LEASE (gate: youtube): YouTube Sub + Like → Email input + submit → unlock + PDF.
 * - EXCLUSIVE / PRO PACKAGE (gate: exclusive): YouTube Sub + Like → Comment verification → 
 *   Email with mandatory opt-in checkbox + submit → unlock (Stems+MP3+WAV+PDF).
 * 
 * No signature prompt: the PDF stamps email/name automatically from localStorage.
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
  function downloadUrl(beatId, packageId) {
    return "download.html?beat=" + encodeURIComponent(beatId) + "&package=" + encodeURIComponent(packageId);
  }
  function goToDownload(beat, pack) {
    window.location.assign(downloadUrl(beat.id, pack.id));
  }
  function start(beatId, packageId) {
    const catalog = helpers();
    const beat = catalog && catalog.beatById(beatId);
    const pack = catalog && catalog.packageById(packageId);
    if (!beat || !pack) { showToast("BEAT OR PACKAGE NOT FOUND"); return; }
    openGate(beat, pack, () => { goToDownload(beat, pack); });
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

  /* Email gate body - used for MP3 instant gate */
  function emailGateBody(pack, opts) {
    const endpoint = newsletterEndpoint();
    /* Mandatory opt-in for EVERY gate — no bypass under any circumstances */
    return '<p class="gate-modal__copy">Enter your email to unlock the ' + escapeHTML(pack.name.toLowerCase()) + '.</p>' +
      '<form class="gate-form" data-gate-form novalidate' +
        (endpoint ? ' action="' + escapeHTML(endpoint) + '" method="post"' : '') + '>' +
        '<label class="gate-field"><span class="gate-field__label">EMAIL</span>' +
          '<input class="gate-input" id="gate-email" name="email" type="email" inputmode="email" autocomplete="email" spellcheck="false" placeholder="you@email.com" required>' +
        '</label>' +
        '<label class="gate-optin"><input type="checkbox" id="gate-optin" name="opt_in"' + ((opts && opts.optinRequired) ? ' required' : '') + '><span>Email me future beat drops &amp; updates</span></label>' +
        (endpoint ? '<input type="hidden" name="embed" value="1"><input type="hidden" name="tag" value="beat-download"><input type="hidden" name="_subject" value="KYROlll beat download">' : '') +
      '</form>' +
      '<p class="gate-error" id="gate-error" role="alert" hidden></p>' +
      '<div class="gate-modal__actions">' +
        '<button type="button" class="kyrolll-btn kyrolll-btn--ghost" data-gate-cancel>CANCEL</button>' +
        '<button type="button" class="kyrolll-btn" data-gate-submit disabled>UNLOCK DOWNLOAD</button>' +
      '</div>' +
      '<p class="gate-modal__hint" id="gate-hint">ENTER EMAIL AND SUBMIT</p>';
  }

  /* YouTube gate body - for WAV package: sub + like → email */
  function youtubeGateBody(pack, beat) {
    const channel = window.KYROlll_YOUTUBE_CHANNEL || "https://www.youtube.com/";
    const video = helpers() ? helpers().videoFor(beat.id) : channel;
    return '<p class="gate-modal__copy">Three quick steps to unlock the ' + escapeHTML(pack.name.toLowerCase()) + '.</p>' +
      '<div class="gate-steps">' +
        '<a class="gate-step" href="' + escapeHTML(channel) + '" target="_blank" rel="noopener noreferrer" data-gate-step="0">' +
          '<span class="gate-step__num">1</span><span class="gate-step__body"><span class="gate-step__title">SUBSCRIBE</span><span class="gate-step__meta">To the KYROlll channel</span></span><span class="gate-step__go">OPEN ↗</span>' +
        '</a>' +
        '<a class="gate-step" href="' + escapeHTML(video) + '" target="_blank" rel="noopener noreferrer" data-gate-step="1">' +
          '<span class="gate-step__num">2</span><span class="gate-step__body"><span class="gate-step__title">LIKE THIS VIDEO</span><span class="gate-step__meta">The beat you are grabbing</span></span><span class="gate-step__go">OPEN ↗</span>' +
        '</a>' +
      '</div>' +
      emailGateBody(pack, { optinRequired: true }) +
      '<p class="gate-modal__hint" id="gate-hint">COMPLETE STEPS 1-2 AND ENTER EMAIL TO UNLOCK</p>';
  }

  /* Exclusive gate body - for Pro package: sub + like → comment → email with mandatory opt-in */
  function exclusiveGateBody(pack, beat) {
    const channel = window.KYROlll_YOUTUBE_CHANNEL || "https://www.youtube.com/";
    const video = helpers() ? helpers().videoFor(beat.id) : channel;
    return '<p class="gate-modal__copy">Four high-value steps to unlock the ' + escapeHTML(pack.name.toLowerCase()) + '.</p>' +
      '<div class="gate-steps">' +
        '<a class="gate-step" href="' + escapeHTML(channel) + '" target="_blank" rel="noopener noreferrer" data-gate-step="0">' +
          '<span class="gate-step__num">1</span><span class="gate-step__body"><span class="gate-step__title">SUBSCRIBE</span><span class="gate-step__meta">To the KYROlll channel</span></span><span class="gate-step__go">OPEN ↗</span>' +
        '</a>' +
        '<a class="gate-step" href="' + escapeHTML(video) + '" target="_blank" rel="noopener noreferrer" data-gate-step="1">' +
          '<span class="gate-step__num">2</span><span class="gate-step__body"><span class="gate-step__title">LIKE THIS VIDEO</span><span class="gate-step__meta">The beat you are grabbing</span></span><span class="gate-step__go">OPEN ↗</span>' +
        '</a>' +
        '<div class="gate-step gate-step--comment" data-gate-step="2">' +
          '<span class="gate-step__num">3</span>' +
          '<span class="gate-step__body">' +
            '<span class="gate-step__title">COMMENT ON THE VIDEO</span>' +
            '<span class="gate-step__meta">Paste a verification comment</span>' +
            '<textarea class="gate-input gate-comment" id="gate-comment" placeholder="Paste your comment to verify..." rows="2"></textarea>' +
          '</span>' +
          '<span class="gate-step__go">DONE</span>' +
        '</div>' +
      '</div>' +
      '<form class="gate-form" data-gate-form novalidate>' +
        '<label class="gate-field"><span class="gate-field__label">EMAIL</span>' +
          '<input class="gate-input" id="gate-email" name="email" type="email" inputmode="email" autocomplete="email" spellcheck="false" placeholder="you@email.com" required>' +
        '</label>' +
        '<label class="gate-optin"><input type="checkbox" id="gate-optin" name="opt_in" checked required><span>Email me future beat drops &amp; updates</span></label>' +
        '<input type="hidden" name="embed" value="1"><input type="hidden" name="tag" value="beat-download"><input type="hidden" name="_subject" value="KYROlll beat download">' +
      '</form>' +
      '<p class="gate-error" id="gate-error" role="alert" hidden></p>' +
      '<div class="gate-modal__actions">' +
        '<button type="button" class="kyrolll-btn kyrolll-btn--ghost" data-gate-cancel>CANCEL</button>' +
        '<button type="button" class="kyrolll-btn" data-gate-submit disabled>UNLOCK EXCLUSIVE</button>' +
      '</div>' +
      '<p class="gate-modal__hint" id="gate-hint">COMPLETE ALL STEPS TO UNLOCK</p>';
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
        '<p class="gate-modal__copy">Gate passed. Unlocking your download page…</p>' +
      '</div>';
    document.body.appendChild(modal);
    document.documentElement.classList.add("gate-open");
    requestAnimationFrame(() => modal.classList.add("is-visible"));
    return modal;
  }

  /* Common completion: mark unlocked, show success, proceed */
  function finalizeGate(beat, pack, onUnlocked) {
    const sm = showSuccessModal();
    setTimeout(() => {
      if (sm && sm.parentNode) sm.remove();
      if (onUnlocked) onUnlocked(beat, pack);
    }, 1400);
  }

  /* ---------------------------------------------------------- openGate dispatcher */
  function openGate(beat, pack, onUnlocked) {
    closeGate();
    const modal = document.createElement("div");
    modal.className = "gate-modal";
    
    // Build gate body based on gate type
    let body;
    if (pack.gate === "youtube") {
      body = youtubeGateBody(pack, beat);
    } else if (pack.gate === "exclusive") {
      body = exclusiveGateBody(pack, beat);
    } else {
      // email gate (MP3 instant)
      body = emailGateBody(pack, { optinRequired: pack.gate === "exclusive" });
    }
    modal.innerHTML = gateShell(pack, beat, null, body);
    document.body.appendChild(modal);
    gate = modal;
    document.documentElement.classList.add("gate-open");
    requestAnimationFrame(() => modal.classList.add("is-visible"));

    const submit = modal.querySelector("[data-gate-submit]");

    // --- EMAIL GATE (MP3) — direct, bulletproof ---
    if (pack.gate === "email") {
      const input = modal.querySelector("#gate-email");
      const optin = modal.querySelector("#gate-optin");
      setTimeout(() => { try { input.focus(); input.select(); } catch (err) {} }, 40);

      function isReady() {
        const email = String(input && input.value || "").trim();
        // MP3 (email gate): email required; checkbox optional
        return EMAIL_RE.test(email);
      }

      const handleSubmit = (ev) => {
        if (ev && ev.cancelable && ev.type === "submit") ev.preventDefault();
        const email = String(input && input.value || "").trim();
        if (!EMAIL_RE.test(email)) {
          const errEl = modal.querySelector("#gate-error");
          if (errEl) { errEl.textContent = "ENTER A VALID EMAIL ADDRESS"; errEl.hidden = false; }
          try { input && input.focus(); } catch (e) {}
          return;
        }
        const checked = optin ? optin.checked : false;
        const form = modal.querySelector("[data-gate-form]");
        const wantsUpdates = checked;
        if (wantsUpdates && newsletterEndpoint()) {
          const advance = () => { closeGate(); finalizeGate(beat, pack, onUnlocked); };
          postSubscribeForm(form, advance);
        } else {
          closeGate();
          finalizeGate(beat, pack, onUnlocked);
        }
      };

      function refresh() { submit.disabled = !isReady(); }
      submit.disabled = !isReady();
      input && input.addEventListener("input", refresh);
      input && input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") handleSubmit(ev); });
      optin && optin.addEventListener("change", refresh);
      submit.addEventListener("click", handleSubmit);
    }

    // --- YOUTUBE GATE (WAV) ---
    if (pack.gate === "youtube") {
      const done = [false, false];
      const form = modal.querySelector("[data-gate-form]");
      const input = modal.querySelector("#gate-email");
      const errEl = modal.querySelector("#gate-error");
      const optin = modal.querySelector("#gate-optin");
      const hint = modal.querySelector("#gate-hint");

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
        if (hint) hint.textContent = (done[0] && done[1] && emailOk && checked) ? "ALL SET — UNLOCK YOUR DOWNLOAD" : "COMPLETE STEPS 1-2 AND ENTER EMAIL TO UNLOCK";
      }

      // Initialize submit disabled until all conditions met
      submit.disabled = true;
      input && input.addEventListener("input", refreshSubmit);
      optin && optin.addEventListener("change", refreshSubmit);

      const handleSubmit = () => {
        if (submit.disabled) return;
        const email = String(input.value || "").trim();
        if (!EMAIL_RE.test(email)) {
          if (errEl) { errEl.textContent = "ENTER A VALID EMAIL ADDRESS"; errEl.hidden = false; }
          if (input) try { input.focus(); } catch (err) {}
          return;
        }
        if (!optin || !optin.checked) {
          if (errEl) { errEl.textContent = "YOU MUST CHECK CONSENT TO UNLOCK"; errEl.hidden = false; }
          return;
        }
        const wantsUpdates = optin.checked;
        const advance = () => { closeGate(); finalizeGate(beat, pack, onUnlocked); };
        if (form && wantsUpdates && newsletterEndpoint()) postSubscribeForm(form, advance); else advance();
      };

      submit.addEventListener("click", handleSubmit);
    }

    // --- EXCLUSIVE GATE (Pro) ---
    if (pack.gate === "exclusive") {
      const done = [false, false, false];
      const hint = modal.querySelector("#gate-hint");
      const commentField = modal.querySelector("#gate-comment");
      const form = modal.querySelector("[data-gate-form]");
      const input = modal.querySelector("#gate-email");
      const optin = modal.querySelector("#gate-optin");
      const errEl = modal.querySelector("#gate-error");

      if (form) form.addEventListener("submit", (ev) => ev.preventDefault());

      // Remembered email
      setTimeout(() => { try { input.focus(); input.select(); } catch (err) {} }, 40);

      // Step click handlers for steps 0 and 1 (YouTube)
      modal.querySelectorAll("[data-gate-step='0'],[data-gate-step='1']").forEach((step) => {
        step.addEventListener("click", () => {
          const i = Number(step.getAttribute("data-gate-step"));
          if (i < 2 && !done[i]) { done[i] = true; step.classList.add("is-done"); step.querySelector(".gate-step__go").textContent = "DONE"; }
          checkExclusive();
        });
      });

      // Step 2: Comment verification
      if (commentField) {
        commentField.addEventListener("input", () => {
          done[2] = (commentField.value.trim().length > 0);
          checkExclusive();
        });
      }
      if (optin) {
        optin.addEventListener("change", () => { checkExclusive(); });
      }
      if (input) {
        input.addEventListener("input", () => { checkExclusive(); });
      }

      // Check if all steps done (including valid email + consent)
      function checkExclusive() {
        const commentOk = (commentField && commentField.value.trim().length > 0);
        const emailOk = EMAIL_RE.test(String(input && input.value || "").trim());
        const optOk = optin ? optin.checked : false;
        const all = done[0] && done[1] && commentOk && emailOk && optOk;
        submit.disabled = !all;
        if (hint) hint.textContent = all ? "ALL SET — UNLOCK YOUR DOWNLOAD" : "COMPLETE ALL STEPS TO UNLOCK";
      }

      // Initial state
      checkExclusive();

      const handleSubmit = (ev) => {
        if (ev && ev.cancelable) ev.preventDefault();
        if (submit.disabled) return;

        const email = String(input.value || "").trim();
        if (!EMAIL_RE.test(email)) {
          if (errEl) { errEl.textContent = "ENTER A VALID EMAIL ADDRESS"; errEl.hidden = false; }
          return;
        }
        // Mandatory consent checkbox for exclusive
        if (!optin || !optin.checked) {
          if (errEl) { errEl.textContent = "YOU MUST CHECK CONSENT TO UNLOCK"; errEl.hidden = false; }
          return;
        }

        const wantsUpdates = optin.checked;
        const advance = () => { closeGate(); finalizeGate(beat, pack, onUnlocked); };
        if (form && wantsUpdates && newsletterEndpoint()) postSubscribeForm(form, advance); else advance();
      };

      submit.addEventListener("click", handleSubmit);
      input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") handleSubmit(ev); });
    }

    // Cancel + outside-click handler
    modal.querySelectorAll("[data-gate-cancel]").forEach((el) => el.addEventListener("click", closeGate));
    const outsideClick = (e) => { if (gate && !gate.contains(e.target)) closeGate(); };
    document.addEventListener("click", outsideClick, true);
    gateKeyHandler = (ev) => { if (ev.key === "Escape") { closeGate(); document.removeEventListener("click", outsideClick, true); } };
    document.addEventListener("keydown", gateKeyHandler);
  }

  /* Real Formspree AJAX — every submitted email recorded in dashboard */
  function postSubscribeForm(form, done) {
    const emailInput = form && form.querySelector ? form.querySelector('input[name="email"]') : null;
    const optinInput = form && form.querySelector ? form.querySelector('input[name="opt_in"]') : null;
    const email = emailInput ? String(emailInput.value || "").trim() : "";
    const optIn = optinInput ? !!optinInput.checked : false;
    if (!email) { if (done) done(); return; }
    const data = new FormData();
    data.append("email", email);
    data.append("opt_in", optIn ? "yes" : "no");
    fetch("https://formspree.io/f/xgaoppwo", {
      method: "POST",
      headers: { "Accept": "application/json" },
      body: data
    }).catch(() => { /* ignore — unlock proceeds regardless */ });
    if (done) done();
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
      console.log("DOWNLOAD CLICKED SUCCESSFULLY");
      event.preventDefault();
      event.stopPropagation();
      const trigger = btn.closest && btn.closest("[data-download-trigger]") ? btn.closest("[data-download-trigger]") : btn;
      const beatId = trigger && trigger.getAttribute ? trigger.getAttribute("data-beat-id") : null;
      if (beatId) {
        openMenu(trigger, beatId);
      }
    } catch (e) { /* ignore */ }
  }, true);

  window.KYROlll_DOWNLOADS = {
    PACKAGES: window.KYROlll_PACKAGES || [],
    readEmail: () => "", writeEmail: () => {}, readLicensee: () => "", writeLicensee: () => {},
    isUnlocked: () => false, markUnlocked: () => {},
    downloadUrl, start, goToDownload, openMenu, closeMenu, openGate, closeGate,
    deliverablesFor: (beatId, packageId) => (helpers() ? helpers().deliverablesFor(beatId, packageId) : []),
    newsletterEndpoint,
    downloadItem, showToast
  };
  } catch (e) { /* ignore top-level errors */ }
})();