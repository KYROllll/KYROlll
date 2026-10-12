/* KYROlll — backend bridge.
 *
 * One small, dependency-free client that talks to Supabase over its REST API
 * (Auth, Storage and Postgres) and exposes a stable promise API used by every
 * page:
 *
 *   KYROLLL_BACKEND.auth.signInWithOtp / verifyOtp / signOut / ready /
 *                          currentUser / updateProfile
 *   KYROLLL_BACKEND.licenses.list / add
 *   KYROLLL_BACKEND.storage.download / signedUrl / uploadAvatar
 *
 * When `supabase-config.js` has no project URL/key the client transparently
 * falls back to a browser-local implementation (accounts and libraries in
 * localStorage) so the storefront stays fully usable in preview.
 *
 * Auth is passwordless: `signInWithOtp` asks Supabase to email an 8-digit code
 * (creating the account on first use) and `verifyOtp` exchanges that code for a
 * session — the same two calls cover both signing up and logging in. */
(function () {
  "use strict";

  const CONFIG = window.KYROLLL_SUPABASE || {};
  const SESSION_KEY = "kyrolll_sb_session";
  const USERS_KEY = "kyrolll_users";
  const LOCAL_SESSION_KEY = "kyrolll_current_user";
  const LIBRARY_PREFIX = "kyrolll_library_";
  const OTP_KEY = "kyrolll_local_otp";
  // Number of digits in the emailed code. Mirrors the project's "Email OTP
  // Length" (brand-new projects default to 8); also drives how many digits the
  // auth page's code input accepts.
  const OTP_LENGTH = Math.min(Math.max(parseInt(CONFIG.otpLength, 10) || 8, 4), 10);

  const CONFIGURED = !!(
    CONFIG.url &&
    CONFIG.anonKey &&
    !/YOUR-|PROJECT\.supabase|eyJhbGciOi\.\.\./.test(String(CONFIG.url) + String(CONFIG.anonKey))
  );
  const BUCKETS = CONFIG.buckets || { beats: "BEATS", avatars: "avatars" };
  const LICENSES_TABLE = (CONFIG.tables && CONFIG.tables.licenses) || "licenses";
  const base = CONFIGURED ? String(CONFIG.url).replace(/\/+$/, "") : "";

  /* ------------------------------------------------------------------ utils */

  function readJSON(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function lsGet(key) { try { return localStorage.getItem(key); } catch (err) { return null; } }
  function lsSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* ignore */ } }
  function lsDel(key) { try { localStorage.removeItem(key); } catch (err) { /* ignore */ } }

  function newId(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function emitAuthChange() {
    window.dispatchEvent(new CustomEvent("kyrolll:auth", { detail: { user: currentUser() } }));
  }

  /* ------------------------------------------------------------ user shape */

  function normalizeUser(raw) {
    if (!raw) return null;
    const meta = raw.user_metadata || raw.metadata || {};
    return {
      id: raw.id || meta.sub || "",
      email: raw.email || "",
      username: meta.username || raw.username || (raw.email ? String(raw.email).split("@")[0] : "member"),
      avatarUrl: meta.avatar_url || meta.avatarUrl || "",
      confirmed: !!(raw.email_confirmed_at || raw.confirmed_at || raw.emailVerified || raw.confirmed),
      createdAt: raw.created_at || raw.createdAt || ""
    };
  }

  let session = null;      // { accessToken, refreshToken, expiresAt, user }
  let localUser = null;    // demo-mode user

  function loadSession() {
    if (CONFIGURED) {
      session = readJSON(lsGet(SESSION_KEY), null);
      if (session && !(session.user && session.user.id)) session = null;
    } else {
      const stored = readJSON(lsGet(LOCAL_SESSION_KEY), null);
      localUser = stored && stored.username ? stored : null;
    }
  }

  function saveSession(next) {
    session = next || null;
    if (session) lsSet(SESSION_KEY, session); else lsDel(SESSION_KEY);
  }

  function currentUser() {
    if (CONFIGURED) return session && session.user ? session.user : null;
    if (!localUser) return null;
    return normalizeUser({
      id: localUser.id,
      email: localUser.email,
      user_metadata: { username: localUser.username, avatar_url: localUser.avatarUrl || "" },
      email_confirmed_at: new Date().toISOString(),
      created_at: localUser.createdAt
    });
  }

  loadSession();

  /* ----------------------------------------------------------- supabase rpc */

  async function request(method, path, options) {
    const opts = options || {};
    const headers = { apikey: CONFIG.anonKey };
    let body = opts.body;
    if (opts.token) headers.Authorization = "Bearer " + opts.token;
    if (body !== undefined && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof File)) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    Object.assign(headers, opts.headers || {});
    const response = await fetch(base + path, { method, headers, body });
    let data = null;
    const text = await response.text();
    if (text) data = readJSON(text, text);
    if (!response.ok) {
      const message = (data && (data.msg || data.message || data.error_description || data.error || data.hint)) || response.statusText;
      const error = new Error(String(message || "Request failed"));
      error.status = response.status;
      error.code = data && (data.error_code || data.code);
      throw error;
    }
    return data;
  }

  async function refreshSession() {
    if (!CONFIGURED || !session || !session.refreshToken) return null;
    try {
      const data = await request("POST", "/auth/v1/token?grant_type=refresh_token", {
        body: { refresh_token: session.refreshToken }
      });
      saveSession({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
        user: normalizeUser(data.user)
      });
      emitAuthChange();
      return session;
    } catch (err) {
      saveSession(null);
      emitAuthChange();
      return null;
    }
  }

  // Resolve the active session, refreshing an expired access token when needed.
  async function ready() {
    if (!CONFIGURED) {
      if (!currentUser()) return null;
      return currentUser();
    }
    if (!session) return null;
    if (session.expiresAt && session.expiresAt - 30000 < Date.now()) {
      await refreshSession();
    }
    return currentUser();
  }

  /* ------------------------------------------------------------------- auth */

  /* ---------------------------------------------- passwordless email OTP --- */

  // Start a passwordless flow: Supabase emails a one-time code. `create_user`
  // lets the same call both sign up a new address and log an existing one in,
  // so the UI only ever needs one code input. A username sent here lands in
  // user_metadata when the account is first created. `otp_length` asks for the
  // code length the UI shows; the authoritative length is still the project's
  // "Email OTP Length" setting in the Supabase dashboard.
  async function signInWithOtp(fields) {
    const email = String(fields.email || "").trim().toLowerCase();
    const username = String(fields.username || "").trim();
    const createUser = fields.createUser !== false;
    if (!CONFIGURED) {
      // No mail server in demo mode — mint a code and surface it to the UI so
      // the whole OTP flow can still be previewed end to end.
      let code = "";
      for (let i = 0; i < OTP_LENGTH; i += 1) code += Math.floor(Math.random() * 10);
      lsSet(OTP_KEY, { email, username, code, at: Date.now() });
      return { sent: true, email, demoCode: code };
    }
    const body = { email, create_user: createUser, otp_length: OTP_LENGTH };
    if (username) body.data = { username, avatar_url: "" };
    await request("POST", "/auth/v1/otp", { body });
    return { sent: true, email };
  }

  // Verify the emailed code. For email OTP the GoTrue type is "email",
  // which covers both a brand-new sign-up and a returning login.
  async function verifyOtp(fields) {
    const email = String(fields.email || "").trim().toLowerCase();
    const token = String(fields.token || "").trim();
    if (!CONFIGURED) {
      const pending = readJSON(lsGet(OTP_KEY), null);
      if (!pending || pending.email !== email) throw new Error("REQUEST A NEW CODE");
      if (String(pending.code) !== token) throw new Error("INVALID OR EXPIRED CODE");
      lsDel(OTP_KEY);
      const users = readJSON(lsGet(USERS_KEY), []) || [];
      let user = users.find((u) => String(u.email).toLowerCase() === email);
      if (!user) {
        user = {
          id: newId("u"),
          email,
          username: pending.username || email.split("@")[0],
          avatarUrl: "",
          createdAt: new Date().toISOString()
        };
        users.push(user);
      } else if (pending.username && !user.username) {
        user.username = pending.username;
      }
      lsSet(USERS_KEY, users);
      localUser = user;
      lsSet(LOCAL_SESSION_KEY, user);
      emitAuthChange();
      return currentUser();
    }
    const data = await request("POST", "/auth/v1/verify", {
      body: { type: fields.type || "email", email, token }
    });
    saveSession({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      user: normalizeUser(data.user)
    });
    emitAuthChange();
    return currentUser();
  }

  async function signOut() {
    if (CONFIGURED && session && session.accessToken) {
      try {
        await request("POST", "/auth/v1/logout", { token: session.accessToken });
      } catch (err) { /* token may already be gone — still clear locally */ }
    }
    saveSession(null);
    localUser = null;
    lsDel(LOCAL_SESSION_KEY);
    emitAuthChange();
  }

  async function refreshUser() {
    if (!CONFIGURED) return currentUser();
    if (!session || !session.accessToken) return null;
    const data = await request("GET", "/auth/v1/user", { token: session.accessToken });
    if (session) {
      session.user = normalizeUser(data);
      saveSession(session);
    }
    emitAuthChange();
    return currentUser();
  }

  async function updateProfile(fields) {
    if (!CONFIGURED) {
      const users = readJSON(lsGet(USERS_KEY), []) || [];
      const index = users.findIndex((u) => u.id === (localUser && localUser.id));
      if (index === -1) throw new Error("NOT SIGNED IN");
      if (fields.username) users[index].username = fields.username;
      if (fields.avatarUrl) users[index].avatarUrl = fields.avatarUrl;
      localUser = users[index];
      lsSet(USERS_KEY, users);
      lsSet(LOCAL_SESSION_KEY, localUser);
      emitAuthChange();
      return currentUser();
    }
    const data = await request("PUT", "/auth/v1/user", {
      token: session.accessToken,
      body: { data: fields }
    });
    if (session) {
      session.user = normalizeUser(data);
      saveSession(session);
    }
    emitAuthChange();
    return currentUser();
  }

  /* --------------------------------------------------------------- licenses */

  function libraryKey(userId) { return LIBRARY_PREFIX + userId; }
  function localList(userId) { return readJSON(lsGet(libraryKey(userId)), []) || []; }
  function localSave(userId, list) { lsSet(libraryKey(userId), list); }

  function fromRow(row) {
    return {
      id: row.id,
      beatId: row.beat_id || row.beatId,
      beatTitle: row.beat_title || row.beatTitle,
      tierId: row.tier_id || row.tierId,
      tier: row.tier,
      price: row.price,
      purchasedAt: row.purchased_at || row.purchasedAt,
      date: new Date(row.purchased_at || row.purchasedAt || Date.now()).toLocaleDateString()
    };
  }

  async function listLicenses() {
    const user = currentUser();
    if (!user) return [];
    const local = localList(user.id);
    if (!CONFIGURED || !session || !session.accessToken) return local;
    try {
      const rows = await request("GET", "/rest/v1/" + LICENSES_TABLE + "?select=*&order=purchased_at.desc", {
        token: session.accessToken
      });
      const remote = (rows || []).map(fromRow);
      // Merge: remote wins on id, local cache fills anything the table missed.
      const byId = new Map();
      remote.concat(local).forEach((item) => { if (item && item.id && !byId.has(item.id)) byId.set(item.id, item); });
      const merged = Array.from(byId.values());
      localSave(user.id, merged);
      return merged;
    } catch (err) {
      return local;
    }
  }

  async function addLicense(input) {
    const user = currentUser();
    if (!user) return null;
    const list = localList(user.id);
    const duplicate = list.find((item) => item.beatId === input.beatId && item.tierId === input.tierId);
    if (duplicate) return duplicate;
    const license = {
      id: input.id || newId("lic"),
      beatId: input.beatId,
      beatTitle: input.beatTitle,
      tierId: input.tierId,
      tier: input.tier,
      price: input.price,
      purchasedAt: input.purchasedAt || new Date().toISOString(),
      date: new Date(input.purchasedAt || Date.now()).toLocaleDateString()
    };
    localSave(user.id, [license].concat(list));
    if (CONFIGURED && session && session.accessToken) {
      try {
        await request("POST", "/rest/v1/" + LICENSES_TABLE, {
          token: session.accessToken,
          headers: { Prefer: "return=representation" },
          body: {
            id: license.id,
            user_id: user.id,
            beat_id: license.beatId,
            beat_title: license.beatTitle,
            tier_id: license.tierId,
            tier: license.tier,
            price: license.price,
            purchased_at: license.purchasedAt
          }
        });
      } catch (err) { /* local cache already holds it; table may not exist yet */ }
    }
    return license;
  }

  /* ---------------------------------------------------------------- storage */

  async function signedUrl(objectPath, expiresIn) {
    if (!CONFIGURED || !session || !session.accessToken || !objectPath) return "";
    try {
      const data = await request("POST", "/storage/v1/object/sign/" + BUCKETS.beats + "/" + encodeObjectPath(objectPath), {
        token: session.accessToken,
        body: { expiresIn: expiresIn || 3600 }
      });
      if (data && data.signedURL) return base + "/storage/v1" + data.signedURL;
      if (data && data.signedUrl) return base + "/storage/v1" + data.signedUrl;
    } catch (err) { /* fall through to public URL */ }
    return publicUrl(BUCKETS.beats, objectPath);
  }

  function publicUrl(bucket, objectPath) {
    return base + "/storage/v1/object/public/" + bucket + "/" + encodeObjectPath(objectPath);
  }

  function encodeObjectPath(path) {
    return String(path).split("/").map(encodeURIComponent).join("/");
  }

  function triggerDownload(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Download a beat file: prefer the private BEATS object (signed) and fall back
  // to the same-origin preview when the bucket/object is unavailable.
  async function download(file) {
    if (!file) throw new Error("NO FILE FOR THIS LICENSE");
    if (CONFIGURED && session && session.accessToken) {
      try {
        const url = await signedUrl(file.path);
        if (url) {
          const response = await fetch(url);
          if (response.ok) {
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            triggerDownload(objectUrl, file.name || "");
            setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
            return;
          }
        }
      } catch (err) { /* fall back below */ }
    }
    if (file.fallback) {
      const response = await fetch(file.fallback);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      triggerDownload(objectUrl, file.name || file.fallback.split("/").pop());
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      return;
    }
    if (file.path) {
      const url = publicUrl(BUCKETS.beats, file.path);
      triggerDownload(url, file.name || "");
      return;
    }
    throw new Error("NO FILE AVAILABLE");
  }

  async function uploadAvatar(dataUrlOrBlob, contentType) {
    const user = currentUser();
    if (!user) throw new Error("NOT SIGNED IN");
    if (!CONFIGURED || !session || !session.accessToken) return dataUrlOrBlob;
    try {
      const blob = dataUrlOrBlob instanceof Blob ? dataUrlOrBlob : await (await fetch(dataUrlOrBlob)).blob();
      const path = "avatars/" + user.id + "/avatar-" + Date.now() + ".jpg";
      await request("POST", "/storage/v1/object/" + BUCKETS.avatars + "/" + encodeObjectPath(path), {
        token: session.accessToken,
        headers: { "x-upsert": "true", "Content-Type": contentType || blob.type || "image/jpeg" },
        body: blob
      });
      const signed = await request("POST", "/storage/v1/object/sign/" + BUCKETS.avatars + "/" + encodeObjectPath(path), {
        token: session.accessToken,
        body: { expiresIn: 31536000 }
      });
      if (signed && (signed.signedURL || signed.signedUrl)) {
        return base + "/storage/v1" + (signed.signedURL || signed.signedUrl);
      }
      return publicUrl(BUCKETS.avatars, path);
    } catch (err) {
      // Private bucket missing or policy denied — keep the small data URL.
      return dataUrlOrBlob;
    }
  }

  window.KYROLLL_BACKEND = {
    configured: CONFIGURED,
    mode: CONFIGURED ? "supabase" : "local",
    otpLength: OTP_LENGTH,
    buckets: BUCKETS,
    auth: {
      signInWithOtp,
      verifyOtp,
      signOut,
      ready,
      currentUser,
      refreshUser,
      updateProfile
    },
    licenses: { list: listLicenses, add: addLicense },
    storage: { signedUrl, download, uploadAvatar, publicUrl, triggerDownload }
  };

  // Kick off a background token refresh so headers render with a live session.
  if (CONFIGURED) ready().catch(() => {});
})();
