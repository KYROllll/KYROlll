/* KYROlll — client-side accounts, sessions, permanent library and license checkout.
 *
 * This storefront has no runtime backend, so accounts and their libraries are
 * kept in localStorage and survive page reloads. Passwords are stored only as
 * salted SHA-256 digests (never plaintext) and the active session is a stored
 * user object. It is intentionally lightweight: a production store should move
 * accounts to the checkout Worker. Everything below is shared by index.html and
 * success.html so both routes agree on the same keys and shapes. */
(function () {
  "use strict";

  const USERS_KEY = "kyrolll_users";
  const SESSION_KEY = "kyrolll_current_user";
  const PENDING_KEY = "kyrolll_pending_purchase";

  // The three official tiers and their NOWPayments hosted invoices. The id is
  // what we persist; the url is where a logged-in buyer is sent.
  const LICENSES = [
    {
      id: "mp3",
      name: "MP3 LEASE",
      price: "$9.95",
      priceValue: 9.95,
      blurb: "Tagged MP3 + PDF license",
      url: "https://nowpayments.io/payment/?iid=5704655234"
    },
    {
      id: "wav",
      name: "STANDARD WAV LEASE",
      price: "$14.95",
      priceValue: 14.95,
      blurb: "Untagged WAV + MP3 + PDF license",
      url: "https://nowpayments.io/payment/?iid=5611617128"
    },
    {
      id: "exclusive",
      name: "EXCLUSIVE LEASE",
      price: "$299.95",
      priceValue: 299.95,
      blurb: "Full exclusive rights + stems",
      url: "https://nowpayments.io/payment/?iid=4868491664"
    }
  ];

  /* ------------------------------------------------------------------ utils */

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      /* storage full / private mode — account features simply stay in-memory */
    }
  }

  function getUsers() {
    const users = readJSON(USERS_KEY, []);
    return Array.isArray(users) ? users : [];
  }

  function saveUsers(users) {
    writeJSON(USERS_KEY, users);
  }

  function getCurrentUser() {
    const user = readJSON(SESSION_KEY, null);
    return user && user.username ? user : null;
  }

  // Persist a user to the directory and mirror it into the active session so the
  // two never disagree (success.html and the library read the session copy).
  function persistUser(user) {
    const users = getUsers();
    let index = user.id ? users.findIndex((u) => u.id === user.id) : -1;
    if (index === -1) {
      index = users.findIndex((u) => String(u.username).toLowerCase() === String(user.username).toLowerCase());
    }
    if (index === -1) users.push(user);
    else users[index] = user;
    saveUsers(users);
    writeJSON(SESSION_KEY, user);
  }

  async function hashPassword(password) {
    const bytes = new TextEncoder().encode("kyrolll::" + String(password));
    if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
      try {
        const digest = await window.crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      } catch (err) {
        /* fall through to the non-secure-context fallback below */
      }
    }
    // crypto.subtle needs a secure context; hash quickly if it is unavailable.
    let hash = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i += 1) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 0x01000193);
    }
    return "fnv" + (hash >>> 0).toString(16);
  }

  function newId(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* --------------------------------------------------------------- accounts */

  function validateSignup(username, email, password, confirm) {
    const name = String(username || "").trim();
    const mail = String(email || "").trim().toLowerCase();
    if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(name)) {
      return "USERNAME MUST BE 3–24 CHARACTERS (LETTERS, NUMBERS, _ . -)";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      return "ENTER A VALID EMAIL ADDRESS";
    }
    if (String(password || "").length < 6) {
      return "PASSWORD MUST BE AT LEAST 6 CHARACTERS";
    }
    if (confirm !== undefined && password !== confirm) {
      return "PASSWORDS DO NOT MATCH";
    }
    const users = getUsers();
    if (users.some((u) => String(u.username).toLowerCase() === name.toLowerCase())) {
      return "THAT USERNAME IS ALREADY TAKEN";
    }
    if (users.some((u) => String(u.email || "").toLowerCase() === mail)) {
      return "AN ACCOUNT WITH THAT EMAIL ALREADY EXISTS";
    }
    return null;
  }

  async function signUp(fields) {
    const { username, email, password, confirm } = fields;
    const error = validateSignup(username, email, password, confirm);
    if (error) throw new Error(error);
    const user = {
      id: newId("u"),
      username: String(username).trim(),
      email: String(email).trim().toLowerCase(),
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
      library: []
    };
    persistUser(user);
    emitAuthChange();
    return user;
  }

  async function logIn(fields) {
    const identifier = String(fields.identifier || fields.username || "").trim().toLowerCase();
    if (!identifier) throw new Error("ENTER YOUR USERNAME OR EMAIL");
    const user = getUsers().find((u) =>
      String(u.username).toLowerCase() === identifier ||
      String(u.email || "").toLowerCase() === identifier
    );
    if (!user) throw new Error("NO ACCOUNT FOUND FOR THAT USERNAME OR EMAIL");
    const hash = await hashPassword(fields.password);
    if (hash !== user.passwordHash) throw new Error("INCORRECT PASSWORD");
    if (!Array.isArray(user.library)) user.library = [];
    persistUser(user);
    emitAuthChange();
    return user;
  }

  function logOut() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (err) { /* ignore */ }
    emitAuthChange();
  }

  function emitAuthChange() {
    window.dispatchEvent(new CustomEvent("kyrolll:auth", { detail: { user: getCurrentUser() } }));
  }

  /* ---------------------------------------------------------------- library */

  function buildLicenseText(user, item) {
    const holder = user && user.username ? user.username : "—";
    const email = user && user.email ? user.email : "—";
    return [
      "KYROlll — OFFICIAL LICENSE CERTIFICATE",
      "======================================",
      "LICENSE ID : " + item.id,
      "BEAT       : " + item.beatTitle,
      "TIER       : " + item.tier,
      "PRICE      : " + item.price,
      "LICENSEE   : " + holder,
      "EMAIL      : " + email,
      "DATE       : " + item.date,
      "",
      "This certifies that the licensee named above has secured the " + item.tier + " for",
      "\"" + item.beatTitle + "\" from KYROlll.",
      "",
      "The untagged master and a PDF copy of this license are delivered to the",
      "email address on file. This license is non-transferable. All rights not",
      "expressly granted to the licensee remain the property of KYROlll.",
      "",
      "© " + new Date().getFullYear() + " KYROlll. All rights reserved."
    ].join("\n");
  }

  // Add a purchase to the signed-in user's permanent library. Returns the stored
  // item (or the existing one when the same beat + tier was already secured).
  function recordPurchase(purchase) {
    const user = getCurrentUser();
    if (!user) return null;
    if (!Array.isArray(user.library)) user.library = [];
    const item = {
      id: newId("lic"),
      beatId: purchase.beatId || "flesh",
      beatTitle: purchase.beatTitle || "UNTITLED BEAT",
      tierId: purchase.tierId || "",
      tier: purchase.tier || "MP3 LEASE",
      price: purchase.price || "",
      purchasedAt: Date.now(),
      date: new Date().toLocaleDateString(),
      audioUrl: purchase.audioUrl || "",
      audioName: purchase.audioName || "",
      licenseText: purchase.licenseText || ""
    };
    item.licenseText = buildLicenseText(user, item);
    const duplicate = user.library.find((entry) => entry.beatId === item.beatId && entry.tier === item.tier);
    if (duplicate) return duplicate;
    user.library.unshift(item);
    persistUser(user);
    return item;
  }

  function getPendingPurchase() {
    return readJSON(PENDING_KEY, null);
  }

  function setPendingPurchase(purchase) {
    writeJSON(PENDING_KEY, purchase);
  }

  function clearPendingPurchase() {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch (err) { /* ignore */ }
  }

  function licenseFor(id) {
    return LICENSES.find((license) => license.id === id) || null;
  }

  function audioFileName(beat, license) {
    const base = (beat && (beat.downloadName || beat.title)) || "KYROlll beat";
    const ext = license.id === "mp3" ? "mp3" : "wav";
    return base + "." + ext;
  }

  /* ---------------------------------------------------------- license menu */

  let activeMenu = null;
  let checkoutSuccessHandler = null;

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
      LICENSES.map((license) =>
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

  function positionLicenseMenu() {
    if (!activeMenu) return;
    const { el, anchor } = activeMenu;
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(rect.width, 300);
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    el.style.width = width + "px";
    el.style.left = left + "px";
    const height = el.offsetHeight;
    let top = rect.bottom + 10;
    if (top + height > window.innerHeight - 12 && rect.top - height - 10 > 12) {
      top = rect.top - height - 10;
    }
    el.style.top = Math.max(12, top) + "px";
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

  // A tier was chosen: remember it, and only redirect once the buyer is signed
  // in so the purchase can be tied to their permanent library.
  function beginPurchase(beat, license) {
    const audioUrl = (beat.downloads && beat.downloads[license.id]) || beat.preview || "";
    const pending = {
      beatId: beat.id,
      beatTitle: beat.title,
      tierId: license.id,
      tier: license.name,
      price: license.price,
      audioUrl: audioUrl,
      audioName: audioFileName(beat, license),
      at: Date.now()
    };
    setPendingPurchase(pending);
    if (!getCurrentUser()) {
      openAuthModal({
        mode: "signup",
        message: "CREATE AN ACCOUNT OR LOG IN SO THIS " + license.name.toUpperCase() + " IS SAVED TO YOUR PERMANENT LIBRARY.",
        onSuccess: () => redirectToCheckout(license)
      });
    } else {
      redirectToCheckout(license);
    }
  }

  function redirectToCheckout(license) {
    window.location.assign(license.url);
  }

  /* ------------------------------------------------------------ auth modal */

  let authModal = null;

  function ensureAuthModal() {
    if (authModal && document.body.contains(authModal)) return authModal;
    authModal = document.createElement("div");
    authModal.id = "auth-modal";
    authModal.className = "auth-modal";
    authModal.hidden = true;
    authModal.dataset.mode = "login";
    authModal.innerHTML =
      '<div class="auth-modal__backdrop" data-auth-close></div>' +
      '<div class="auth-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">' +
        '<button type="button" class="auth-card__close" data-auth-close aria-label="Close">×</button>' +
        '<span class="auth-card__kicker">KYROlll ACCOUNT</span>' +
        '<h2 class="auth-card__title" id="auth-title">LOG IN</h2>' +
        '<p class="auth-card__sub" id="auth-sub">LOG IN TO PURCHASE AND KEEP YOUR LICENSES FOREVER.</p>' +
        '<div class="auth-tabs" role="tablist">' +
          '<button type="button" class="auth-tab is-active" data-auth-tab="login" role="tab">LOG IN</button>' +
          '<button type="button" class="auth-tab" data-auth-tab="signup" role="tab">SIGN UP</button>' +
        "</div>" +
        '<form class="auth-form" id="auth-form" novalidate>' +
          '<label class="auth-field" data-auth-field="username">' +
            '<span class="auth-field__label" id="auth-username-label">USERNAME OR EMAIL</span>' +
            '<input class="auth-input" name="username" type="text" autocomplete="username" spellcheck="false">' +
          "</label>" +
          '<label class="auth-field" data-auth-field="email">' +
            '<span class="auth-field__label">EMAIL</span>' +
            '<input class="auth-input" name="email" type="email" autocomplete="email" spellcheck="false">' +
          "</label>" +
          '<label class="auth-field" data-auth-field="password">' +
            '<span class="auth-field__label">PASSWORD</span>' +
            '<input class="auth-input" name="password" type="password" autocomplete="current-password">' +
          "</label>" +
          '<label class="auth-field" data-auth-field="confirm">' +
            '<span class="auth-field__label">CONFIRM PASSWORD</span>' +
            '<input class="auth-input" name="confirm" type="password" autocomplete="new-password">' +
          "</label>" +
          '<p class="auth-error" id="auth-error" role="alert" hidden></p>' +
          '<button type="submit" class="auth-submit" id="auth-submit">LOG IN</button>' +
          '<p class="auth-note">Your library is stored on this device and stays available every time you return.</p>' +
        "</form>" +
      "</div>";
    document.body.appendChild(authModal);

    authModal.addEventListener("click", (event) => {
      if (event.target.closest("[data-auth-close]")) {
        closeAuthModal();
        return;
      }
      const tab = event.target.closest("[data-auth-tab]");
      if (tab) setAuthMode(tab.getAttribute("data-auth-tab"));
    });
    authModal.querySelector("#auth-form").addEventListener("submit", handleAuthSubmit);
    return authModal;
  }

  function setAuthMode(mode) {
    if (!authModal) return;
    const signup = mode === "signup";
    authModal.dataset.mode = signup ? "signup" : "login";
    authModal.querySelector("#auth-title").textContent = signup ? "CREATE ACCOUNT" : "LOG IN";
    authModal.querySelector("#auth-sub").textContent = signup
      ? "ONE ACCOUNT. EVERY LICENSE. ALWAYS AVAILABLE."
      : "LOG IN TO PURCHASE AND KEEP YOUR LICENSES FOREVER.";
    authModal.querySelector("#auth-username-label").textContent = signup ? "USERNAME" : "USERNAME OR EMAIL";
    authModal.querySelector("#auth-submit").textContent = signup ? "CREATE ACCOUNT" : "LOG IN";
    authModal.querySelectorAll("[data-auth-tab]").forEach((tab) => {
      tab.classList.toggle("is-active", tab.getAttribute("data-auth-tab") === (signup ? "signup" : "login"));
    });
    const passwordInput = authModal.querySelector('input[name="password"]');
    if (passwordInput) {
      passwordInput.setAttribute("autocomplete", signup ? "new-password" : "current-password");
    }
    setAuthError("");
  }

  function setAuthError(message) {
    if (!authModal) return;
    const error = authModal.querySelector("#auth-error");
    error.textContent = message || "";
    error.hidden = !message;
  }

  function handleAuthSubmit(event) {
    event.preventDefault();
    if (!authModal) return;
    const form = event.currentTarget;
    const mode = authModal.dataset.mode === "signup" ? "signup" : "login";
    const submit = authModal.querySelector("#auth-submit");
    const data = {
      username: form.querySelector('input[name="username"]').value,
      email: form.querySelector('input[name="email"]').value,
      password: form.querySelector('input[name="password"]').value,
      confirm: form.querySelector('input[name="confirm"]').value
    };
    setAuthError("");
    submit.disabled = true;
    const action = mode === "signup"
      ? signUp(data)
      : logIn({ identifier: data.username, password: data.password });
    action.then(() => {
      const done = checkoutSuccessHandler;
      checkoutSuccessHandler = null;
      closeAuthModal();
      if (typeof done === "function") done(getCurrentUser());
    }).catch((err) => {
      setAuthError(err && err.message ? err.message : "SOMETHING WENT WRONG. TRY AGAIN.");
    }).finally(() => {
      submit.disabled = false;
    });
  }

  function openAuthModal(options) {
    const opts = options || {};
    const modal = ensureAuthModal();
    checkoutSuccessHandler = typeof opts.onSuccess === "function" ? opts.onSuccess : null;
    setAuthMode(opts.mode === "signup" ? "signup" : "login");
    if (opts.message) {
      const sub = modal.querySelector("#auth-sub");
      if (sub) sub.textContent = opts.message;
    }
    modal.hidden = false;
    document.documentElement.classList.add("auth-open");
    const first = modal.querySelector('input[name="username"]');
    if (first) setTimeout(() => first.focus(), 60);
  }

  function closeAuthModal() {
    if (!authModal || authModal.hidden) return;
    authModal.hidden = true;
    checkoutSuccessHandler = null;
    document.documentElement.classList.remove("auth-open");
    setAuthError("");
    const form = authModal.querySelector("#auth-form");
    if (form) form.reset();
  }

  /* --------------------------------------------------------- header render */

  function renderHeaderAuth() {
    const host = document.getElementById("header-auth");
    if (!host) return;
    const user = getCurrentUser();
    if (user) {
      host.innerHTML =
        '<span class="header-auth__user" title="' + escapeHTML(user.email || "") + '">' + escapeHTML(user.username) + "</span>" +
        '<a class="auth-link" href="index.html?view=library">MY LIBRARY</a>' +
        '<button type="button" class="auth-link" data-auth-action="logout">LOG OUT</button>';
    } else {
      host.innerHTML =
        '<button type="button" class="auth-link" data-auth-action="login">LOG IN</button>' +
        '<button type="button" class="auth-link auth-link--solid" data-auth-action="signup">SIGN UP</button>';
    }
  }

  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-auth-action]");
    if (!action) return;
    const name = action.getAttribute("data-auth-action");
    if (name === "logout") {
      logOut();
    } else {
      openAuthModal({ mode: name === "signup" ? "signup" : "login" });
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAuthModal();
  });

  window.addEventListener("kyrolll:auth", renderHeaderAuth);

  window.KYROLLL_ACCOUNT = {
    LICENSES: LICENSES,
    escapeHTML: escapeHTML,
    getUsers: getUsers,
    getCurrentUser: getCurrentUser,
    signUp: signUp,
    logIn: logIn,
    logOut: logOut,
    recordPurchase: recordPurchase,
    buildLicenseText: buildLicenseText,
    getPendingPurchase: getPendingPurchase,
    setPendingPurchase: setPendingPurchase,
    clearPendingPurchase: clearPendingPurchase,
    beginPurchase: beginPurchase,
    openAuthModal: openAuthModal,
    closeAuthModal: closeAuthModal,
    renderHeaderAuth: renderHeaderAuth,
    openLicenseMenu: openLicenseMenu,
    closeLicenseMenu: closeLicenseMenu,
    licenseFor: licenseFor
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderHeaderAuth);
  } else {
    renderHeaderAuth();
  }
})();
