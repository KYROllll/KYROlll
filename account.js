/* KYROlll — account, checkout and success front-end (no sign-in).
 *
 * The UI layer that sits on top of `kyrolll-backend.js`: the downward-only
 * license dropdown, the optional email step of the BUY flow, the post-checkout
 * success screen and the toast. There is no account, session or library any
 * more — a purchase is an email and a hosted NOWPayments invoice, and the beat
 * plus its PDF license are delivered by email. */
(function () {
  "use strict";

  const PENDING_KEY = "kyrolll_pending_purchase";

  const backend = () => window.KYROlll_BACKEND || null;
  const helpers = () => window.KYROlll_HELPERS || null;
  const escapeHTML = (value) =>
    helpers()
      ? helpers().escapeHTML(value)
      : String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
          "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[char]));
  const licenseFor = (id) => (window.KYROlll_LICENSES || []).find((license) => license.id === id) || null;
  const beatById = (id) => (window.KYROlll_CATALOG || []).find((beat) => beat.id === id || beat.slug === id) || null;

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* ignore */ }
  }
  function removeKey(key) {
    try { localStorage.removeItem(key); } catch (err) { /* ignore */ }
  }

  const getPendingPurchase = () => readJSON(PENDING_KEY, null);
  const setPendingPurchase = (purchase) => writeJSON(PENDING_KEY, purchase);
  const clearPendingPurchase = () => removeKey(PENDING_KEY);

  /* ---------------------------------------------------------- license menu */

  let activeMenu = null;
  // A scroll closes the fixed menu so it can never drift away from its button.
  // The tail of the menu's own opening scroll must not count as the user
  // scrolling, so events are ignored for a moment after the menu reveals.
  let scrollGuardUntil = 0;
  function guardMenuScroll() {
    if (performance.now() < scrollGuardUntil) return;
    closeLicenseMenu();
  }

  function openLicenseMenu(anchor, beat) {
    if (!anchor || !beat) { closeLicenseMenu(); return; }
    // A second click on the same BUY toggles the dropdown shut instead of
    // re-opening it, so the button never appears to need a double click.
    if (activeMenu && activeMenu.anchor === anchor) { closeLicenseMenu(); return; }
    closeLicenseMenu();
    const menu = document.createElement("div");
    menu.className = "license-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Choose a license");
    menu.innerHTML =
      '<div class="license-menu__head">' +
        '<span class="license-menu__kicker">SELECT LICENSE</span>' +
        '<span class="license-menu__beat">' + escapeHTML(beat.title) + "</span>" +
      "</div>" +
      (window.KYROlll_LICENSES || []).map((license, index) =>
        '<button type="button" class="license-tier" role="menuitem" style="--tier-i:' + index + '" data-license-id="' + license.id + '">' +
          '<span class="license-tier__top">' +
            '<span class="license-tier__name">' + escapeHTML(license.name) + "</span>" +
            '<span class="license-tier__price">' + escapeHTML(license.price) + "</span>" +
          "</span>" +
          '<span class="license-tier__blurb">' + escapeHTML(license.blurb) + "</span>" +
        "</button>"
      ).join("");
    document.body.appendChild(menu);
    activeMenu = { el: menu, anchor };
    anchor.setAttribute("aria-expanded", "true");

    menu.addEventListener("click", (event) => {
      const tier = event.target.closest("[data-license-id]");
      if (!tier) return;
      const license = licenseFor(tier.getAttribute("data-license-id"));
      closeLicenseMenu();
      if (license) beginPurchase(beat, license);
    });

    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rect = anchor.getBoundingClientRect();
    const offscreen = rect.top < 12 || rect.bottom > window.innerHeight - 12;

    // Position and reveal only once the BUY button is guaranteed on screen.
    // Scrolling first — and arming the close-on-scroll listener only afterwards
    // — is what removes the old bug where the programmatic scroll shut the menu
    // the instant it opened (the reason BUY sometimes needed several clicks).
    const reveal = () => {
      if (!activeMenu || activeMenu.el !== menu) return;
      positionLicenseMenu();
      // Ignore the tail of the opening scroll so the close-on-scroll guard can
      // never shut the menu in the same breath it opened.
      scrollGuardUntil = performance.now() + 260;
      // Next frame so the menu transitions up from its hidden start state.
      requestAnimationFrame(() => {
        if (activeMenu && activeMenu.el === menu) menu.classList.add("is-open");
      });
      window.addEventListener("scroll", guardMenuScroll, true);
      window.addEventListener("resize", closeLicenseMenu, true);
      document.addEventListener("keydown", handleMenuKey);
      setTimeout(() => document.addEventListener("click", handleMenuOutside, true), 0);
    };

    if (!reduceMotion) {
      // Always attempt a buttery, animated scroll into view so the BUY
      // interaction feels premium whether the button is scrolled up or down.
      anchor.scrollIntoView({ block: "center", behavior: "smooth" });
      waitForScrollSettle(reveal);
    } else {
      if (offscreen) anchor.scrollIntoView({ block: "center", behavior: "auto" });
      requestAnimationFrame(reveal);
    }
  }

  // Resolve when the page stops moving so the menu locks onto the button's
  // final position. A debounced scroll plus a hard ceiling guards against a
  // browser that never reports a settle, and against a page that cannot scroll
  // (where no scroll event would ever fire).
  function waitForScrollSettle(done) {
    let finished = false;
    let settle = 0;
    let ceiling = 0;
    let sawScroll = false;
    const supportsScrollEnd = "onscrollend" in window;
    function finish() {
      if (finished) return;
      finished = true;
      window.removeEventListener("scroll", onScroll, true);
      if (supportsScrollEnd) window.removeEventListener("scrollend", finish);
      clearTimeout(settle);
      clearTimeout(ceiling);
      done();
    }
    function onScroll() {
      sawScroll = true;
      if (supportsScrollEnd) return; // scrollend is the precise "stopped" signal
      clearTimeout(settle);
      settle = setTimeout(finish, 140);
    }
    window.addEventListener("scroll", onScroll, true);
    if (supportsScrollEnd) window.addEventListener("scrollend", finish);
    // If the page is already at rest nothing scrolls — open straight away.
    settle = setTimeout(() => { if (!sawScroll) finish(); }, 260);
    // Last-resort guard if the settle signal never arrives.
    ceiling = setTimeout(finish, 2600);
  }

  // Always opens downward: pinned just under the button, and if the viewport is
  // short the menu is clamped to the space below and scrolls, so it can never
  // flip up over the header, the logo or the footer copy.
  function positionLicenseMenu() {
    if (!activeMenu) return;
    const { el, anchor } = activeMenu;
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(rect.width, 300);
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    el.style.width = width + "px";
    el.style.left = left + "px";
    const top = Math.max(12, rect.bottom + 10);
    el.style.top = top + "px";
    el.style.maxHeight = Math.max(140, window.innerHeight - top - 16) + "px";
    el.style.overflowY = "auto";
  }

  function handleMenuOutside(event) {
    if (activeMenu && !activeMenu.el.contains(event.target) && !activeMenu.anchor.contains(event.target)) {
      closeLicenseMenu();
    }
  }

  function handleMenuKey(event) {
    if (event.key === "Escape") closeLicenseMenu();
  }

  function closeLicenseMenu() {
    if (!activeMenu) return;
    if (activeMenu.anchor) activeMenu.anchor.setAttribute("aria-expanded", "false");
    activeMenu.el.remove();
    activeMenu = null;
    window.removeEventListener("scroll", guardMenuScroll, true);
    window.removeEventListener("resize", closeLicenseMenu, true);
    document.removeEventListener("keydown", handleMenuKey);
    document.removeEventListener("click", handleMenuOutside, true);
  }

  /* --------------------------------------------------------- checkout flow */

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // A tier was chosen: remember it, then ask (optionally) for the delivery
  // email and hand off to the invoice. No account is involved at any point.
  function beginPurchase(beat, license) {
    const file = helpers() ? helpers().fileFor(beat.id, license.id) : null;
    setPendingPurchase({
      beatId: beat.id,
      beatTitle: beat.title,
      tierId: license.id,
      tier: license.name,
      price: license.price,
      audioPath: file && file.path,
      audioName: file && file.name,
      email: "",
      at: Date.now()
    });
    const b = backend();
    if (!b || !b.configured || !b.payments || !b.payments.createInvoice) {
      // No project attached (local demo): the tier's static invoice still works.
      window.location.assign(license.url);
      return;
    }
    promptCheckoutEmail(beat, license);
  }

  // Reuse the (already styled) logout-modal shell as the email step so this adds
  // no new visual language: same backdrop, card and buttons. Skipping is a
  // first-class path — NOWPayments asks for an email on its own page.
  let emailModal = null;

  function closeEmailModal() {
    if (!emailModal) return;
    const el = emailModal;
    emailModal = null;
    el.classList.remove("is-visible");
    if (document.documentElement.classList.contains("logout-open")) {
      document.documentElement.classList.remove("logout-open");
    }
    setTimeout(() => el.remove(), 260);
  }

  function promptCheckoutEmail(beat, license) {
    closeEmailModal();
    const modal = document.createElement("div");
    modal.className = "logout-modal";
    modal.innerHTML =
      '<div class="logout-modal__backdrop" data-email-cancel></div>' +
      '<div class="logout-modal__card" role="dialog" aria-modal="true" aria-labelledby="checkout-email-title">' +
        '<span class="logout-modal__kicker">' + escapeHTML(license.name) + " · " + escapeHTML(license.price) + "</span>" +
        '<h2 class="logout-modal__title" id="checkout-email-title">' + escapeHTML(beat.title) + "</h2>" +
        '<p class="logout-modal__copy">Where should we send your beat and PDF license? You can also skip this and add it on the payment page.</p>' +
        '<label class="auth-field"><span class="auth-field__label">EMAIL (OPTIONAL)</span>' +
          '<input class="auth-input" id="checkout-email" type="email" inputmode="email" autocomplete="email" spellcheck="false" placeholder="you@email.com">' +
        '</label>' +
        '<p class="auth-error" id="checkout-email-error" role="alert" hidden></p>' +
        '<div class="logout-modal__actions">' +
          '<button type="button" class="kyrolll-btn kyrolll-btn--ghost" data-email-skip>SKIP</button>' +
          '<button type="button" class="kyrolll-btn" data-email-continue>CONTINUE TO PAYMENT</button>' +
        '</div>' +
        '<p class="logout-modal__hint">Paying with crypto — you will be taken to NOWPayments to finish.</p>' +
      "</div>";
    document.body.appendChild(modal);
    emailModal = modal;
    document.documentElement.classList.add("logout-open");
    requestAnimationFrame(() => modal.classList.add("is-visible"));

    const input = modal.querySelector("#checkout-email");
    const error = modal.querySelector("#checkout-email-error");
    setTimeout(() => { try { input.focus(); } catch (err) { /* ignore */ } }, 40);

    const rememberEmail = (email) => {
      const purchase = getPendingPurchase();
      if (purchase) setPendingPurchase(Object.assign({}, purchase, { email }));
    };
    const submit = (event) => {
      if (event && event.cancelable) event.preventDefault();
      const email = String(input.value || "").trim();
      if (email && !EMAIL_RE.test(email)) {
        error.textContent = "ENTER A VALID EMAIL ADDRESS";
        error.hidden = false;
        try { input.focus(); } catch (err) { /* ignore */ }
        return;
      }
      rememberEmail(email);
      closeEmailModal();
      startPayment(beat, license, email);
    };

    modal.querySelector("[data-email-continue]").addEventListener("click", submit);
    modal.querySelector("[data-email-skip]").addEventListener("click", () => {
      rememberEmail("");
      closeEmailModal();
      startPayment(beat, license, "");
    });
    modal.querySelector("[data-email-cancel]").addEventListener("click", closeEmailModal);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(event); });
    modal.addEventListener("keydown", (event) => { if (event.key === "Escape") closeEmailModal(); });
  }

  // Ask the `create-payment` function for a NOWPayments invoice, then send the
  // browser to the hosted URL it returns. The function prices the order
  // server-side and returns `{ url }`; the license row itself is written only by
  // `nowpayments-webhook`, with the service_role key, once the payment is
  // finished and — later — the delivery email is sent from there.
  let paymentInFlight = false;
  async function startPayment(beat, license, email) {
    if (!beat || !license) return;
    const b = backend();
    if (!b || !b.configured || !b.payments || !b.payments.createInvoice) {
      window.location.assign(license.url);
      return;
    }
    if (paymentInFlight) return;
    paymentInFlight = true;
    showToast("CREATING YOUR INVOICE…");
    try {
      const invoice = await b.payments.createInvoice({ beatId: beat.id, licenseType: license.id, email });
      const url = invoice && (invoice.url || invoice.invoice_url);
      if (!url) throw new Error("NO INVOICE URL");
      window.location.assign(url);
      return;
    } catch (err) {
      console.warn("KYROlll: create-payment failed", err);
      showToast("CHECKOUT UNAVAILABLE — TRY AGAIN");
    } finally {
      paymentInFlight = false;
    }
  }

  /* ----------------------------------------------------------- success page */

  function initSuccessPage() {
    const pending = getPendingPurchase();
    const fallbackBeat = (window.KYROlll_CATALOG || [])[0] || {};
    const fallbackTier = licenseFor("mp3") || {};
    const purchase = pending || {
      beatId: fallbackBeat.id,
      beatTitle: fallbackBeat.title || "—",
      tierId: "mp3",
      tier: fallbackTier.name || "MP3 LEASE",
      price: fallbackTier.price || "$9.95"
    };
    const setText = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    setText("det-title", purchase.beatTitle || "—");
    setText("det-tier", purchase.tier || "—");
    setText("det-price", purchase.price || "—");
    setText("det-status", "ACTIVE // SENT BY EMAIL");

    const subtitle = document.getElementById("success-subtitle");
    if (subtitle) {
      const email = String(purchase.email || "").trim();
      subtitle.textContent = email
        ? "Your beat and PDF license are on their way to " + email + "."
        : "Your beat and PDF license are on their way to the email you paid with.";
    }
  }

  /* ----------------------------------------------------------------- toast */

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
    void toast.offsetWidth; // replay the entrance even on a repeated toast
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  /* ------------------------------------------------------------------- boot */

  function boot() {
    try {
      if (document.querySelector(".success-page")) initSuccessPage();
    } catch (err) {
      console.error("KYROlll account init error:", err);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.KYROlll_ACCOUNT = {
    LICENSES: window.KYROlll_LICENSES || [],
    escapeHTML,
    beatById,
    licenseFor,
    // Beats that have been sold on an exclusive license (BUY locks + cover seal).
    soldExclusive: () => {
      const b = backend();
      return b && b.licenses && b.licenses.soldExclusive ? b.licenses.soldExclusive() : Promise.resolve([]);
    },
    getPendingPurchase,
    setPendingPurchase,
    clearPendingPurchase,
    beginPurchase,
    openLicenseMenu,
    closeLicenseMenu,
    showToast
  };
})();
