/* KYROlll — account, license and library front-end.
 *
 * The UI layer that sits on top of `kyrolll-backend.js`: it renders the header
 * account controls, the downward-only license dropdown, the dedicated auth /
 * dashboard / library pages and the post-checkout success screen. All data
 * access (Supabase Auth + Storage + Postgres, or the local demo fallback) goes
 * through `window.KYROLLL_BACKEND`, so nothing here holds a secret. */
(function () {
  "use strict";

  const PENDING_KEY = "kyrolll_pending_purchase";

  const backend = () => window.KYROLLL_BACKEND || null;
  const helpers = () => window.KYROLLL_HELPERS || null;
  const escapeHTML = (value) =>
    helpers()
      ? helpers().escapeHTML(value)
      : String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
          "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[char]));
  const licenseFor = (id) => (window.KYROLLL_LICENSES || []).find((license) => license.id === id) || null;
  const beatById = (id) => (window.KYROLLL_CATALOG || []).find((beat) => beat.id === id) || null;
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
    const rights = (tier.rights || []).map((line) => "  - " + line).join("\n");
    return [
      "KYROlll — OFFICIAL LICENSE CERTIFICATE",
      "======================================",
      "LICENSE ID : " + (item.id || ""),
      "BEAT       : " + (item.beatTitle || ""),
      "TIER       : " + (item.tier || ""),
      "PRICE      : " + (item.price || ""),
      "LICENSEE   : " + holder,
      "EMAIL      : " + email,
      "DATE       : " + (item.date || new Date().toLocaleDateString()),
      "",
      "GRANT OF RIGHTS",
      rights || "  - License granted as described at checkout.",
      "",
      "This certifies that the licensee named above has secured the " + (item.tier || "license") + " for",
      "\"" + (item.beatTitle || "") + "\" from KYROlll.",
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

  function openLicenseMenu(anchor, beat) {
    closeLicenseMenu();
    if (!anchor || !beat) return;
    const menu = document.createElement("div");
    menu.className = "license-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Choose a license");
    menu.innerHTML =
      '<div class="license-menu__head">' +
        '<span class="license-menu__kicker">SELECT LICENSE</span>' +
        '<span class="license-menu__beat">' + escapeHTML(beat.title) + "</span>" +
      "</div>" +
      (window.KYROLLL_LICENSES || []).map((license) =>
        '<button type="button" class="license-tier" role="menuitem" data-license-id="' + license.id + '">' +
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
    positionLicenseMenu();

    menu.addEventListener("click", (event) => {
      const tier = event.target.closest("[data-license-id]");
      if (!tier) return;
      const license = licenseFor(tier.getAttribute("data-license-id"));
      closeLicenseMenu();
      if (license) beginPurchase(beat, license);
    });

    window.addEventListener("scroll", closeLicenseMenu, true);
    window.addEventListener("resize", closeLicenseMenu, true);
    document.addEventListener("keydown", handleMenuKey);
    setTimeout(() => document.addEventListener("click", handleMenuOutside, true), 0);
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
    window.removeEventListener("scroll", closeLicenseMenu, true);
    window.removeEventListener("resize", closeLicenseMenu, true);
    document.removeEventListener("keydown", handleMenuKey);
    document.removeEventListener("click", handleMenuOutside, true);
  }

  // A tier was chosen: remember it, then either send the buyer to NOWPayments
  // or (when signed out) to the auth page, which resumes checkout afterwards.
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
      window.location.assign(license.url);
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

  function finishAuth(params) {
    const next = params.get("next");
    if (next === "checkout" || params.get("reason") === "purchase") {
      const pending = getPendingPurchase();
      const license = pending && licenseFor(pending.tierId);
      if (license) { window.location.assign(license.url); return; }
    }
    if (next && next !== "checkout" && /^[\w./#?=-]+$/.test(next)) {
      window.location.assign(next);
      return;
    }
    window.location.assign("library.html");
  }

  function initAuthPage() {
    const params = new URLSearchParams(location.search);
    const loginForm = document.getElementById("login-form");
    const signupForm = document.getElementById("signup-form");
    const confirmForm = document.getElementById("confirm-form");
    const tabsEl = document.querySelector(".auth-tabs");
    const demo = document.getElementById("auth-demo");
    const demoCodeEl = document.getElementById("confirm-demo");
    const b = backend();
    const otpLength = (b && b.otpLength) || 6;
    let pending = null;      // { email, username, createUser } for the last code sent
    let origin = "login";    // which tab to return to from the code step

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
    }

    /* --- one-time-code boxes --------------------------------------------- */
    const boxesHost = document.getElementById("otp-boxes");
    if (boxesHost) {
      // Keep the hand-written boxes when the count already matches the
      // configured code length; otherwise grow or shrink so the UI can never
      // ask for a different number of digits than Supabase sends.
      while (boxesHost.children.length > otpLength) boxesHost.removeChild(boxesHost.lastElementChild);
      while (boxesHost.children.length < otpLength) boxesHost.appendChild(boxesHost.firstElementChild.cloneNode(true));
      Array.from(boxesHost.children).forEach((box, index) => {
        box.value = "";
        box.setAttribute("aria-label", "Code digit " + (index + 1));
      });
      boxesHost.setAttribute("aria-label", otpLength + "-digit one-time code");
    }
    const boxes = Array.from(document.querySelectorAll("#otp-boxes .otp-box"));
    function codeValue() { return boxes.map((box) => box.value).join(""); }
    function clearCode() { boxes.forEach((box) => { box.value = ""; }); }
    function focusCode() { if (boxes[0]) setTimeout(() => { try { boxes[0].focus(); } catch (err) { /* ignore */ } }, 60); }

    boxes.forEach((box, index) => {
      box.addEventListener("input", () => {
        box.value = box.value.replace(/\D/g, "").slice(0, 1);
        if (box.value && index < boxes.length - 1) boxes[index + 1].focus();
      });
      box.addEventListener("keydown", (event) => {
        if (event.key === "Backspace" && !box.value && index > 0) {
          event.preventDefault();
          boxes[index - 1].value = "";
          boxes[index - 1].focus();
        } else if (event.key === "ArrowLeft" && index > 0) {
          event.preventDefault();
          boxes[index - 1].focus();
        } else if (event.key === "ArrowRight" && index < boxes.length - 1) {
          event.preventDefault();
          boxes[index + 1].focus();
        }
      });
      box.addEventListener("paste", (event) => {
        const text = String((event.clipboardData || window.clipboardData).getData("text") || "").replace(/\D/g, "").slice(0, boxes.length);
        if (!text) return;
        event.preventDefault();
        text.split("").forEach((digit, k) => { if (boxes[k]) boxes[k].value = digit; });
        boxes[Math.min(text.length, boxes.length - 1)].focus();
      });
    });

    function setDemoCode(code) {
      if (!demoCodeEl) return;
      demoCodeEl.hidden = !code;
      demoCodeEl.textContent = code ? "LOCAL DEMO CODE: " + code : "";
    }

    function showConfirm() {
      const shown = document.getElementById("confirm-email");
      if (shown) shown.textContent = (pending && pending.email) || "";
      show("confirm");
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
        setError(errorId, (((err && err.message) || "COULD NOT SEND THE CODE")).toUpperCase());
      } finally {
        button.disabled = false;
      }
    }

    if (tabsEl) tabsEl.addEventListener("click", (event) => {
      const tab = event.target.closest("[data-auth-tab]");
      if (tab) show(tab.getAttribute("data-auth-tab"));
    });

    if (loginForm) loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const email = loginForm.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("login-error", "ENTER A VALID EMAIL ADDRESS");
      origin = "login";
      sendCode({ email, createUser: true }, "login-error", loginForm.querySelector(".auth-submit"));
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
      const token = codeValue();
      setError("confirm-error", "");
      if (!new RegExp("^\\d{" + otpLength + "}$").test(token)) return setError("confirm-error", "ENTER THE " + otpLength + "-DIGIT CODE FROM YOUR EMAIL");
      const button = confirmForm.querySelector(".auth-submit");
      button.disabled = true;
      try {
        await b.auth.verifyOtp({ email: pending && pending.email, token, type: "email" });
        finishAuth(params);
      } catch (err) {
        setError("confirm-error", (((err && err.message) || "INVALID OR EXPIRED CODE")).toUpperCase());
        clearCode();
        focusCode();
      } finally {
        button.disabled = false;
      }
    });

    const resend = document.getElementById("confirm-resend");
    if (resend) resend.addEventListener("click", async () => {
      if (!pending) return;
      setError("confirm-error", "");
      try {
        const result = await b.auth.signInWithOtp(pending);
        setDemoCode(result && result.demoCode);
        clearCode();
        focusCode();
        setError("confirm-error", "A NEW CODE IS ON ITS WAY.");
      } catch (err) {
        setError("confirm-error", (((err && err.message) || "COULD NOT RESEND")).toUpperCase());
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

    nameInput.value = user.username || "";
    emailInput.value = user.email || "";
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
    return '<li class="library-item">' +
      '<div class="library-item__art"><img src="' + escapeHTML(art) + '" alt="" loading="lazy" decoding="async"></div>' +
      '<div class="library-item__body">' +
        '<div class="library-item__row">' +
          '<h2 class="library-item__title">' + escapeHTML(item.beatTitle) + "</h2>" +
          '<span class="library-item__tier">' + escapeHTML(item.tier) + "</span>" +
        "</div>" +
        '<p class="library-item__meta">' + escapeHTML(item.price) + " · SECURED " + escapeHTML(item.date) + " · " + escapeHTML(item.id) + "</p>" +
        '<p class="library-item__help">Download your leased master straight to this device, or open the official KYROlll PDF license for this purchase.</p>' +
        '<div class="library-item__actions">' +
          '<button type="button" class="kyrolll-btn" data-download data-license-id="' + escapeHTML(item.id) + '">DOWNLOAD AUDIO</button>' +
          '<button type="button" class="kyrolll-btn" data-pdf data-license-id="' + escapeHTML(item.id) + '">LICENSE (PDF)</button>' +
        "</div>" +
      "</div>" +
    "</li>";
  }

  function libraryHTML(user, items) {
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
    const body = items.length
      ? '<ul class="library-list">' + items.map((item) => libraryItemHTML(user, item)).join("") + "</ul>"
      : '<div class="library-empty">' +
          '<span class="library-empty__title">NO LICENSES YET</span>' +
          "<p>WHEN YOU SECURE A BEAT IT LANDS HERE PERMANENTLY — WITH ITS DOWNLOAD AND LICENSE.</p>" +
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

    async function render() {
      const user = getCurrentUser();
      if (!user) { root.innerHTML = lockedHTML(); return; }
      root.innerHTML = '<p class="library-loading">LOADING YOUR LICENSES…</p>';
      try {
        items = await b.licenses.list();
      } catch (err) {
        items = [];
      }
      const current = getCurrentUser();
      if (!current) { root.innerHTML = lockedHTML(); return; }
      root.innerHTML = libraryHTML(current, items);
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
      } else if (window.KYROLLL_LICENSE_PDF) {
        window.KYROLLL_LICENSE_PDF.download(license, getCurrentUser() || {});
      }
    });

    window.addEventListener("kyrolll:auth", render);
    render();
  }

  /* ----------------------------------------------------------- success page */

  function initSuccessPage() {
    const pending = getPendingPurchase();
    const purchase = pending || {
      beatId: "flesh",
      beatTitle: "[FREE] DON TOLIVER TYPE BEAT - FLESH",
      tierId: "mp3",
      tier: "MP3 LEASE",
      price: "$9.95"
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

  /* ------------------------------------------------------------------- boot */

  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-auth-action]");
    if (!action) return;
    const name = action.getAttribute("data-auth-action");
    const b = backend();
    if (name === "logout") {
      event.preventDefault();
      if (b) b.auth.signOut();
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

  window.KYROLLL_ACCOUNT = {
    LICENSES: window.KYROLLL_LICENSES || [],
    escapeHTML,
    beatById,
    licenseFor,
    getCurrentUser,
    recordPurchase,
    buildLicenseText,
    getPendingPurchase,
    setPendingPurchase,
    clearPendingPurchase,
    beginPurchase,
    openLicenseMenu,
    closeLicenseMenu,
    renderHeaderAuth,
    openAuthModal: (options) => {
      const mode = options && options.mode === "signup" ? "signup" : "login";
      window.location.href = "auth.html?mode=" + mode;
    }
  };
})();
