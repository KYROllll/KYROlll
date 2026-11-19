/* Dependency-free Supabase Auth bridge for the KYROIII storefront.
   Talks to the Auth REST API directly (no supabase-js, no build step) using
   only the public URL + publishable key from supabase-config.js. Exposes
   window.KYROlll_AUTH: requestOtp, verifyOtp, getSession, isVerified, etc.
   A verified session is remembered on this device (localStorage) so a
   returning visitor does not re-verify for every beat; a different address
   always re-verifies. */
(function () {
  "use strict";

  var SESSION_KEY = "kyrolll_sb_session";

  function cfg() { return window.KYROlll_SUPABASE || {}; }

  function isConfigured() {
    var c = cfg();
    var url = String(c.url || "").trim();
    var key = String(c.anonKey || "").trim();
    if (!url || !key) return false;
    if (/YOUR_PROJECT_REF/i.test(url)) return false;
    if (!/^https?:\/\//i.test(url)) return false;
    return true;
  }

  function baseUrl() { return String(cfg().url || "").replace(/\/+$/, ""); }

  function parseError(res, body) {
    var obj = body;
    if (typeof body === "string") {
      try { obj = JSON.parse(body); } catch (e) { obj = null; }
    }
    var msg = "";
    if (obj && typeof obj === "object") {
      msg = obj.msg || obj.message || obj.error_description || obj.error || obj.hint || "";
    }
    if (msg) return String(msg);
    if (res && res.status) return "HTTP " + res.status;
    return "REQUEST FAILED";
  }

  async function request(path, opts) {
    opts = opts || {};
    var headers = { "Content-Type": "application/json", "apikey": String(cfg().anonKey || "") };
    if (opts.token) headers["Authorization"] = "Bearer " + opts.token;
    var res;
    try {
      res = await fetch(baseUrl() + path, {
        method: opts.method || "POST",
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined
      });
    } catch (e) {
      throw new Error((e && e.message) || "network error");
    }
    var text = "";
    try { text = await res.text(); } catch (e) { text = ""; }
    var body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
    if (!res.ok) {
      var err = new Error(parseError(res, body));
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  function normalizeSession(raw) {
    if (!raw) return null;
    var s = (raw && raw.session) ? raw.session : raw;
    if (!s || !s.access_token) return null;
    var user = s.user || (raw && raw.user) || null;
    var expiresAt = s.expires_at;
    if (!expiresAt && s.expires_in) {
      expiresAt = Math.floor(Date.now() / 1000) + Number(s.expires_in);
    }
    return {
      access_token: s.access_token,
      refresh_token: s.refresh_token || null,
      token_type: s.token_type || "bearer",
      expires_at: expiresAt || null,
      user: user,
      email: (user && user.email) ? user.email : (s.email || null),
      email_confirmed_at: (user && (user.email_confirmed_at || user.confirmed_at)) || null
    };
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.access_token) return null;
      return s;
    } catch (e) { return null; }
  }

  function saveSession(s) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function isExpired(s) {
    if (!s || !s.expires_at) return false;
    return (Number(s.expires_at) * 1000) < (Date.now() - 30000);
  }

  async function refreshSession() {
    var s = loadSession();
    if (!s || !s.refresh_token) return null;
    try {
      var body = await request("/auth/v1/token?grant_type=refresh_token", {
        body: { refresh_token: s.refresh_token }
      });
      var ns = normalizeSession(body);
      if (ns) saveSession(ns);
      else clearSession();
      return ns;
    } catch (e) {
      clearSession();
      return null;
    }
  }

  async function getSession() {
    var s = loadSession();
    if (!s) return null;
    if (isExpired(s)) s = await refreshSession();
    return s;
  }

  async function requestOtp(email) {
    if (!isConfigured()) return { ok: false, error: "SUPABASE NOT CONFIGURED" };
    try {
      await request("/auth/v1/otp", { body: { email: email, create_user: true } });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e && e.message) || "REQUEST FAILED" };
    }
  }

  async function verifyOtp(email, token) {
    if (!isConfigured()) return { ok: false, error: "SUPABASE NOT CONFIGURED" };
    try {
      var body = await request("/auth/v1/verify", {
        body: { type: "email", email: email, token: token }
      });
      var s = normalizeSession(body);
      if (!s) return { ok: false, error: "INVALID RESPONSE" };
      if (!s.email_confirmed_at) {
        // Some responses nest confirmation under user; try a session fetch.
        try {
          var sess = await getSession();
          if (sess && sess.email_confirmed_at) s.email_confirmed_at = sess.email_confirmed_at;
        } catch (e) {}
      }
      saveSession(s);
      return { ok: true, session: s };
    } catch (e) {
      return { ok: false, error: (e && e.message) || "VERIFICATION FAILED" };
    }
  }

  function isVerified(email) {
    var s = loadSession();
    if (!s) return false;
    if (isExpired(s)) return false;
    var e = String(s.email || (s.user && s.user.email) || "").toLowerCase();
    if (email && e && e !== String(email).toLowerCase()) return false;
    return !!s.email_confirmed_at;
  }

  window.KYROlll_AUTH = {
    isConfigured: isConfigured,
    requestOtp: requestOtp,
    verifyOtp: verifyOtp,
    getSession: getSession,
    refreshSession: refreshSession,
    isVerified: isVerified,
    clearSession: clearSession
  };
})();
