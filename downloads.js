/* KYROlll — the free-download layer.
 *
 * Unifies the "DOWNLOAD FREE" package menu, the lightweight gates (YouTube +
 * email) and the actual browser downloads. No network calls, no cart, no
 * checkout: the only state is what lives in `localStorage` (unlocked packages,
 * remembered email and the marketing list). */
(function () {
  "use strict";

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const STORAGE_PREFIX = "kyrolll_";
  const UNLOCK_KEY = STORAGE_PREFIX + "unlocked";
  const EMAIL_KEY = STORAGE_PREFIX + "download_email";
  const MARKETING_KEY = STORAGE_PREFIX + "marketing_list";

  function helpers() { return window.KYROlll_HELPERS || null; }
  function newsletterEndpoint() {
    const h = helpers();
    return h && h.newsletterEndpoint ? h.newsletterEndpoint() : "";
  }

  function readStore(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* ignore */ }
  }
  function isUnlocked(beatId, packageId) {
    const list = readStore(UNLOCK_KEY) || [];
    const id = beatId + "::" + packageId;
    return list.indexOf(id) !== -1;
  }
  function markUnlocked(beatId, packageId) {
    const list = readStore(UNLOCK_KEY) || [];
    const id = beatId + "::" + packageId;
    if (list.indexOf(id) === -1) { list.push(id); writeStore(UNLOCK_KEY, list); }
  }

  /* ------------------------------------------------------ low-level download */
  /* A same-origin file gets `dl`/`name` appended so the server can answer with
     `Content-Disposition: attachment` — the only reliable way to make a phone
     save an audio file instead of playing it inline. The `download` attribute
     alone is ignored by some mobile and in-app browsers. External/absolute URLs
     are left untouched. */
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
    if (isUnlocked(beat.id, pack.id)) {
      goToDownload(beat, pack);
      return;
    }
    openGate(beat, pack, () => { goToDownload(beat, pack); });
  }

  /* email */
  function readEmail() { return (readStore(EMAIL_KEY) || "").trim() || ""; }
  function rememberEmail(email) { writeStore(EMAIL_KEY, String(email || "").trim()); }
  function addToMarketingList(email) {
    if (!EMAIL_RE.test(String(email || "").trim())) return;
    const list = readStore(MARKETING_KEY) || [];
    const addr = String(email).trim().toLowerCase();
    if (list.some((entry) => (entry && entry.email || "").toLowerCase() === addr)) return;
    list.push({ email: addr, at: Date.now() });
    writeStore(MARKETING_KEY, list);
  }

  /* menu */
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
    // Smooth-scroll the menu into view so mobile visitors land on the drawer,
    // not on the trigger they just tapped.
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
    window.addEventListener("scrollend", positionMenu, { once: true });
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

  /* gates */
  let gate = null;
  let gateKeyHandler = null;
  function escapeHTML(v) {
    return String(v == null ? "" : v).replace(/[&<>\"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  }
  function closeGate() {
    if (!gate) return;
    const node = gate;
    gate = null;
    if (gateKeyHandler) { document.removeEventListener("keydown", gateKeyHandler); gateKeyHandler = null; }
    node.classList.remove("is-visible");
    document.documentElement.classList.remove("gate-open");
    setTimeout(() => node.remove(), 260);
  }
  function gateShell(pack, beat, stageTitle, body) {
    if (arguments.length === 3) { body = stageTitle; stageTitle = null; }
    const titleText = stageTitle ? (escapeHTML(stageTitle) + ' — ' + escapeHTML(beat.title)) : escapeHTML(beat.title);
    return '<div class="gate-modal__backdrop" data-gate-cancel></div>' +
      '<div class="gate-modal__card" role="dialog" aria-modal="true" aria-labelledby="gate-title">' +
        '<span class="gate-modal__kicker">' + escapeHTML(pack.name) + '</span>' +
        '<h2 class="gate-modal__title" id="gate-title">' + titleText + '</h2>' + body + '</div>';
  }
  function emailGateBody(pack, opts) {
    const endpoint = newsletterEndpoint();
    const mandatory = opts && opts.optinRequired;
    const checkboxAtt = mandatory ? ' checked required' : ' checked';
    return '<form class="gate-form" data-gate-form novalidate' +
        (endpoint ? ' action="' + escapeHTML(endpoint) + '" method="post"' : '') + '>' +
      '<p class="gate-modal__copy">Enter your email to unlock the ' + escapeHTML(pack.name.toLowerCase()) + '.</p>' +
      '<label class="gate-field"><span class="gate-field__label">EMAIL</span>' +
        '<input class="gate-input" id="gate-email" name="email" type="email" inputmode="email" autocomplete="email" spellcheck="false" placeholder="you@email.com" required>' +
      '</label>' +
      '<label class="gate-optin"><input type="checkbox" id="gate-optin"' + checkboxAtt + '><span>Email me future beat drops &amp; updates</span></label>' +
      (endpoint ? '<input type="hidden" name="embed" value="1"><input type="hidden" name="tag" value="beat-download"><input type="hidden" name="_subject" value="KYROlll beat download">' : '') +
      '</form>';
  }

  /* The provider's submit endpoint must be a real form POST, so the gate posts
     through a throwaway hidden iframe: the page never navigates, and we move on
     once the response has landed — or after a short grace period, so a blocked
     iframe can never stall the unlock. */
  function postSubscribeForm(form, done) {
    const name = "kyrolll-subscribe-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const frame = document.createElement("iframe");
    frame.name = name;
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
    let settled = false;
    let timer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (frame.parentNode) frame.remove();
      done();
    };
    frame.addEventListener("load", finish);
    document.body.appendChild(frame);
    timer = setTimeout(finish, 2500);
    form.target = name;
    try { form.submit(); } catch (err) { finish(); }
  }
  function youtubeGateBody(pack, beat) {
    const channel = window.KYROlll_YOUTUBE_CHANNEL || "https://www.youtube.com/";
    const video = helpers() ? helpers().videoFor(beat.id) : channel;
    return '<p class="gate-modal__copy">Two quick steps on YouTube, then the ' + escapeHTML(pack.name.toLowerCase()) + ' unlocks.</p>' +
      '<div class="gate-steps">' +
        '<a class="gate-step" href="' + escapeHTML(channel) + '" target="_blank" rel="noopener noreferrer" data-gate-step="0">' +
          '<span class="gate-step__num">1</span><span class="gate-step__body"><span class="gate-step__title">SUBSCRIBE</span><span class="gate-step__meta">To the KYROlll channel</span></span><span class="gate-step__go">OPEN ↗</span>' +
        '</a>' +
        '<a class="gate-step" href="' + escapeHTML(video) + '" target="_blank" rel="noopener noreferrer" data-gate-step="1">' +
          '<span class="gate-step__num">2</span><span class="gate-step__body"><span class="gate-step__title">LIKE THIS VIDEO</span><span class="gate-step__meta">The beat you are grabbing</span></span><span class="gate-step__go">OPEN ↗</span>' +
        '</a>' +
      '</div>' +
      '<p class="gate-error" id="gate-error" role="alert" hidden></p>' +
      '<div class="gate-modal__actions">' +
        '<button type="button" class="kyrolll-btn kyrolll-btn--ghost" data-gate-cancel>CANCEL</button>' +
        '<button type="button" class="kyrolll-btn" data-gate-submit disabled>I HAVE DONE BOTH</button>' +
      '</div>' +
      '<p class="gate-modal__hint" id="gate-hint">OPEN BOTH STEPS TO UNLOCK</p>';
  }
  /* Exclusive / Pro multi-step gate:
     1) YouTube Subscribe + Like (same as youtube gate)
     2) YouTube Comment verification prompt (user types a comment, we just ensure non-empty)
     3) Email with mandatory opt-in checkbox */
  function exclusiveGateBody(pack, beat) {
    const channel = window.KYROlll_YOUTUBE_CHANNEL || "https://www.youtube.com/";
    const video = helpers() ? helpers().videoFor(beat.id) : channel;
    const endpoint = newsletterEndpoint();
  return '<p class="gate-modal__copy">Three high-value steps to unlock the ' + escapeHTML(pack.name.toLowerCase()) + '.</p>' +
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
            '<span class="gate-step__meta">Paste your comment here to verify</span>' +
            '<textarea class="gate-input gate-comment" id="gate-comment" placeholder="Paste your comment..." rows="2"></textarea>' +
          '</span>' +
          '<span class="gate-step__go">DONE</span>' +
        '</div>' +
      '</div>' +
      '<form class="gate-form" data-gate-form action="' + escapeHTML(endpoint) + '" method="post" novalidate>' +
        '<label class="gate-field"><span class="gate-field__label">EMAIL</span>' +
          '<input class="gate-input" id="gate-email" name="email" type="email" inputmode="email" autocomplete="email" spellcheck="false" placeholder="you@email.com" required>' +
        '</label>' +
        '<label class="gate-optin"><input type="checkbox" id="gate-optin" checked><span>Email me future beat drops &amp; updates</span></label>' +
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
  function openGate(beat, pack, onUnlocked) {
    closeGate();
    const modal = document.createElement("div");
    modal.className = "gate-modal";
    modal.innerHTML = gateShell(pack, beat, pack.gate === "youtube" ? youtubeGateBody(pack, beat) : (pack.gate === "exclusive" ? exclusiveGateBody(pack, beat) : emailGateBody(pack)));
    document.body.appendChild(modal);
    gate = modal;
    document.documentElement.classList.add("gate-open");
    requestAnimationFrame(() => modal.classList.add("is-visible"));
    const submit = modal.querySelector("[data-gate-submit]");
    if (pack.gate === "youtube") {
      const done = [false, false];
      const hint = modal.querySelector("#gate-hint");
      modal.querySelectorAll("[data-gate-step]").forEach((step) => {
        step.addEventListener("click", () => {
          const i = Number(step.getAttribute("data-gate-step"));
          if (!done[i]) { done[i] = true; step.classList.add("is-done"); step.querySelector(".gate-step__go").textContent = "DONE ✓"; }
          if (done[0] && done[1]) { submit.disabled = false; hint.textContent = "ALL SET — UNLOCK YOUR DOWNLOAD"; }
        });
      });
      submit.addEventListener("click", () => {
        if (submit.disabled) return;
        const steps = modal.querySelectorAll("[data-gate-step]");
        let ytDone = [false, false];
        steps.forEach((s, i) => { if (i < 2) ytDone[i] = s.classList.contains("is-done"); });
        if (ytDone[0] && ytDone[1]) {
          renderEmailStage(beat, pack, () => finalizeGate(beat, pack, onUnlocked));
        } else {
          steps.forEach((s, i) => { if (i < 2 && !ytDone[i]) { s.classList.add("is-done"); s.querySelector(".gate-step__go").textContent = "DONE"; } });
        }
      });
    } else if (pack.gate === "exclusive") {
      const done = [false, false, false];
      const hint = modal.querySelector("#gate-hint");
      const stepBtn = modal.querySelector("[data-gate-step='2']");
      const commentField = modal.querySelector("#gate-comment");
      // Steps 0 and 1 are the YouTube subscribe + like links
      modal.querySelectorAll("[data-gate-step='0'],[data-gate-step='1']").forEach((step) => {
        step.addEventListener("click", () => {
          const i = Number(step.getAttribute("data-gate-step"));
          if (i < 2 && !done[i]) { done[i] = true; step.classList.add("is-done"); step.querySelector(".gate-step__go").textContent = "DONE"; }
          checkExclusive();
        });
      });
      // Step 2: comment verification — non-empty input marks done
      if (commentField) {
        commentField.addEventListener("input", () => {
          done[2] = (commentField.value.trim().length > 0);
          checkExclusive();
        });
      }
      const form = modal.querySelector("[data-gate-form]");
      const input = modal.querySelector("#gate-email");
      const optin = modal.querySelector("#gate-optin");
      if (form) form.addEventListener("submit", (ev) => ev.preventDefault());
      const remembered = readEmail();
      if (remembered) input.value = remembered;
      setTimeout(() => { try { input.focus(); input.select(); } catch (err) {} }, 40);
      const submitEmail = (ev) => {
        if (ev && ev.cancelable) ev.preventDefault();
        const email = String(input.value || "").trim();
        if (!EMAIL_RE.test(email)) {
          const errEl = modal.querySelector("#gate-error");
          if (errEl) { errEl.textContent = "ENTER A VALID EMAIL ADDRESS"; errEl.hidden = false; }
          try { input.focus(); } catch (err) {}
          return;
        }
        // Mandatory consent checkbox must be checked
        if (!optin || !optin.checked) {
          const errEl = modal.querySelector("#gate-error");
          if (errEl) { errEl.textContent = "YOU MUST CHECK CONSENT TO UNLOCK"; errEl.hidden = false; }
          return;
        }
        rememberEmail(email);
        const wantsUpdates = optin.checked;
        if (wantsUpdates) addToMarketingList(email);
        const advance = () => { renderSignatureStage(beat, pack, () => finalizeGate(beat, pack, onUnlocked)); };
        if (form && wantsUpdates && newsletterEndpoint()) postSubscribeForm(form, advance); else advance();
      };
      submit.addEventListener("click", submitEmail);
      input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submitEmail(ev); });
      // Helper that enables submit when youtube steps + comment + consent done
      // (consent is checked at click time; for UX we just require youtube + comment here)
      function checkExclusive() {
        const commentOk = (commentField && commentField.value.trim().length > 0) || (done[2]);
        const all = done[0] && done[1] && commentOk;
        submit.disabled = !all;
        if (hint) hint.textContent = all ? "ALL SET — UNLOCK YOUR DOWNLOAD" : "COMPLETE ALL STEPS TO UNLOCK";
      }
    } else {
      const form = modal.querySelector("[data-gate-form]");
      const input = modal.querySelector("#gate-email");
      const optin = modal.querySelector("#gate-optin");
      // Stop a native Enter press from posting before the consent box is read;
      // the manual `form.submit()` below bypasses this listener.
      if (form) form.addEventListener("submit", (ev) => ev.preventDefault());
      const remembered = readEmail();
      if (remembered) input.value = remembered;
      setTimeout(() => { try { input.focus(); input.select(); } catch (err) {} }, 40);
      const submitEmail = (ev) => {
        if (ev && ev.cancelable) ev.preventDefault();
        const email = String(input.value || "").trim();
        if (!EMAIL_RE.test(email)) {
          const errEl = modal.querySelector("#gate-error");
          if (errEl) { errEl.textContent = "ENTER A VALID EMAIL ADDRESS"; errEl.hidden = false; }
          try { input.focus(); } catch (err) {}
          return;
        }
        rememberEmail(email);
        const wantsUpdates = !optin || optin.checked;
        if (wantsUpdates) addToMarketingList(email);
        const advance = () => renderEmailStage(beat, pack, () => finalizeGate(beat, pack, onUnlocked));
        if (form && wantsUpdates && newsletterEndpoint()) postSubscribeForm(form, advance); else advance();
      };
      submit.addEventListener("click", submitEmail);
      input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submitEmail(ev); });
    }
    modal.querySelectorAll("[data-gate-cancel]").forEach((el) => el.addEventListener("click", closeGate));
    gateKeyHandler = (ev) => { if (ev.key === "Escape") closeGate(); };
    document.addEventListener("keydown", gateKeyHandler);
  }

  /* license: there is no text license any more — `license-pdf.js` issues the
     document itself, so nothing here renders or hands over license copy. */

  /* toast */

  /* Email stage is shared across all packages — every package must leave an
     address before it can be unlocked; the opt-in checkbox is mandatory only
     for Exclusive / Pro. The POST survives the move to its page. */
  function renderEmailStage(beat, pack, onEmailDone) {
    if (gate) closeGate();
    const modal = document.createElement("div");
    modal.className = "gate-modal";
    const mandatory = pack.gate === "exclusive";
    modal.innerHTML = gateShell(pack, beat, "YOUR EMAIL", emailGateBody(pack, { optinRequired: mandatory }));
    document.body.appendChild(modal);
    gate = modal;
    document.documentElement.classList.add("gate-open");
    requestAnimationFrame(() => modal.classList.add("is-visible"));
    const form = modal.querySelector("[data-gate-form]");
    const input = modal.querySelector("#gate-email");
    const optin = modal.querySelector("#gate-optin");
    if (form) form.addEventListener("submit", (ev) => ev.preventDefault());
    const remembered = readEmail();
    if (remembered) input.value = remembered;
    setTimeout(() => { try { input.focus(); input.select(); } catch (err) {} }, 40);
    const submitEmail = (ev) => {
      if (ev && ev.cancelable) ev.preventDefault();
      const email = String(input.value || "").trim();
      if (!EMAIL_RE.test(email)) {
        const errEl = modal.querySelector("#gate-error");
        if (errEl) { errEl.textContent = "ENTER A VALID EMAIL ADDRESS"; errEl.hidden = false; }
        try { input.focus(); } catch (err) {}
        return;
      }
      if (mandatory && (!optin || !optin.checked)) {
        const errEl = modal.querySelector("#gate-error");
        if (errEl) { errEl.textContent = "CHECK THE BOX TO UNLOCK"; errEl.hidden = false; }
        return;
      }
      rememberEmail(email);
      const wantsUpdates = !optin || optin.checked;
      if (wantsUpdates) addToMarketingList(email);
      const submitBtn = modal.querySelector("[data-gate-submit]");
      if (submitBtn) submitBtn.disabled = true;
      const advance = () => { closeGate(); onEmailDone(); };
      if (form && wantsUpdates && newsletterEndpoint()) postSubscribeForm(form, advance); else advance();
    };
    modal.querySelector("[data-gate-submit]").addEventListener("click", submitEmail);
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submitEmail(ev); });
    modal.querySelectorAll("[data-gate-cancel]").forEach((el) => el.addEventListener("click", closeGate));
    gateKeyHandler = (ev) => { if (ev.key === "Escape") closeGate(); };
    document.addEventListener("keydown", gateKeyHandler);
  }

  /* Signature stage (Exclusive only): the artist's typed signature is embedded
     in the license PDF and stored for future visits. */
  function renderSignatureStage(beat, pack, onSigned) {
    if (gate) closeGate();
    const modal = document.createElement("div");
    modal.className = "gate-modal";
    modal.innerHTML = gateShell(pack, beat, "SIGN YOUR LICENSE",
      '<p class="gate-modal__copy">Type your artist / producer name to sign the certificate.</p>' +
      '<label class="gate-field"><span class="gate-field__label">SIGNATURE</span>' +
        '<input class="gate-input" id="gate-signature" type="text" autocomplete="name" spellcheck="false" placeholder="Your name" aria-label="Your signature" required>' +
      '</label>' +
      '<p class="gate-error" id="gate-error" role="alert" hidden></p>' +
      '<div class="gate-modal__actions">' +
        '<button type="button" class="kyrolll-btn kyrolll-btn--ghost" data-gate-cancel>CANCEL</button>' +
        '<button type="button" class="kyrolll-btn" data-gate-submit>UNLOCK DOWNLOAD</button>' +
      '</div>');
    document.body.appendChild(modal);
    gate = modal;
    document.documentElement.classList.add("gate-open");
    requestAnimationFrame(() => modal.classList.add("is-visible"));
    const input = modal.querySelector("#gate-signature");
    try { const r = localStorage.getItem("kyrolll_licensee") || ""; if (r) input.value = r; } catch (err) {}
    setTimeout(() => { try { input.focus(); input.select(); } catch (err) {} }, 40);
    const submitSig = () => {
      const name = String(input.value || "").trim();
      if (!name) {
        const errEl = modal.querySelector("#gate-error");
        if (errEl) { errEl.textContent = "ENTER YOUR NAME"; errEl.hidden = false; }
        try { input.focus(); } catch (err) {}
        return;
      }
      try { localStorage.setItem("kyrolll_licensee", name); } catch (err) {}
      closeGate();
      onSigned();
    };
    modal.querySelector("[data-gate-submit]").addEventListener("click", submitSig);
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submitSig(); });
    modal.querySelectorAll("[data-gate-cancel]").forEach((el) => el.addEventListener("click", closeGate));
    gateKeyHandler = (ev) => { if (ev.key === "Escape") closeGate(); };
    document.addEventListener("keydown", gateKeyHandler);
  }

  /* Common completion used by every gate chain — mark unlocked, show success
     checkmark, then hand off to the download page. */
  function finalizeGate(beat, pack, onUnlocked) {
    markUnlocked(beat.id, pack.id);
    const sm = showSuccessModal();
    setTimeout(() => { if (sm && sm.parentNode) sm.remove(); onUnlocked(beat, pack); }, 1400);
  }

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

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest && event.target.closest("[data-download-trigger]");
    if (!trigger) return;
    event.preventDefault();
    openMenu(trigger, trigger.getAttribute("data-beat-id"));
  });

  window.KYROlll_DOWNLOADS = {
    PACKAGES: window.KYROlll_PACKAGES || [],
    readEmail, rememberEmail, isUnlocked, markUnlocked,
    downloadUrl, start, goToDownload, openMenu, closeMenu, openGate, closeGate,
    deliverablesFor: (beatId, packageId) => (helpers() ? helpers().deliverablesFor(beatId, packageId) : []),
    newsletterEndpoint,
    downloadItem, showToast
  };
})();
