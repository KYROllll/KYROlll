/* KYROlll — account, license and library front-end.
 *
 * The UI layer that sits on top of `kyrolll-backend.js`: it renders the header
 * account controls, the downward-only license dropdown, the dedicated auth /
 * dashboard / library pages and the post-checkout success screen. All data
 * access (Supabase Auth + Storage + Postgres, or the local demo fallback) goes
 * through `window.KYROlll_BACKEND`, so nothing here holds a secret. */
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
  const getCurrentUser = () => {
    const b = backend();
    return b ? b.auth.currentUser() : null;
  };

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

  /* ------------------------------------------------------------ license text */

  function buildLicenseText(user, item) {
    const holder = (user && user.username) || "—";
    const email = (user && user.email) || "—";
    const tier = licenseFor(item.tierId) || {};
    // The table no longer stores the beat title or the tier's display name —
    // only `beat_id` and `license_type` — so resolve them from the catalog when
    // the item does not already carry them.
    const beat = helpers() ? helpers().beatById(item.beatId) : null;
    const beatTitle = item.beatTitle || (beat && beat.title) || item.beatId || "";
    const tierName = item.tier || tier.name || item.tierId || "";
    const rights = (tier.rights || []).map((line) => "  - " + line).join("\n");
    return [
      "KYROlll — OFFICIAL LICENSE CERTIFICATE",
      "======================================",
      "LICENSE ID : " + (item.id || ""),
      "BEAT       : " + beatTitle,
      "TIER       : " + tierName,
      "PRICE      : " + (item.price || ""),
      "LICENSEE   : " + holder,
      "EMAIL      : " + email,
      "DATE       : " + (item.date || new Date().toLocaleDateString()),
      "",
      "GRANT OF RIGHTS",
      rights || "  - License granted as described at checkout.",
      "",
      "This certifies that the licensee named above has secured the " + (tierName || "license") + " for",
      "\"" + beatTitle + "\" from KYROlll.",
      "",
      "This license is non-transferable. All rights not expressly granted remain",
      "the property of KYROlll. A signed PDF copy is delivered to the email on file.",
      "",
      "(C) " + new Date().getFullYear() + " KYROlll. All rights reserved."
    ].join("\n");
  }

  // Record a purchase into the signed-in user's permanent library (Supabase or
  // the local cache). Safe to call twice on the same beat + tier — it de-dupes.
  async function recordPurchase(purchase) {
    const b = backend();
    if (!b) return null;
    return b.licenses.add(purchase);
  }

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

  // A tier was chosen: remember it, then either hand the buyer to the
  // `create-payment` Edge Function (which mints the NOWPayments invoice) or —
  // when signed out — to the auth page, which resumes checkout afterwards.
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
      at: Date.now()
    });
    if (!getCurrentUser()) {
      window.location.href = "auth.html?next=checkout&reason=purchase";
    } else {
      startPayment(beat, license);
    }
  }

  // Ask Supabase's `create-payment` function for a NOWPayments invoice, then
  // send the browser to the hosted URL it returns. The function verifies the
  // buyer's token, prices the order server-side and returns `{ url }`; the
  // license row itself is written only by `nowpayments-webhook`, with the
  // service_role key, once the payment is finished. The static invoice links in
  // `catalog.js` are the local-demo fallback, used only when no Supabase project
  // is attached.
  let paymentInFlight = false;
  async function startPayment(beat, license) {
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
      const invoice = await b.payments.createInvoice({ beatId: beat.id, licenseType: license.id });
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

  /* ---------------------------------------------------------- header render */

  function headerAvatarHTML(user) {
    if (user.avatarUrl) {
      return '<span class="header-auth__avatar"><img src="' + escapeHTML(user.avatarUrl) + '" alt=""></span>';
    }
    const initial = String(user.username || "?").charAt(0).toUpperCase();
    return '<span class="header-auth__avatar header-auth__avatar--initial">' + escapeHTML(initial) + "</span>";
  }

  function renderHeaderAuth() {
    const host = document.getElementById("header-auth");
    if (!host) return;
    const user = getCurrentUser();
    if (user) {
      host.innerHTML =
        '<a class="header-auth__user" href="dashboard.html" title="' + escapeHTML(user.email || "") + '">' +
          headerAvatarHTML(user) +
          '<span class="header-auth__name">' + escapeHTML(user.username) + "</span>" +
        "</a>" +
        '<a class="auth-link" href="library.html">MY LIBRARY</a>' +
        '<button type="button" class="auth-link" data-auth-action="logout">LOG OUT</button>';
    } else {
      host.innerHTML =
        '<a class="auth-link" href="auth.html?mode=login">LOG IN</a>' +
        '<a class="auth-link auth-link--solid" href="auth.html?mode=signup">SIGN UP</a>';
    }
  }

  /* -------------------------------------------------------------- auth page */

  function setError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message || "";
    el.hidden = !message;
  }

  function setInfo(id, on) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = !on;
  }

  function finishAuth(params) {
    const next = params.get("next");
    if (next === "checkout" || params.get("reason") === "purchase") {
      const pending = getPendingPurchase();
      const license = pending && licenseFor(pending.tierId);
      const beat = (pending && helpers() && helpers().beatById(pending.beatId)) ||
        (pending && { id: pending.beatId, title: pending.beatTitle });
      if (license) { startPayment(beat, license); return; }
    }
    if (next === "support") {
      window.location.assign("support.html");
      return;
    }
    if (next && next !== "checkout" && /^[\w./#?=-]+$/.test(next)) {
      window.location.assign(next);
      return;
    }
    window.location.assign("library.html");
  }

  function initAuthPage() {
    const params = new URLSearchParams(location.search);
    const backBtn = document.querySelector("[data-auth-back]");
    if (backBtn) {
      try {
        const paramsBack = new URLSearchParams(location.search);
        let target = paramsBack.get("back");
        if (!target) {
          const ref = document.referrer;
          if (ref && /^https?:\/\/[^/]+/.test(ref)) {
            try {
              const r = new URL(ref, location.origin);
              if (r.origin === location.origin) target = r.pathname + r.search + r.hash;
            } catch (e) { target = null; }
          }
        }
        if (target) {
          // keep relative/safe paths
          if (target.startsWith("http://") || target.startsWith("https://")) target = null;
        }
        if (target) backBtn.setAttribute("href", target);
      } catch (e) { /* ignore */ }
    }    const loginForm = document.getElementById("login-form");
    const signupForm = document.getElementById("signup-form");
    const confirmForm = document.getElementById("confirm-form");
    const tabsEl = document.querySelector(".auth-tabs");
    const demo = document.getElementById("auth-demo");
    const demoCodeEl = document.getElementById("confirm-demo");
    const loginGuide = document.getElementById("login-guide-signup");
    const b = backend();
    const otpLength = (b && b.otpLength) || 6;
    let pending = null;      // { email, username, createUser } for the last code sent
    let origin = "login";    // which tab to return to from the code step
    let verified = false;    // true once a code is accepted — the success overlay is playing
    let verifying = false;   // true while a verify round-trip is in flight

    if (demo && b && b.mode === "local") demo.hidden = false;

    const views = { login: loginForm, signup: signupForm, confirm: confirmForm };
    function show(which) {
      Object.keys(views).forEach((key) => { if (views[key]) views[key].hidden = key !== which; });
      if (tabsEl) tabsEl.hidden = which === "confirm";
      document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
        tab.classList.toggle("is-active", tab.getAttribute("data-auth-tab") === which);
      });
      const title = document.getElementById("auth-title");
      const sub = document.getElementById("auth-sub");
      const copy = {
        login: ["WELCOME BACK", "NO PASSWORD — WE EMAIL YOU A " + otpLength + "-DIGIT CODE."],
        signup: ["CREATE ACCOUNT", "ONE CODE CREATES YOUR ACCOUNT AND SIGNS YOU IN."],
        confirm: ["CHECK YOUR EMAIL", "ENTER THE " + otpLength + "-DIGIT CODE WE JUST SENT YOU."]
      };
      if (title) title.textContent = copy[which][0];
      if (sub) sub.textContent = copy[which][1];
      setError("login-error", "");
      setError("signup-error", "");
      setError("confirm-error", "");
      if (loginGuide) loginGuide.hidden = true;
      setInfo("confirm-info", false);
    }

    // GoTrue rejects a sign-in-only (`create_user: false`) OTP request for an
    // address that has no account; surface that exact case as "not registered".
    function isNotRegistered(err) {
      if (!err) return false;
      if (err.code === "otp_disabled") return true;
      return /signups not allowed|not registered|user not found/i.test(String(err.message || ""));
    }

    /* --- continuous one-time-code input ----------------------------------- */
    const codeInput = document.getElementById("confirm-code");
    if (codeInput) {
      codeInput.maxLength = otpLength;
      codeInput.placeholder = "0".repeat(Math.max(otpLength, 0));
      codeInput.addEventListener("input", () => {
        codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, otpLength);
        maybeAutoSubmit();
      });
    }
    function codeValue() { return codeInput ? codeInput.value.replace(/\D/g, "").slice(0, otpLength) : ""; }

    // The moment the last digit lands the code is complete, so verify without
    // making the visitor reach for "VERIFY & CONTINUE". Guarded so a resend, an
    // in-flight check, or an already-accepted code can never double-submit.
    function maybeAutoSubmit() {
      if (!confirmForm || verified || verifying || !pending) return;
      if (codeValue().length !== otpLength) return;
      // requestSubmit() runs the form's submit listeners synchronously; the
      // dispatchEvent fallback keeps older engines working. Both are trusted
      // form submissions, so the handler's `event.preventDefault()` still holds.
      if (typeof confirmForm.requestSubmit === "function") confirmForm.requestSubmit();
      else confirmForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    }
    function clearCode() { if (codeInput) codeInput.value = ""; }
    function focusCode() { if (codeInput) setTimeout(() => { try { codeInput.focus(); } catch (err) { /* ignore */ } }, 60); }

    function setDemoCode(code) {
      if (!demoCodeEl) return;
      demoCodeEl.hidden = !code;
      demoCodeEl.textContent = code ? "LOCAL DEMO CODE: " + code : "";
    }

    // One-shot success overlay: fades in, draws the ring + check, then hands
    // off to the dashboard / checkout / next destination. Reduced-motion and
    // the shared motion toggle get the same confirmation but without the draw.
    async function playSuccess(authParams) {
      const overlay = document.getElementById("auth-success");
      if (!overlay) { finishAuth(authParams); return; }
      const label = document.getElementById("auth-success-label");
      if (label) label.textContent = origin === "signup" ? "WELCOME TO KYROlll" : "WELCOME BACK";
      overlay.hidden = false;
      requestAnimationFrame(() => overlay.classList.add("is-visible"));
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches ||
        document.documentElement.classList.contains("motion-paused");
      await new Promise((resolve) => setTimeout(resolve, still ? 380 : 1250));
      finishAuth(authParams);
    }

    function showConfirm() {
      const shown = document.getElementById("confirm-email");
      if (shown) shown.textContent = (pending && pending.email) || "";
      show("confirm");
      setInfo("confirm-info", false);
      clearCode();
      focusCode();
    }

    async function sendCode(fields, errorId, button) {
      setError(errorId, "");
      button.disabled = true;
      try {
        const result = await b.auth.signInWithOtp(fields);
        pending = fields;
        setDemoCode(result && result.demoCode);
        showConfirm();
      } catch (err) {
        if (fields.createUser === false && isNotRegistered(err)) {
          setError(errorId, "EMAIL NOT REGISTERED — SIGN UP TO CONTINUE");
          if (loginGuide) loginGuide.hidden = false;
        } else {
          setError(errorId, (((err && err.message) || "COULD NOT SEND THE CODE")).toUpperCase());
        }
      } finally {
        button.disabled = false;
      }
    }

    if (tabsEl) tabsEl.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-auth-tab]");
      if (tab) show(tab.getAttribute("data-auth-tab"));
    });

    // "SIGN UP INSTEAD" — one click switches to the sign-up tab, keeping the
    // email the visitor already typed.
    if (loginGuide) loginGuide.addEventListener("click", () => {
      setInfo("confirm-info", false);
      if (signupForm && signupForm.email && loginForm && loginForm.email.value.trim()) {
        signupForm.email.value = loginForm.email.value.trim();
      }
      show("signup");
      if (signupForm && signupForm.username) {
        setTimeout(() => { try { signupForm.username.focus(); } catch (err) { /* ignore */ } }, 60);
      }
    });

    if (loginForm) loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const email = loginForm.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("login-error", "ENTER A VALID EMAIL ADDRESS");
      origin = "login";
      // Sign-in only: an address without an account is rejected so the page can
      // say it is not registered and point the user at sign-up.
      sendCode({ email, createUser: false }, "login-error", loginForm.querySelector(".auth-submit"));
    });

    if (signupForm) signupForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const username = signupForm.username.value.trim();
      const email = signupForm.email.value.trim();
      if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) return setError("signup-error", "USERNAME MUST BE 3-24 LETTERS, NUMBERS, _ . -");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("signup-error", "ENTER A VALID EMAIL ADDRESS");
      origin = "signup";
      sendCode({ email, username, createUser: true }, "signup-error", signupForm.querySelector(".auth-submit"));
    });

    if (confirmForm) confirmForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (verified || verifying) return;
      const token = codeValue();
      setError("confirm-error", "");
      setInfo("confirm-info", false);
      if (!new RegExp("^\\d{" + otpLength + "}$").test(token)) return setError("confirm-error", "ENTER THE " + otpLength + "-DIGIT CODE FROM YOUR EMAIL");
      const button = confirmForm.querySelector(".auth-submit");
      verifying = true;
      button.disabled = true;
      try {
        await b.auth.verifyOtp({ email: pending && pending.email, token, type: "email" });
        verified = true;
        playSuccess(params);
      } catch (err) {
        setError("confirm-error", "THE CODE IS INCORRECT");
        clearCode();
        focusCode();
      } finally {
        button.disabled = false;
        verifying = false;
      }
    });

    const resend = document.getElementById("confirm-resend");
    if (resend) resend.addEventListener("click", async () => {
      if (!pending || verified) return;
      setError("confirm-error", "");
      // Inform immediately, while the code is actually being resent — this note
      // is neutral/white, never the red error treatment.
      setInfo("confirm-info", true);
      try {
        const result = await b.auth.signInWithOtp(pending);
        setDemoCode(result && result.demoCode);
        clearCode();
        focusCode();
      } catch (err) {
        setInfo("confirm-info", false);
        setError("confirm-error", "COULD NOT RESEND THE CODE");
      }
    });

    const back = document.getElementById("confirm-back");
    if (back) back.addEventListener("click", () => show(origin));

    const wantSignup = params.get("mode") === "signup" || (params.get("reason") === "purchase" && !getCurrentUser());
    show(wantSignup ? "signup" : "login");
  }

  /* --------------------------------------------------------- dashboard page */

  function fileToAvatarDataURL(file, size) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          const scale = Math.max(size / img.width, size / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          try { resolve(canvas.toDataURL("image/jpeg", 0.85)); } catch (err) { resolve(""); }
        };
        img.onerror = () => resolve("");
        img.src = reader.result;
      };
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  }

  function paintAvatar(el, user) {
    if (!el) return;
    if (user.avatarUrl) el.innerHTML = '<img src="' + escapeHTML(user.avatarUrl) + '" alt="Your profile picture">';
    else el.innerHTML = '<span class="avatar-initial">' + escapeHTML(String(user.username || "?").charAt(0).toUpperCase()) + "</span>";
  }

  function initDashboardPage() {
    const b = backend();
    let user = getCurrentUser();
    if (!user) {
      window.location.replace("auth.html?next=dashboard.html");
      return;
    }
    const form = document.getElementById("profile-form");
    const nameInput = document.getElementById("profile-username");
    const emailInput = document.getElementById("profile-email");
    const avatar = document.getElementById("profile-avatar");
    const fileInput = document.getElementById("profile-avatar-input");
    const status = document.getElementById("profile-status");
    let avatarDataUrl = "";

    const userIdEl = document.getElementById("profile-user-id");
    const copyBtn = document.getElementById("copy-user-id");
    nameInput.value = user.username || "";
    emailInput.value = user.email || "";
    if (userIdEl) userIdEl.value = user.id || "";
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        try {
          if (userIdEl && userIdEl.value) await navigator.clipboard.writeText(userIdEl.value);
          if (copyBtn) { copyBtn.textContent = "COPIED"; setTimeout(() => { copyBtn.textContent = "Copy ID"; }, 1200); }
        } catch (e) { /* ignore */ }
      });
    }
    paintAvatar(avatar, user);

    if (fileInput) fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      avatarDataUrl = await fileToAvatarDataURL(file, 256);
      if (avatarDataUrl && avatar) {
        avatar.innerHTML = '<img src="' + avatarDataUrl + '" alt="Selected profile picture">';
      }
    });

    if (form) form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (status) status.textContent = "SAVING…";
      try {
        let avatarUrl = user.avatarUrl || "";
        if (avatarDataUrl) avatarUrl = await b.storage.uploadAvatar(avatarDataUrl, "image/jpeg");
        user = await b.auth.updateProfile({ username: nameInput.value.trim(), avatarUrl });
        paintAvatar(avatar, user);
        if (status) status.textContent = "SAVED";
      } catch (err) {
        if (status) status.textContent = (((err && err.message) || "COULD NOT SAVE")).toUpperCase();
      }
    });
  }

  /* ----------------------------------------------------------- library page */

  function libraryItemHTML(user, item) {
    const beat = beatById(item.beatId);
    const art = (beat && beat.img) || "assets/flesh.png";
    // `beat_title` and `tier` are no longer columns — resolve the display names
    // from the catalog by `beat_id` / `license_type`.
    const tier = licenseFor(item.tierId) || {};
    const title = item.beatTitle || (beat && beat.title) || item.beatId || "—";
    const tierName = item.tier || tier.name || item.tierId || "—";
    const status = String(item.status || "").toUpperCase();
    return '<li class="library-item">' +
      '<div class="library-item__art"><img src="' + escapeHTML(art) + '" alt="" loading="lazy" decoding="async"></div>' +
      '<div class="library-item__body">' +
        '<div class="library-item__row">' +
          '<h2 class="library-item__title">' + escapeHTML(title) + "</h2>" +
          '<span class="library-item__tier">' + escapeHTML(tierName) + "</span>" +
        "</div>" +
        '<p class="library-item__meta">' + escapeHTML(item.price) + " · SECURED " + escapeHTML(item.date) +
          (status ? " · " + escapeHTML(status) : "") + " · " + escapeHTML(item.id) + "</p>" +
        '<p class="library-item__help">Download your leased master straight to this device, or open the official KYROlll PDF license for this purchase.</p>' +
        '<div class="library-item__actions">' +
          '<button type="button" class="kyrolll-btn" data-download data-license-id="' + escapeHTML(item.id) + '">DOWNLOAD AUDIO</button>' +
          '<button type="button" class="kyrolll-btn" data-pdf data-license-id="' + escapeHTML(item.id) + '">LICENSE (PDF)</button>' +
        "</div>" +
      "</div>" +
    "</li>";
  }

  function libraryHTML(user, items, diagnostic) {
    console.log("KYROlll: libraryHTML rendering", { count: (items || []).length, userId: user ? user.id : null, broken: !!(diagnostic && diagnostic.error) });
    const head =
      '<header class="library-head">' +
        '<div class="library-head__id">' +
          '<span class="library-head__kicker">SIGNED IN AS</span>' +
          '<h1 class="library-head__name">' + escapeHTML(user.username) + "</h1>" +
          '<p class="library-head__email">' + escapeHTML(user.email) + "</p>" +
        "</div>" +
        '<div class="library-head__side">' +
          '<span class="library-head__count"><strong>' + items.length + "</strong> LICENSE" + (items.length === 1 ? "" : "S") + "</span>" +
          '<a class="auth-link" href="dashboard.html">PROFILE</a>' +
          '<button type="button" class="auth-link" data-auth-action="logout">LOG OUT</button>' +
        "</div>" +
      "</header>";
    // An empty list is only trustworthy if the read actually succeeded. When it
    // failed the backend hands back the reason, and the page shows it rather
    // than pretending the account owns nothing.
    const broken = diagnostic && diagnostic.error;
    const body = items.length
      ? '<ul class="library-list">' + items.map((item) => libraryItemHTML(user, item)).join("") + "</ul>"
      : '<div class="library-empty' + (broken ? " library-empty--error" : "") + '">' +
          "<span class=\"library-empty__title\">" + (broken ? "LIBRARY UNREACHABLE" : "NO LICENSES YET") + "</span>" +
          (broken
            ? '<p class="library-empty__error">YOUR LICENSES COULD NOT BE READ FROM SUPABASE' +
                (diagnostic.error.status ? " (HTTP " + escapeHTML(String(diagnostic.error.status)) + ")" : "") +
                " — " + escapeHTML(diagnostic.error.message) + ".</p>" +
              '<p class="library-empty__code">' +
                escapeHTML("GET " + diagnostic.project + "/rest/v1/" + diagnostic.table + "?user_id=eq." + diagnostic.userId) +
              "</p>" +
              "<p>CHECK THAT THE TABLE EXISTS, THAT ITS ROW LEVEL SECURITY POLICY ALLOWS <em>SELECT</em>, " +
                "AND THAT YOU ARE SIGNED IN AS THE ACCOUNT THE ROWS BELONG TO" +
                (diagnostic.userId ? " (USER " + escapeHTML(diagnostic.userId) + ")" : "") + ".</p>"
            : "<p>WHEN YOU SECURE A BEAT IT LANDS HERE PERMANENTLY — WITH ITS DOWNLOAD AND LICENSE.</p>") +
          '<a class="kyrolll-btn" href="index.html#catalog">BROWSE BEATS →</a>' +
        "</div>";
    return '<article class="library-view">' + head + body +
      '<p class="library-note">Audio downloads use secure, time-limited links from your private KYROlll bucket, and the PDF license is generated on your device. Untagged masters and license copies also arrive by email.</p>' +
    "</article>";
  }

  function lockedHTML() {
    return '<article class="library-view library-view--locked"><div class="library-locked">' +
      '<span class="library-locked__kicker">MY LIBRARY</span>' +
      '<h1 class="library-locked__title">LOG IN TO ACCESS YOUR LICENSES</h1>' +
      '<p class="library-locked__text">Every license you secure is tied to your account, so you never lose access to your files.</p>' +
      '<div class="library-locked__actions">' +
        '<a class="kyrolll-btn" href="auth.html?next=library.html&mode=login">LOG IN</a>' +
        '<a class="kyrolll-btn kyrolll-btn--ghost" href="auth.html?next=library.html&mode=signup">CREATE ACCOUNT</a>' +
      "</div></div></article>";
  }

  function initLibraryPage() {
    const root = document.getElementById("library-root");
    if (!root) return;
    const b = backend();
    let items = [];
    let loading = false;   // re-entrancy guard — breaks the fetch→emit→render loop
    let fetchedFor = null; // user id whose licenses are currently in `items`

    // A remote read can hang (a fetch that never settles on a dead connection,
    // or a coalesced promise already stuck upstream). Racing it against a
    // deadline guarantees the spinner can never become permanent: the page
    // always paints, with whatever licenses are known, after LIBRARY_TIMEOUT_MS.
    const LIBRARY_TIMEOUT_MS = 8000;
    function withDeadline(promise, ms, fallback) {
      return Promise.race([
        Promise.resolve(promise).catch(() => fallback),
        new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
      ]);
    }

    async function render() {
      // An auth event fired while a fetch is already in flight must never start
      // a second one: `listLicenses()` -> `alignSessionUser()`/`ready()` emit
      // `kyrolll:auth`, which would otherwise re-enter here forever.
      if (loading) return;
      const user = getCurrentUser();
      if (!user) { items = []; fetchedFor = null; root.innerHTML = lockedHTML(); return; }
      // Already resolved this user's licenses — repaint from memory, never
      // re-fetch. The library check runs strictly once per user per mount.
      if (fetchedFor === user.id) {
        const diagnostic = b && b.licenses.diagnose ? b.licenses.diagnose() : null;
        root.innerHTML = libraryHTML(user, items, diagnostic);
        return;
      }
      loading = true;
      try {
        root.innerHTML = '<div class="flower-loader">' +
          '<img class="flower-loader__flower" src="assets/kyrolll-flower-rest.png" alt="" width="208" height="208">' +
          '<p class="flower-loader__text">LOADING YOUR LIBRARY…</p>' +
          '</div>';
        console.log("KYROlll: fetching licenses (once)...");
        // A missing backend, a rejection and a hang all converge on the same
        // fallback, so the loading flag below is always reached.
        const fetched = (b && b.licenses && b.licenses.list)
          ? await withDeadline(b.licenses.list(), LIBRARY_TIMEOUT_MS, [])
          : [];
        items = Array.isArray(fetched) ? fetched : [];
        console.log("KYROlll: licenses fetched, count:", items.length);
      } catch (err) {
        console.warn("KYROlll: licenses fetch failed, showing empty library", String((err && err.message) || err));
        items = [];
      } finally {
        // Always released — success, failure, hang or a synchronous throw all
        // land here, so the spinner is never left running.
        loading = false;
        fetchedFor = user.id;
      }
      const current = getCurrentUser();
      console.log("KYROlll: render after fetch — current user:", current ? current.id : null, "items:", items.length);
      if (!current) { root.innerHTML = lockedHTML(); return; }
      const diagnostic = b && b.licenses && b.licenses.diagnose ? b.licenses.diagnose() : null;
      root.innerHTML = libraryHTML(current, items, diagnostic);
    }

    root.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-download], [data-pdf]");
      if (!button) return;
      const license = items.find((item) => item.id === button.getAttribute("data-license-id"));
      if (!license) return;
      if (button.hasAttribute("data-download")) {
        const file = helpers() ? helpers().fileFor(license.beatId, license.tierId) : null;
        const original = button.textContent;
        button.disabled = true;
        button.textContent = "PREPARING…";
        try {
          await b.storage.download(file);
          button.textContent = "DOWNLOADED";
        } catch (err) {
          button.textContent = "UNAVAILABLE";
        }
        setTimeout(() => { button.textContent = original; button.disabled = false; }, 2200);
      } else if (window.KYROlll_LICENSE_PDF) {
        window.KYROlll_LICENSE_PDF.download(license, getCurrentUser() || {});
      }
    });

    window.addEventListener("kyrolll:auth", render);
    render();
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

    const warning = document.getElementById("auth-warning");
    const subtitle = document.getElementById("success-subtitle");
    const status = document.getElementById("det-status");
    let recorded = false;

    async function commit() {
      if (recorded || !pending) return;
      if (!getCurrentUser()) return;
      recorded = true;
      await recordPurchase(pending);
      clearPendingPurchase();
      refresh();
    }

    function refresh() {
      const user = getCurrentUser();
      if (user) {
        if (warning) warning.hidden = true;
        if (recorded) {
          if (status) status.textContent = "ACTIVE // SAVED TO YOUR LIBRARY";
          if (subtitle) subtitle.textContent = "Your license is secured and saved to " + user.username + "'s permanent library.";
        } else if (subtitle) {
          subtitle.textContent = "Your license is secured and saved to your permanent library.";
        }
      } else {
        if (warning) warning.hidden = false;
        if (status) status.textContent = "AWAITING ACCOUNT";
        if (subtitle) subtitle.textContent = "Secure your license to your account to keep permanent access.";
      }
    }

    refresh();
    commit();
    window.addEventListener("kyrolll:auth", () => { refresh(); commit(); });

    const libBtn = document.getElementById("view-library-btn");
    if (libBtn) libBtn.addEventListener("click", () => { window.location.href = "library.html"; });
  }

  /* ------------------------------------------------------ secure logout UI */

  // Logging out deliberately takes a sustained press: the red button only fires
  // after LOGOUT_HOLD_MS of continuous holding, and any release, drag-away or
  // key-up cancels it. That is the guard against an accidental tap ending the
  // session, and it works from the header, the profile page and the library.
  const LOGOUT_HOLD_MS = 1400;
  let logoutEls = null;
  let holdTimer = 0;
  let holdActive = false;
  let loggingOut = false;
  let toastTimer = 0;

  function buildLogoutModal() {
    const modal = document.createElement("div");
    modal.className = "logout-modal";
    modal.hidden = true;
    modal.innerHTML =
      '<div class="logout-modal__backdrop" data-logout-dismiss></div>' +
      '<div class="logout-modal__card" role="dialog" aria-modal="true" aria-labelledby="logout-title">' +
        '<span class="logout-modal__kicker">SECURE SIGN-OUT</span>' +
        '<h2 class="logout-modal__title" id="logout-title">LOG OUT OF KYROlll?</h2>' +
        '<p class="logout-modal__copy">Your library stays saved to your account. Press and hold the red button to confirm — the hold stops accidental sign-outs.</p>' +
        '<div class="logout-modal__actions">' +
          '<button type="button" class="kyrolll-btn kyrolll-btn--ghost" data-logout-dismiss>GO BACK</button>' +
          '<button type="button" class="logout-hold" data-logout-hold aria-describedby="logout-hold-hint">' +
            '<span class="logout-hold__fill" aria-hidden="true"></span>' +
            '<span class="logout-hold__label">HOLD TO LOG OUT</span>' +
          '</button>' +
        '</div>' +
        '<p class="logout-modal__hint" id="logout-hold-hint">Keep holding for a moment to sign out.</p>' +
      "</div>";
    document.body.appendChild(modal);

    const hold = modal.querySelector("[data-logout-hold]");
    hold.addEventListener("pointerdown", (event) => {
      if (event.cancelable) event.preventDefault();
      beginHold();
    });
    hold.addEventListener("pointerup", cancelHold);
    hold.addEventListener("pointercancel", cancelHold);
    hold.addEventListener("pointerleave", cancelHold);
    hold.addEventListener("contextmenu", (event) => event.preventDefault());
    hold.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      if (!event.repeat) beginHold();
    });
    hold.addEventListener("keyup", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      cancelHold();
    });
    modal.querySelectorAll("[data-logout-dismiss]").forEach((el) =>
      el.addEventListener("click", closeLogoutModal)
    );
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeLogoutModal();
    });
    return { modal, hold };
  }

  function openLogoutModal() {
    if (!logoutEls) logoutEls = buildLogoutModal();
    loggingOut = false;
    holdActive = false;
    logoutEls.hold.classList.remove("is-holding", "is-complete");
    logoutEls.modal.hidden = false;
    document.documentElement.classList.add("logout-open");
    requestAnimationFrame(() => logoutEls.modal.classList.add("is-visible"));
    const back = logoutEls.modal.querySelector("[data-logout-dismiss]");
    setTimeout(() => { if (back) { try { back.focus(); } catch (err) { /* ignore */ } } }, 40);
  }

  function closeLogoutModal() {
    cancelHold();
    if (!logoutEls) return;
    const modal = logoutEls.modal;
    modal.classList.remove("is-visible");
    document.documentElement.classList.remove("logout-open");
    setTimeout(() => { if (!modal.classList.contains("is-visible")) modal.hidden = true; }, 260);
  }

  function beginHold() {
    if (holdActive || loggingOut || !logoutEls) return;
    holdActive = true;
    const hold = logoutEls.hold;
    hold.classList.add("is-holding");
    hold.style.setProperty("--hold-ms", LOGOUT_HOLD_MS + "ms");
    clearTimeout(holdTimer);
    holdTimer = setTimeout(completeHold, LOGOUT_HOLD_MS);
  }

  function cancelHold() {
    clearTimeout(holdTimer);
    if (!holdActive || !logoutEls) { holdActive = false; return; }
    holdActive = false;
    logoutEls.hold.classList.remove("is-holding");
  }

  async function completeHold() {
    if (loggingOut || !logoutEls) return;
    clearTimeout(holdTimer);
    holdActive = false;
    loggingOut = true;
    logoutEls.hold.classList.add("is-complete");
    const b = backend();
    try { if (b) await b.auth.signOut(); } catch (err) { /* clear locally regardless */ }
    closeLogoutModal();
    showToast("LOGGED OUT — SEE YOU SOON");
  }

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

  document.addEventListener("click", (event) => {
    const support = event.target.closest(".footer__support");
    if (support) {
      event.preventDefault();
      const user = getCurrentUser();
      if (user && user.id) {
        // Logged in — pre-fill support with permanent ID and email.
        const body = encodeURIComponent(
          "KYROlll Support Request\n\nUser ID: " + (user.id || "") + "\nEmail: " + (user.email || "") + "\n\nIssue:"
        );
        const mailto = "mailto:kyrolll00@gmail.com?subject=KYROlll%20Support%20—%20" + encodeURIComponent(user.id || "") + "&body=" + body;
        window.open(mailto, "_blank");
      } else {
        // Not logged in — redirect to auth with a return to support flow.
        window.location.href = "auth.html?next=support&reason=support";
      }
      return;
    }
    const action = event.target.closest("[data-auth-action]");
    if (!action) return;
    const name = action.getAttribute("data-auth-action");
    if (name === "logout") {
      event.preventDefault();
      openLogoutModal();
    } else if (name === "signup") {
      event.preventDefault();
      window.location.href = "auth.html?mode=signup";
    } else if (name === "login") {
      event.preventDefault();
      window.location.href = "auth.html?mode=login";
    }
  });

  window.addEventListener("kyrolll:auth", renderHeaderAuth);

  function boot() {
    renderHeaderAuth();
    const b = backend();
    if (b) b.auth.ready().then(renderHeaderAuth).catch(() => {});
    try {
      if (document.getElementById("auth-page")) initAuthPage();
      if (document.getElementById("dashboard-page")) initDashboardPage();
      if (document.getElementById("library-page")) initLibraryPage();
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
    getCurrentUser,
    recordPurchase,
    // Beats that have been sold on an exclusive license (BUY locks + cover seal).
    soldExclusive: () => {
      const b = backend();
      return b && b.licenses.soldExclusive ? b.licenses.soldExclusive() : Promise.resolve([]);
    },
    buildLicenseText,
    getPendingPurchase,
    setPendingPurchase,
    clearPendingPurchase,
    beginPurchase,
    openLicenseMenu,
    closeLicenseMenu,
    renderHeaderAuth,
    openLogoutModal,
    closeLogoutModal,
    showToast,
    openAuthModal: (options) => {
      const mode = options && options.mode === "signup" ? "signup" : "login";
      window.location.href = "auth.html?mode=" + mode;
    }
  };
})();
