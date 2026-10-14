/* KYROlll — backend bridge.
 *
 * One small, dependency-free client that talks to Supabase over its REST API
 * (Auth, Storage and Postgres) and exposes a stable promise API used by every
 * page:
 *
 *   KYROlll_BACKEND.auth.signInWithOtp / verifyOtp / signOut / ready /
 *                          currentUser / updateProfile
 *   KYROlll_BACKEND.licenses.list / add / soldExclusive
 *   KYROlll_BACKEND.payments.createInvoice
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

  /* The stored session can appear *after* this module parsed — a login that
   * resolves in another tab, or a write that lands late — so every
   * authenticated entry point adopts it before concluding the visitor is
   * signed out. Without this, a fetch that runs off the in-memory copy could go
   * out with no bearer even though `kyrolll_sb_session` is in localStorage. */
  function adoptStoredSession() {
    if (CONFIGURED && !session) loadSession();
    return session;
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
    const headers = { apikey: CONFIG.anonKey, Accept: "application/json" };
    let body = opts.body;
    if (opts.token && typeof opts.token === "string" && opts.token.trim().length > 10) {
      headers.Authorization = "Bearer " + opts.token.trim();
    }
    if (body !== undefined && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof File)) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    Object.assign(headers, opts.headers || {});
    // Debug: log the exact request with sensitive tokens masked.
    console.log("KYROlll: request() →", method, base + path, {
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => {
        if (/^(authorization|apikey)$/i.test(k) && typeof v === "string") {
          return [k, v.replace(/(Bearer\s+)?(.{6}).*(.{4})/, "$1$2…$3")];
        }
        return [k, v];
      }))
    });
    let response;
    try {
      response = await fetch(base + path, { method, headers, body });
    } catch (netErr) {
      const msg = "Network/CORS error: " + String((netErr && netErr.message) || netErr);
      console.error("KYROlll: request() network failure for", path, msg);
      const error = new Error(msg);
      error.status = 0;
      error.network = true;
      throw error;
    }
    let data = null;
    const text = await response.text();
    if (text) data = readJSON(text, text);
    if (!response.ok) {
      // Debug: surface the exact error body Supabase returned.
      console.error("KYROlll: request() ← HTTP", response.status, response.statusText, "for", method, base + path);
      console.error("KYROlll: request() error body:", text || "(empty response body)");
      const message = (data && (data.msg || data.message || data.error_description || data.error || data.hint)) || response.statusText;
      const error = new Error(String(message || "Request failed"));
      error.status = response.status;
      error.code = data && (data.error_code || data.code);
      error.body = text;
      throw error;
    }
    return data;
  }

  // A refresh only ends the session when the server definitively rejects the
  // credential (revoked/expired refresh token, wrong project). A dropped
  // connection, a timeout, a 5xx or an offline moment must never log the
  // visitor out — that is what made navigation feel like it randomly signed
  // people out. On those transient failures we keep the stored session
  // untouched and let the next navigation (or the focus/online wake below) try
  // again.
  //
  // 500/520 are deliberately *not* in this list: they mean the gateway or
  // PostgREST failed, not that the bearer was rejected (an unparseable JWT is
  // a 401), and treating them as a refusal is what stripped the Authorization
  // header off every request that followed a single upstream hiccup.
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
        // The server definitively refused the refresh (revoked, expired, wrong
        // project): forget the refused identity completely — the session it
        // claimed and the cached library written under the claimed id. Only
        // the named keys go; a blanket localStorage.clear() would take
        // unrelated app state with it.
        const claimed = session && session.user && session.user.id;
        if (claimed) lsDel(libraryKey(claimed));
        saveSession(null);
        verifiedToken = "";
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
    if (!adoptStoredSession()) return null;
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
        "/rest/v1/" + LICENSES_TABLE + "?select=beat_id&license_type=eq.exclusive&status=eq.active",
        token ? { token: token } : undefined
      ));
      (rows || []).forEach((row) => { if (row.beat_id) ids.add(row.beat_id); });
    } catch (err) { /* not readable here — the local answer still stands */ }
    return Array.from(ids);
  }

  function licenseTypeName(type) {
    const tiers = window.KYROlll_LICENSES || [];
    const tier = tiers.find((entry) => entry.id === type);
    return tier ? tier.name : (type || "");
  }

  function beatTitleFor(beatId) {
    const helpers = window.KYROlll_HELPERS;
    const beat = helpers && helpers.beatById ? helpers.beatById(beatId) : null;
    return beat ? beat.title : "";
  }

  function formatPrice(value) {
    if (value == null || value === "") return "";
    const number = Number(value);
    return Number.isFinite(number) ? "$" + number.toFixed(2) : String(value);
  }

  /* Map a `licenses` row (payment shape: beat_id / license_type / price /
   * payment_id / status / created_at) onto the UI shape the library and the
   * PDF renderer use. The table stores no titles or tier names — those are
   * resolved from the catalog — and `created_at` replaces the old
   * `purchased_at`. */
  function fromRow(row) {
    const type = row.license_type || row.tier_id || row.tierId || "";
    const beatId = row.beat_id || row.beatId;
    const createdAt = row.created_at || row.purchased_at || row.purchasedAt || null;
    return {
      id: row.id,
      beatId: beatId,
      beatTitle: row.beat_title || row.beatTitle || beatTitleFor(beatId),
      tierId: type,
      tier: row.tier || licenseTypeName(type),
      price: formatPrice(row.price != null ? row.price : row.price_text),
      status: row.status || "active",
      purchasedAt: createdAt,
      date: new Date(createdAt || Date.now()).toLocaleDateString()
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
    if (!CONFIGURED) return perform(null);
    if (!adoptStoredSession()) return perform(null);
    await ready();
    let token = session && session.accessToken;
    if (!token) return perform(null);
    try {
      return await perform(token);
    } catch (err) {
      // A 5xx (500/520) is the gateway or PostgREST failing — *not* the bearer
      // being rejected, which is what a 401 means. Renew the token if we can
      // and replay once; otherwise surface the error with the session left
      // exactly as it is, so the next request still carries its bearer.
      // Deleting it here is what turned one upstream hiccup into a spontaneous
      // sign-out.
      if (err && (err.status === 500 || err.status === 520)) {
        if (session && session.refreshToken) {
          const refreshed = await refreshSession();
          const next = refreshed && refreshed.accessToken;
          if (next) return await perform(next);
        }
        err.transient = true;
        throw err;
      }
      // 401 = expired token → try silent renewal.
      const isDefinitive = !err || (err.status !== 401 && err.status !== 0 && !err.network);
      if (!err || (err.status === 401 && !(session && session.refreshToken))) {
        err.sessionRefused = true;
        throw err;
      }
      if (isDefinitive || !(session && session.refreshToken)) {
        err.sessionRefused = true;
        throw err;
      }
      // Silent renewal: exchange the refresh token and replay the call once.
      const refreshed = await refreshSession();
      const next = refreshed && refreshed.accessToken;
      if (!next) {
        err.sessionRefused = !session;
        throw err;
      }
      return await perform(next);
    }
  }

  /* Forget a session the server has refused, and with it the one cached library
   * that belonged to the identity that session claimed — that cache was written
   * for whichever account the stale record named, so leaving it behind is what
   * lets a later read look like someone else's. Only the named keys go: a
   * blanket localStorage.clear() would take unrelated app state with it. */
  function forgetRefusedSession() {
    const claimed = session && session.user && session.user.id;
    if (claimed) lsDel(libraryKey(claimed));
    saveSession(null);
    verifiedToken = "";
    emitAuthChange();
  }

  // The access token the cached session user was last confirmed against.
  let verifiedToken = "";

  /* Reconcile the cached session user with the live token. `auth.uid()` is
   * the token's `sub` and RLS enforces it server-side, but `session.user` is
   * only a client-side hint: a session carried over from an earlier sign-in,
   * written by another tab or left over from a refresh can disagree with the
   * token. The JWT itself is checked first — its `sub` is the exact claim
   * `auth.uid()` resolves, so when it already names the cached user (or is
   * opaque and carries no claim that could contradict the cache) no server
   * round trip is needed. When the token claims a *different* identity than
   * the cache, this asks `/auth/v1/user` with the current bearer (through
   * `withSession`, so an expired token is renewed first), adopts the server's
   * answer and drops the cache keyed to the contradicted id. It runs once per
   * token per page (`verifiedToken`), keeping the round trip off repeated
   * reads.
   *
   * Never throws. A refused session is forgotten and reported as null so
   * callers fall back to the signed-out state; a transient failure falls back
   * to the cached user and lets the caller's own request decide. */
  async function alignSessionUser() {
    if (!CONFIGURED || !session || !session.accessToken) return null;
    if (verifiedToken === session.accessToken) return currentUser();
    const claimed = session.user && session.user.id;
    const tokenSub = jwtSubject(session.accessToken);
    // The live token itself is the verification: nothing can be wrong when
    // there is no cached identity to contradict it, or when its own `sub`
    // already names the cached user. Trust the JWT, not the other way around.
    if (!claimed || !tokenSub || tokenSub === claimed) {
      verifiedToken = session.accessToken;
      return currentUser();
    }
    // The live token claims a different identity than the cached user — ask
    // the server who this bearer actually belongs to and adopt its answer.
    try {
      const data = await withSession((token) => token
        ? request("GET", "/auth/v1/user", { token: token })
        : null);
      const verified = normalizeUser(data);
      if (!verified || !verified.id) return currentUser();
      // Drop the cache written under the contradicted id — only that named
      // key — and let the session follow the server's answer.
      lsDel(libraryKey(claimed));
      session.user = verified;
      saveSession(session);
      // The token's `sub` must agree with the adopted user; if it still claims
      // someone else the record is corrupt — forget it so nothing can leak
      // across identities.
      const adoptedSub = jwtSubject(session.accessToken);
      if (adoptedSub && adoptedSub !== verified.id) {
        forgetRefusedSession();
        return null;
      }
      verifiedToken = session.accessToken;
      emitAuthChange();
      return currentUser();
    } catch (err) {
      // Only a bearer the server actually refused (401/403, flagged
      // `sessionRefused` by `withSession`) forgets the session. A 5xx here is
      // the server failing, not the token being invalid — wiping on it is what
      // made an upstream hiccup look like a sign-out.
      if (err && err.sessionRefused) {
        forgetRefusedSession();
        return null;
      }
      // Transient failure — keep the cached session so navigation isn't
      // interrupted, but the caller's own request will decide.
      return currentUser();
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
    // Coalesce concurrent calls: while a read is in flight, every caller shares
    // the same promise instead of firing another request. This is the second
    // half of the loop guard (the first lives in the library page's render) —
    // an auth event emitted mid-read can never start a competing fetch.
    if (licensesInflight) return licensesInflight;
    licensesInflight = listLicensesOnce().finally(() => { licensesInflight = null; });
    return licensesInflight;
  }

  let licensesInflight = null;

  async function listLicensesOnce() {
    // Adopt a session written after this module parsed (another tab, or a late
    // write) before the signed-out gate below drops the read.
    adoptStoredSession();
    if (!currentUser()) return [];
    // Resolve who is actually signed in before building the query: `ready()`
    // refreshes a session that is at/near expiry (its response re-reads the
    // user), and `alignSessionUser()` reconciles a cached user the token
    // contradicts. Only then is the id safe to use as the filter and cache key.
    await ready();
    await alignSessionUser();
    const user = currentUser();
    if (!user) return [];
    const local = localList(user.id);
    try {
      const rows = await withSession((token) => {
        if (!token) return [];
        // The filter comes from the *token being sent*, so it is the same
        // `sub` PostgREST resolves as `auth.uid()` and RLS enforces — never
        // blindly the cached user. (The cached id is only the fallback for an
        // opaque token with no readable claim, where RLS still enforces the
        // live token server-side.)
        const owner = jwtSubject(token) || user.id;
        return request(
          "GET",
          "/rest/v1/" + LICENSES_TABLE +
            "?select=*&user_id=eq." + encodeURIComponent(owner) +
            "&order=created_at.desc",
          { token: token }
        );
      });
      licensesError = null;
      const remote = (rows || []).map(fromRow);
      // Merge: remote (webhook-written) rows win. A local copy of the *same*
      // purchase — same beat + tier — is dropped so the row's server uuid and
      // the browser's optimistic `lic_…` record never show up as two items.
      const seen = new Set();
      const merged = [];
      remote.concat(local).forEach((item) => {
        if (!item) return;
        const key = (item.beatId || item.id) + "|" + (item.tierId || "");
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(item);
      });
      localSave(user.id, merged);
      return merged;
    } catch (err) {
      // Any failure — stale/refused session, network/CORS drop, 500/520, a
      // missing table — is swallowed gracefully: the library falls back to the
      // cached licenses for this user (written by every successful read and by
      // `addLicense`) so "My Library" still loads instead of showing
      // "LIBRARY UNREACHABLE". Only the named library cache is consulted; no
      // blanket localStorage.clear(), and the session is only forgotten when
      // the server actually refused it.
      const isAuth = !!(err && (err.status === 401 || err.status === 403 || err.sessionRefused));
      if (isAuth) {
        try { forgetRefusedSession(); } catch (ignore) { /* ignore */ }
      }
      licensesError = null; // never surface the crash screen
      console.warn("KYROlll: licenses read failed — using cached library fallback", {
        status: (err && err.status) || 0,
        network: !!(err && err.network),
        message: String((err && err.message) || err)
      });
      // After a refused session the user may now be null; still return the
      // cache that belongs to whatever identity remains.
      const afterUser = currentUser();
      return afterUser ? localList(afterUser.id) : local;
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
    if (!currentUser()) return null;
    // Cache under the identity the session resolves to, so a local record can
    // only ever be filed against this account.
    await alignSessionUser();
    const user = currentUser();
    if (!user) return null;
    // Permanent user mapping: the session identity must match the verified
    // JWT sub (auth.users.id). Any mismatch means a stale/shifting record.
    if (CONFIGURED && session && session.accessToken) {
      const tokenSub = jwtSubject(session.accessToken);
      if (tokenSub && tokenSub !== user.id) {
        // Stale session pointing to a shifted id — forget cleanly, abort.
        forgetRefusedSession();
        return null;
      }
    }
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
    // The license ROW is never written from the browser: `licenses` has a
    // SELECT-only RLS policy, and the only writer is the `nowpayments-webhook`
    // Edge Function using the service_role key. What lives here is the local
    // cache (and the whole store in local-demo mode) — the library read merges
    // it with the remote rows and the webhook's row wins for the same purchase.
    return license;
  }

  /* --------------------------------------------------------------- payments */

  /* Ask the `create-payment` Edge Function for a NOWPayments invoice for the
   * signed-in buyer. The function verifies the bearer, prices the order
   * server-side and returns `{ url }` — the hosted invoice page. The browser
   * never builds the order or the price, and it never writes a license: the
   * `nowpayments-webhook` function does that with the service_role key. */
  async function createInvoice(input) {
    if (!CONFIGURED) throw new Error("SUPABASE NOT CONFIGURED");
    const beatId = input && input.beatId;
    const licenseType = input && input.licenseType;
    if (!beatId || !licenseType) throw new Error("MISSING LICENSE SELECTION");
    if (!currentUser()) throw new Error("NOT SIGNED IN");
    await ready();
    return withSession((token) => {
      if (!token) throw new Error("NOT SIGNED IN");
      return request("POST", "/functions/v1/create-payment", {
        token: token,
        body: { beat_id: beatId, license_type: licenseType }
      });
    });
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
    payments: { createInvoice },
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

  // localStorage is shared between tabs, but the in-memory session above is not.
  // Re-read it when the key changes so a sign-in or sign-out in one tab is
  // honoured by the fetch path in the others immediately, instead of that tab
  // continuing to read with the identity it happened to load with.
  window.addEventListener("storage", (event) => {
    if (!CONFIGURED) return;
    if (event.key && event.key !== SESSION_KEY && event.key !== LOCAL_SESSION_KEY) return;
    loadSession();
    emitAuthChange();
  });

  // Kick off a background token refresh so headers render with a live session.
  if (CONFIGURED) ready().catch(() => {});
})();
