/* KYROlll — backend bridge.
 *
 * One small, dependency-free client that talks to Supabase over its REST API
 * (Auth, Storage and Postgres) and exposes a stable promise API used by every
 * page:
 *
 *   KYROlll_BACKEND.auth.signInWithOtp / verifyOtp / signOut / ready /
 *                          currentUser / updateProfile
 *   KYROlll_BACKEND.licenses.list / add
 *   KYROlll_BACKEND.storage.download / signedUrl / uploadAvatar
 *
 * When `supabase-config.js` has no project URL/key the client transparently
 * falls back to a browser-local implementation (accounts and libraries in
 * localStorage) so the storefront stays fully usable in preview.
 *
 * Auth is passwordless: `signInWithOtp` asks Supabase to email a 6-digit code
 * (creating the account on first use) and `verifyOtp` exchanges that code for a
 * session — the same two calls cover both signing up and logging in. */
(function () {
  "use strict";

  const CONFIG = window.KYROlll_SUPABASE || {};
  const SESSION_KEY = "kyrolll_sb_session";
  const USERS_KEY = "kyrolll_users";
  const LOCAL_SESSION_KEY = "kyrolll_current_user";
  const LIBRARY_PREFIX = "kyrolll_library_";
  const SOLD_KEY = "kyrolll_exclusive_sold";
  const OTP_KEY = "kyrolll_local_otp";
  // Number of digits in the emailed code. Mirrors the project's "Email OTP
  // Length" — KYROlll pins 6 (`set-otp-length.mjs`); brand-new projects default
  // to 8 — and also drives how many digits the auth page's code input accepts.
  const OTP_LENGTH = Math.min(Math.max(parseInt(CONFIG.otpLength, 10) || 6, 4), 10);

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

  /* Read the `sub` claim out of an access token. RLS resolves `auth.uid()` to
   * exactly that value, so a `user_id=eq.<sub>` filter (or a `user_id` write
   * body) built from it is guaranteed to be the row set PostgREST will let the
   * bearer through for. Best-effort: an opaque or malformed token yields "" and
   * the caller falls back to the session's cached user id. */
  function jwtSubject(token) {
    try {
      const part = String(token || "").split(".")[1];
      if (!part) return "";
      const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const claims = JSON.parse(atob(padded));
      return (claims && claims.sub) || "";
    } catch (err) {
      return "";
    }
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
    // `apikey` only tells the gateway which project this is; the *role*
    // PostgREST assumes — and therefore what `auth.uid()` resolves to — comes
    // from the `Authorization` bearer. With no token the request is the
    // anonymous `anon` role and `auth.uid()` is null, so anything that needs the
    // signed-in user must pass `token`. Never fall back to
    // `Authorization: Bearer <apikey>`: that silently downgrades to `anon` and
    // makes an authenticated read look like an empty table.
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

  // A refresh only ends the session when the server definitively rejects the
  // refresh token (revoked, expired, wrong project). A dropped connection, a
  // timeout, a 5xx or an offline moment must never log the visitor out — that
  // is what made navigation feel like it randomly signed people out. On those
  // transient failures we keep the stored session untouched and let the next
  // navigation (or the focus/online wake below) try again.
  function isDefinitiveAuthFailure(err) {
    return !!(err && (err.status === 400 || err.status === 401 || err.status === 403));
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
      if (isDefinitiveAuthFailure(err)) {
        saveSession(null);
        emitAuthChange();
      }
      return null;
    }
  }

  // Resolve the active session, refreshing an expired access token when needed.
  // Transient failures keep the user signed in: `currentUser()` still answers
  // from the stored session, so the store stays stable across page loads.
  async function ready() {
    if (!CONFIGURED) {
      if (!currentUser()) return null;
      return currentUser();
    }
    if (!session) return null;
    if (session.expiresAt && session.expiresAt - 60000 < Date.now()) {
      const refreshed = await refreshSession();
      // One quiet retry smooths over a momentary blip before the user sees it.
      if (!refreshed && session && session.refreshToken) await refreshSession();
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
  //
  // The email itself is rendered server-side by GoTrue, so its look is owned by
  // the project's auth config, not by this request: `set-auth-email-templates.mjs`
  // installs the branded KYROlll dark template and strips the default Supabase
  // `{{ .ConfirmationURL }}` link so the mail carries only the code. This call
  // deliberately sends no `email_redirect_to`, so no magic link is ever minted
  // for a code-only login.
  async function signInWithOtp(fields) {
    const email = String(fields.email || "").trim().toLowerCase();
    const username = String(fields.username || "").trim();
    const createUser = fields.createUser !== false;
    if (!CONFIGURED) {
      if (createUser === false) {
        // Sign-in-only request: unknown addresses must be rejected exactly like
        // the live GoTrue /otp call so the auth page can tell "not registered"
        // apart from real failures and guide the user to sign up.
        const users = readJSON(lsGet(USERS_KEY), []) || [];
        const exists = users.some((u) => String(u.email || "").toLowerCase() === email);
        if (!exists) {
          const error = new Error("Signups not allowed for otp");
          error.status = 422;
          error.code = "otp_disabled";
          throw error;
        }
      }
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

  // Why the last remote read failed, when it did. The library page reads this
  // so an unreachable table is never mistaken for "no licenses": a missing
  // table, an expired token and a missing RLS policy all looked the same when
  // the catch simply returned the (empty) local cache.
  let licensesError = null;

  /* A beat sold on an exclusive license is off the market for everyone, so that
   * fact cannot live only inside one buyer's library: this browser remembers the
   * beats it has seen taken, and the `licenses` table is asked for the rest. The
   * query is best-effort — a project whose RLS exposes only a buyer's own rows
   * still answers from the local record, and it is skipped entirely while the
   * store runs unconfigured. */
  function localSold() { return readJSON(lsGet(SOLD_KEY), []) || []; }
  function rememberExclusive(beatId) {
    if (!beatId) return;
    const sold = localSold();
    if (!sold.includes(beatId)) lsSet(SOLD_KEY, sold.concat(beatId));
  }
  async function soldExclusive() {
    const ids = new Set(localSold());
    if (!CONFIGURED) return Array.from(ids);
    try {
      // Signed in, this goes out as the authenticated role so the buyer's own
      // exclusive row is visible; signed out it stays a deliberately anonymous
      // read, which is the request a public SELECT policy on `beat_id` would
      // open up site-wide. Either way the local record still answers on failure.
      const rows = await withSession((token) => request(
        "GET",
        "/rest/v1/" + LICENSES_TABLE + "?select=beat_id&tier_id=eq.exclusive",
        token ? { token: token } : undefined
      ));
      (rows || []).forEach((row) => { if (row.beat_id) ids.add(row.beat_id); });
    } catch (err) { /* not readable here — the local answer still stands */ }
    return Array.from(ids);
  }

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

  /* Supabase's supabase-js hands callers a live token through
   * `auth.getSession()`, refreshing it first when it is near expiry. This client
   * is dependency-free, so the equivalent is `ready()` — which refreshes the
   * stored session once it is within a minute of expiring — plus a one-shot
   * retry when the server still answers 401, because a token can lapse between
   * the freshness check and the request landing. Every authenticated call goes
   * through here, so the request always carries a *current*
   * `Authorization: Bearer <token>` and never a stale one — a stale token is the
   * usual reason the library read came back 401. */
  async function withSession(perform) {
    if (!CONFIGURED || !session) return perform(null);
    await ready();
    let token = session && session.accessToken;
    if (!token) return perform(null);
    try {
      return await perform(token);
    } catch (err) {
      if (!err || err.status !== 401 || !(session && session.refreshToken)) throw err;
      const refreshed = await refreshSession();
      const next = refreshed && refreshed.accessToken;
      if (!next) throw err;
      return await perform(next);
    }
  }

  /* Read the licenses for the signed-in user. The `user_id` filter is explicit
   * even though RLS already pins rows to `auth.uid() = user_id`: it states the
   * intent, and it is what keeps another account's rows out if the SELECT
   * policy is ever loosened or absent. It is built from the `sub` of the token
   * being sent, not from the cached user — those must be the same value as the
   * `auth.uid()` PostgREST will compute, and a refresh can move one past the
   * other. A failure is recorded (and warned once) rather than swallowed, so the
   * library can say *why* it is empty. */
  async function listLicenses() {
    const user = currentUser();
    if (!user) return [];
    const local = localList(user.id);
    try {
      const rows = await withSession((token) => {
        if (!token) return [];
        const owner = jwtSubject(token) || user.id;
        return request(
          "GET",
          "/rest/v1/" + LICENSES_TABLE +
            "?select=*&user_id=eq." + encodeURIComponent(owner) +
            "&order=purchased_at.desc",
          { token: token }
        );
      });
      licensesError = null;
      const remote = (rows || []).map(fromRow);
      // Merge: remote wins on id, local cache fills anything the table missed.
      const byId = new Map();
      remote.concat(local).forEach((item) => { if (item && item.id && !byId.has(item.id)) byId.set(item.id, item); });
      const merged = Array.from(byId.values());
      localSave(user.id, merged);
      return merged;
    } catch (err) {
      licensesError = {
        status: (err && err.status) || 0,
        code: (err && err.code) || "",
        message: String((err && err.message) || err)
      };
      console.warn("KYROlll: licenses read failed", licensesError);
      return local;
    }
  }

  /* A snapshot of everything that decides whether the library can list
   * licenses — surfaced by the library page when the list comes back empty so
   * a broken read is not silently presented as an empty library. */
  function licensesDiagnostic() {
    const user = currentUser();
    return {
      configured: CONFIGURED,
      signedIn: !!(session && session.accessToken),
      table: LICENSES_TABLE,
      project: base,
      userId: (user && user.id) || "",
      email: (user && user.email) || "",
      error: licensesError
    };
  }

  async function addLicense(input) {
    const user = currentUser();
    if (!user) return null;
    // An exclusive sale takes the beat off the market for everyone, whatever
    // tiers this buyer already holds.
    if (input.tierId === "exclusive") rememberExclusive(input.beatId);
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
    if (CONFIGURED && session) {
      try {
        // No `id` in the body: the table's uuid default owns it. Sending the
        // local "lic_…" id would be rejected by a uuid column (22P02) and the
        // row would never reach the table — the purchase would live only in
        // this browser. `withSession` refreshes a stale token first, so a long
        // checkout cannot fail the write on a 401.
        const created = await withSession((token) => token
          ? request("POST", "/rest/v1/" + LICENSES_TABLE, {
              token: token,
              headers: { Prefer: "return=representation" },
              body: {
                // `with check (auth.uid() = user_id)`: write the token's own
                // subject so the insert is the one the policy will accept.
                user_id: jwtSubject(token) || user.id,
                beat_id: license.beatId,
                beat_title: license.beatTitle,
                tier_id: license.tierId,
                tier: license.tier,
                price: license.price,
                purchased_at: license.purchasedAt
              }
            })
          : null);
        // Adopt the server's id so the local copy and the row de-dupe on the
        // next read instead of showing the same purchase twice.
        const row = Array.isArray(created) ? created[0] : created;
        if (row && row.id) {
          license.id = row.id;
          localSave(user.id, localList(user.id).map((item) =>
            item.beatId === license.beatId && item.tierId === license.tierId ? license : item
          ));
        }
      } catch (err) {
        // Local cache already holds it; the table may not exist yet.
        console.warn("KYROlll: license write failed", { status: err && err.status, message: String((err && err.message) || err) });
      }
    }
    return license;
  }

  /* ---------------------------------------------------------------- storage */

  async function signedUrl(objectPath, expiresIn) {
    if (!CONFIGURED || !session || !objectPath) return "";
    try {
      const data = await withSession((token) => token
        ? request("POST", "/storage/v1/object/sign/" + BUCKETS.beats + "/" + encodeObjectPath(objectPath), {
            token: token,
            body: { expiresIn: expiresIn || 3600 }
          })
        : null);
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
    if (!CONFIGURED || !session) return dataUrlOrBlob;
    try {
      const blob = dataUrlOrBlob instanceof Blob ? dataUrlOrBlob : await (await fetch(dataUrlOrBlob)).blob();
      const path = "avatars/" + user.id + "/avatar-" + Date.now() + ".jpg";
      // The object path is keyed to the owner and the bucket policy reads
      // `auth.uid()`, so the bearer has to be the signed-in user's — and one
      // that has not quietly expired since the session was stored.
      const signed = await withSession(async (token) => {
        if (!token) throw new Error("NOT SIGNED IN");
        await request("POST", "/storage/v1/object/" + BUCKETS.avatars + "/" + encodeObjectPath(path), {
          token: token,
          headers: { "x-upsert": "true", "Content-Type": contentType || blob.type || "image/jpeg" },
          body: blob
        });
        return request("POST", "/storage/v1/object/sign/" + BUCKETS.avatars + "/" + encodeObjectPath(path), {
          token: token,
          body: { expiresIn: 31536000 }
        });
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

  window.KYROlll_BACKEND = {
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
    licenses: { list: listLicenses, add: addLicense, soldExclusive, diagnose: licensesDiagnostic },
    storage: { signedUrl, download, uploadAvatar, publicUrl, triggerDownload }
  };

  // Keep the session warm: refresh when the tab wakes, regains focus or the
  // network returns, and never let a transient failure drop the visitor. This
  // is what keeps a signed-in visitor signed in as they move between pages.
  function wakeSession() {
    if (!CONFIGURED || document.hidden) return;
    ready().catch(() => {});
  }
  document.addEventListener("visibilitychange", wakeSession);
  window.addEventListener("focus", wakeSession);
  window.addEventListener("online", wakeSession);

  // Kick off a background token refresh so headers render with a live session.
  if (CONFIGURED) ready().catch(() => {});
})();
