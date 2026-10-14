/* Tests for kyrolll-backend.js's license query path — the code the library page
 * runs to fetch the signed-in user's rows. The module is a browser IIFE, so the
 * test runs it in a fresh vm context with window/document/localStorage shims and
 * a stubbed fetch. No network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(HERE, "kyrolll-backend.js"), "utf8");

const SERVER = "https://abcdefghijklmnopqrst.supabase.co"; // 20-char ref, not the placeholder
const ANON = "anon-key-123";
const USER = { id: "user-123", email: "matan@example.com", username: "matan" };

// Build an unsigned JWT-shaped token so a test can control the `sub` claim that
// RLS resolves as `auth.uid()`.
function jwt(claims) {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return enc({ alg: "HS256", typ: "JWT" }) + "." + enc(claims) + ".signature";
}

function memoryStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    get: (key) => map.get(key)
  };
}

// A controllable clock so a test can let a token expire without sleeping.
function makeClock(start) {
  let now = start;
  class FakeDate extends Date {
    constructor(...args) { if (args.length === 0) super(now); else super(...args); }
    static now() { return now; }
  }
  return { Date: FakeDate, set: (t) => { now = t; }, get: () => now };
}

// Run a fresh copy of the IIFE in its own context. `expiresAt` is kept in the
// future so the load-time `ready()` does not add a refresh call to fetch.
function boot(fetchImpl, sessionOverride, clock) {
  const now = clock ? clock.get() : Date.now();
  const session = sessionOverride === null ? null : Object.assign({
    // Longer than request()'s "too short to be a session" bearer guard (> 10),
    // so the stub is attached instead of silently sent anonymously.
    accessToken: "jwt-abc-0123456789",
    refreshToken: "refresh-abc",
    expiresAt: now + 3600000,
    user: USER
  }, sessionOverride || {});
  const storage = memoryStorage(session ? { kyrolll_sb_session: JSON.stringify(session) } : {});
  const win = {
    KYROlll_SUPABASE: { url: SERVER, anonKey: ANON, tables: { licenses: "licenses" } },
    addEventListener() {},
    dispatchEvent() {}
  };
  const sandbox = {
    window: win,
    document: {
      hidden: false,
      addEventListener() {},
      createElement: () => ({ style: {}, click() {} }),
      body: { appendChild() {} }
    },
    localStorage: storage,
    fetch: fetchImpl,
    console,
    Date: clock ? clock.Date : Date,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    Blob,
    FormData,
    File,
    atob,
    setTimeout,
    clearTimeout
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "kyrolll-backend.js" });
  return { backend: win.KYROlll_BACKEND, storage };
}

function captureWarn() {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.map((arg) => String(arg)).join(" "));
  return { lines, restore: () => { console.warn = original; } };
}

test("lists only the signed-in user's rows, with a valid api key and JWT", async () => {
  const calls = [];
  const { backend } = boot(async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify([
        { id: "row-1", beat_id: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af", license_type: "mp3", price: 9.95, payment_id: "pay-1", status: "active", created_at: "2026-10-01T00:00:00Z" }
      ])
    };
  });

  const items = await backend.licenses.list();

  assert.equal(calls.length, 1, "one read, no unexpected request");
  assert.equal(
    calls[0].url,
    SERVER + "/rest/v1/licenses?select=*&user_id=eq.user-123&order=created_at.desc",
    "filters explicitly by the signed-in user"
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer jwt-abc-0123456789");
  assert.equal(calls[0].init.headers.apikey, ANON);
  assert.equal(items.length, 1);
  assert.equal(items[0].tierId, "mp3");
  assert.equal(items[0].beatId, "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af");
  assert.equal(items[0].price, "$9.95", "numeric price is rendered for the library");
  assert.equal(items[0].status, "active");

  const diagnostic = backend.licenses.diagnose();
  assert.equal(diagnostic.error, null, "a clean read records no error");
  assert.equal(diagnostic.userId, "user-123");
  assert.equal(diagnostic.signedIn, true);
  assert.equal(diagnostic.table, "licenses");
});

test("an id needing encoding cannot break the filter", async () => {
  const calls = [];
  const { backend } = boot(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => "[]" };
  }, { user: { id: "a b&c", email: "x@y.z", username: "x" } });

  await backend.licenses.list();
  assert.match(calls[0].url, /user_id=eq\.a%20b%26c&order=/);
});

test("a failed read is recorded, not silently shown as an empty library", async () => {
  const warn = captureWarn();
  const { backend } = boot(async () => ({
    ok: false, status: 401,
    text: async () => JSON.stringify({ message: "JWT expired" })
  }));

  const items = await backend.licenses.list();
  warn.restore();

  assert.equal(items.length, 0, "falls back to the local cache");
  const diagnostic = backend.licenses.diagnose();
  assert.equal(diagnostic.error.status, 401);
  assert.match(diagnostic.error.message, /JWT expired/);
  assert.equal(diagnostic.project, SERVER);
  assert.ok(warn.lines.some((line) => /licenses read failed/.test(line)), "warns once with the reason");
});

test("adding a license never writes to the table — only the webhook may", async () => {
  const calls = [];
  const { backend, storage } = boot(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 201, text: async () => JSON.stringify([{ id: "server-uuid" }]) };
  });

  const license = await backend.licenses.add({
    beatId: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af", beatTitle: "FLESH", tierId: "wav", tier: "STANDARD WAV LEASE", price: "$14.95"
  });

  const writes = calls.filter((call) => call.init && call.init.method === "POST");
  assert.equal(writes.length, 0, "the browser must not INSERT: licenses has a SELECT-only policy");
  assert.ok(license && license.id, "the local cache still records the purchase");
  const cached = JSON.parse(storage.get("kyrolll_library_user-123"));
  assert.equal(cached[0].tierId, "wav");
});

test("createInvoice calls the payment function with the bearer and the selection", async () => {
  const calls = [];
  // A realistic-length token: request() refuses to attach a bearer it deems
  // too short to be a session, so a stub like "jwt-abc" would be sent anonymously.
  const token = "jwt-abcdefghijklmnop";
  const { backend } = boot(async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/functions/v1/create-payment")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ url: "https://nowpayments.io/payment/?iid=1" }) };
    }
    return { ok: true, status: 200, text: async () => "[]" };
  }, { accessToken: token });

  const invoice = await backend.payments.createInvoice({
    beatId: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af", licenseType: "mp3"
  });

  assert.equal(invoice.url, "https://nowpayments.io/payment/?iid=1", "returns the hosted invoice URL");
  const post = calls.find((call) => call.url.includes("/functions/v1/create-payment"));
  assert.ok(post, "calls the function");
  assert.equal(post.init.method, "POST");
  assert.equal(post.init.headers.Authorization, "Bearer " + token, "sends the buyer's token");
  assert.deepEqual(JSON.parse(post.init.body), {
    beat_id: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af",
    license_type: "mp3"
  });
});

test("refreshes a token that is about to expire before reading", async () => {
  const clock = makeClock(Date.now());
  const calls = [];
  const { backend } = boot(async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ access_token: "jwt-fresh-0000", refresh_token: "refresh-2", expires_in: 3600, user: USER })
      };
    }
    return { ok: true, status: 200, text: async () => "[]" };
  }, { expiresAt: clock.get() + 120000 }, clock);

  assert.equal(calls.length, 0, "a valid token is not refreshed at load");

  clock.set(clock.get() + 90000); // now inside the refresh window
  await backend.licenses.list();

  const read = calls[calls.length - 1];
  assert.match(read.url, /\/rest\/v1\/licenses\?/);
  assert.equal(read.init.headers.Authorization, "Bearer jwt-fresh-0000", "reads with the refreshed token");
  assert.ok(calls.some((call) => call.url.includes("grant_type=refresh_token")), "refreshed first");
});

test("a 401 on the read refreshes the token and retries once", async () => {
  let reads = 0;
  const calls = [];
  const { backend } = boot(async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ access_token: "jwt-fresh-0000", refresh_token: "refresh-2", expires_in: 3600, user: USER })
      };
    }
    reads += 1;
    if (reads === 1) {
      return { ok: false, status: 401, text: async () => JSON.stringify({ message: "JWT expired" }) };
    }
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify([
        { id: "row-1", beat_id: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af", license_type: "mp3", created_at: "2026-10-01T00:00:00Z" }
      ])
    };
  });

  const items = await backend.licenses.list();

  assert.equal(items.length, 1, "the retry succeeds");
  assert.equal(backend.licenses.diagnose().error, null, "a successful retry clears the error");
  const attempts = calls.filter((call) => /\/rest\/v1\/licenses\?/.test(call.url));
  assert.equal(attempts.length, 2, "one 401, then one retry");
  assert.equal(attempts[0].init.headers.Authorization, "Bearer jwt-abc-0123456789");
  assert.equal(attempts[1].init.headers.Authorization, "Bearer jwt-fresh-0000");
  assert.ok(calls.some((call) => call.url.includes("grant_type=refresh_token")), "refreshed between attempts");
});

test("a 401 with no refresh token is surfaced, not retried forever", async () => {
  const warn = captureWarn();
  let reads = 0;
  const { backend } = boot(async () => {
    reads += 1;
    return { ok: false, status: 401, text: async () => JSON.stringify({ message: "JWT expired" }) };
  }, { refreshToken: "" });

  await backend.licenses.list();
  warn.restore();

  assert.equal(reads, 1, "does not retry without a refresh token");
  assert.equal(backend.licenses.diagnose().error.status, 401);
});

test("filters the read by the token's sub, so it matches auth.uid()", async () => {
  // The stored session is stale: its cached user id is no longer the `sub` of
  // the access token the read will carry.
  const calls = [];
  const { backend } = boot(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => "[]" };
  }, {
    accessToken: jwt({ sub: "user-from-token" }),
    user: { id: "user-stale", email: "matan@example.com" }
  });

  await backend.licenses.list();

  const read = calls.find((call) => call.url.includes("/rest/v1/licenses?"));
  assert.ok(read, "reads the table");
  assert.match(read.url, /user_id=eq\.user-from-token/, "filters on the token's sub");
  assert.equal(read.init.headers.Authorization, "Bearer " + jwt({ sub: "user-from-token" }));
  assert.equal(read.init.headers.apikey, ANON, "the anon key is only the project key");
  assert.doesNotMatch(read.url, /user-stale/, "never filters on the stale cached id");
});

test("an exclusive purchase marks the beat sold in the local record", async () => {
  const { backend } = boot(async () => ({ ok: true, status: 200, text: async () => "[]" }));

  await backend.licenses.add({
    beatId: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af", beatTitle: "FLESH", tierId: "exclusive", tier: "EXCLUSIVE LEASE", price: "$299.95"
  });

  const sold = await backend.licenses.soldExclusive();
  assert.ok(Array.from(sold).includes("6c56eda2-df4a-45b0-b9b7-68f8efdbb1af"), "the local record locks the beat");
});

test("the exclusive lookup is authenticated when signed in", async () => {
  const calls = [];
  const { backend } = boot(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify([{ beat_id: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af" }]) };
  });

  const sold = await backend.licenses.soldExclusive();

  assert.deepEqual(Array.from(sold), ["6c56eda2-df4a-45b0-b9b7-68f8efdbb1af"]);
  const read = calls.find((call) => call.url.includes("license_type=eq.exclusive"));
  assert.ok(read, "asks the table");
  assert.equal(read.init.headers.Authorization, "Bearer jwt-abc-0123456789", "the user's bearer, not anonymous");
  assert.equal(read.init.headers.apikey, ANON);
});

test("the exclusive lookup stays an anonymous read when signed out", async () => {
  const calls = [];
  const { backend } = boot(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => "[]" };
  }, null);

  const sold = await backend.licenses.soldExclusive();

  assert.equal(sold.length, 0, "the local record alone answers");
  const read = calls.find((call) => call.url.includes("license_type=eq.exclusive"));
  assert.ok(read, "still makes the request a public SELECT policy would serve");
  assert.equal(read.init.headers.Authorization, undefined, "no token to send, so no bearer");
});

test("a stale cached user is reconciled with the token before reading", async () => {
  const token = jwt({ sub: "user-from-token" });
  const calls = [];
  const { backend, storage } = boot(async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/auth/v1/user")) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          id: "user-from-token", email: "real@example.com", user_metadata: { username: "matan" }
        })
      };
    }
    return { ok: true, status: 200, text: async () => "[]" };
  }, {
    accessToken: token,
    user: { id: "user-stale-uuid", email: "stale@example.com" }
  });

  await backend.licenses.list();

  assert.equal(backend.auth.currentUser().id, "user-from-token", "the session follows the token");
  assert.equal(backend.auth.currentUser().email, "real@example.com");
  const whoami = calls.find((call) => call.url.includes("/auth/v1/user"));
  assert.ok(whoami, "re-reads the user this token belongs to");
  assert.equal(whoami.init.headers.Authorization, "Bearer " + token);
  assert.equal(
    storage.get("kyrolll_library_user-from-token"), "[]",
    "the library cache is keyed by the token's id"
  );
  assert.equal(
    storage.get("kyrolll_library_user-stale-uuid"), undefined,
    "nothing is read or written under the stale id"
  );
});

test("a stale cached user is reconciled before a cached purchase too", async () => {
  const token = jwt({ sub: "user-from-token" });
  const calls = [];
  const { backend, storage } = boot(async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/auth/v1/user")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: "user-from-token" }) };
    }
    return { ok: true, status: 201, text: async () => JSON.stringify([{ id: "row-9" }]) };
  }, {
    accessToken: token,
    user: { id: "user-stale-uuid", email: "stale@example.com" }
  });

  await backend.licenses.add({
    beatId: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af", beatTitle: "FLESH", tierId: "wav", tier: "STANDARD WAV LEASE", price: "$14.95"
  });

  assert.equal(
    calls.filter((call) => call.init && call.init.method === "POST").length, 0,
    "the browser never writes a license row — only the webhook may"
  );
  const cached = JSON.parse(storage.get("kyrolll_library_user-from-token"));
  assert.equal(cached[0].tierId, "wav", "the cache follows the token's identity");
  assert.equal(
    storage.get("kyrolll_library_user-stale-uuid"), undefined,
    "nothing is cached under the stale id"
  );
});

/* ------------------------------------------------------------------ refresh */

/* GoTrue rotates the refresh token on every use. A page load reaches expiry in
 * several places at once — the bootstrap `ready()`, `licenses.list()` and
 * `soldExclusive()` — and each used to fire its own `/token` call, so the second
 * one always came back `refresh_token_already_used` (400) and the old code
 * deleted the session over it. These tests pin the fix: one refresh per burst,
 * a reused token never wipes the record, and a dead token is never replayed. */

function tokenReply(data) {
  return { ok: true, status: 200, text: async () => JSON.stringify(data) };
}

function alreadyUsedReply() {
  return {
    ok: false,
    status: 400,
    text: async () => JSON.stringify({
      code: 400,
      error_code: "refresh_token_already_used",
      msg: "Invalid Refresh Token: Already Used"
    })
  };
}

test("concurrent reads share a single refresh, so the rotating token is spent once", async () => {
  const clock = makeClock(Date.now());
  const calls = [];
  const tokenCalls = [];
  let issued = 0;
  const { backend, storage } = boot(async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      tokenCalls.push(JSON.parse(init.body).refresh_token);
      // Hold the first refresh open so the other callers must join it, not race it.
      await new Promise((resolve) => setTimeout(resolve, 5));
      issued += 1;
      return tokenReply({
        access_token: "jwt-fresh-" + issued,
        refresh_token: "refresh-" + issued,
        expires_in: 3600,
        user: USER
      });
    }
    return { ok: true, status: 200, text: async () => "[]" };
  }, { expiresAt: clock.get() + 30000 }, clock);

  // Three entry points hitting expiry at the same moment, exactly like a load.
  await Promise.all([
    backend.licenses.list(),
    backend.licenses.soldExclusive(),
    backend.auth.ready()
  ]);

  assert.equal(tokenCalls.length, 1, "one refresh, not one per caller");
  assert.deepEqual(tokenCalls, ["refresh-abc"], "the stored refresh token is spent exactly once");
  assert.equal(
    JSON.parse(storage.get("kyrolll_sb_session")).refreshToken, "refresh-1",
    "the rotated token is persisted for the next load"
  );
  const reads = calls.filter((call) => /\/rest\/v1\/licenses\?/.test(call.url));
  assert.ok(reads.length >= 2, "both the library and the sold lookup went out");
  reads.forEach((read) => {
    assert.equal(read.init.headers.Authorization, "Bearer jwt-fresh-1", "every read uses the refreshed token");
  });
});

test("a reused refresh token keeps the session and reports it as expired", async () => {
  const clock = makeClock(Date.now());
  const { backend, storage } = boot(async (url) => {
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) return alreadyUsedReply();
    return { ok: true, status: 200, text: async () => "[]" };
  }, { expiresAt: clock.get() + 30000 }, clock);

  assert.ok(storage.get("kyrolll_sb_session"), "starts with a stored session");

  const items = await backend.licenses.list();

  assert.equal(items.length, 0, "a dead session still answers with the cached library, no throw");
  assert.ok(storage.get("kyrolll_sb_session"), "the session record is NOT wiped");
  assert.equal(backend.licenses.diagnose().sessionExpired, true, "the page is told to ask for a sign-in");
  assert.equal(backend.auth.sessionExpired(), true);
  assert.ok(backend.auth.currentUser(), "the kept record still names the visitor");
});

test("a dead refresh token is never replayed on later reads", async () => {
  const clock = makeClock(Date.now());
  let tokenCalls = 0;
  const { backend } = boot(async (url) => {
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      tokenCalls += 1;
      return alreadyUsedReply();
    }
    return { ok: true, status: 200, text: async () => "[]" };
  }, { expiresAt: clock.get() + 30000 }, clock);

  await backend.licenses.list();
  await backend.auth.ready();
  await backend.licenses.soldExclusive();
  await backend.licenses.list();

  assert.equal(tokenCalls, 1, "the spent token is not offered again");
  assert.equal(backend.auth.sessionExpired(), true);
});

test("a live session written by another tab revives an expired one", async () => {
  const clock = makeClock(Date.now());
  const calls = [];
  const { backend, storage } = boot(async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) return alreadyUsedReply();
    return { ok: true, status: 200, text: async () => "[]" };
  }, { expiresAt: clock.get() + 30000 }, clock);

  await backend.licenses.list();
  assert.equal(backend.auth.sessionExpired(), true, "the spent token marks the session expired");

  // Another tab signs in (or refreshes) and writes a live session under the
  // shared key; this tab only sees it through localStorage on the next read.
  calls.length = 0;
  storage.setItem("kyrolll_sb_session", JSON.stringify({
    accessToken: "jwt-other-tab",
    refreshToken: "refresh-other",
    expiresAt: clock.get() + 3600000,
    user: USER
  }));

  const items = await backend.licenses.list();

  assert.equal(backend.auth.sessionExpired(), false, "the replacement clears the expired verdict");
  assert.equal(items.length, 0, "the read still answers");
  const read = calls.find((call) => /\/rest\/v1\/licenses\?/.test(call.url));
  assert.ok(read, "reads the table again");
  assert.equal(read.init.headers.Authorization, "Bearer jwt-other-tab", "with the other tab's live token");
});

/* The stored session has one shape — the key `kyrolll_sb_session` (three L's:
 * k-y-r-o-l-l-l) holding camelCase `accessToken` / `refreshToken` / `expiresAt`.
 * This round-trips it through the real write path ("sign in") and then a fresh
 * module over the same bytes ("next page load"), so a rename of the key or a
 * switch to the snake_case Supabase field names cannot slip through unnoticed. */
test("a signed-in session round-trips through one key and camelCase fields", async () => {
  const token = jwt({ sub: USER.id, email: USER.email });
  const verifyReply = {
    ok: true, status: 200,
    text: async () => JSON.stringify({
      access_token: token,
      refresh_token: "refresh-roundtrip",
      expires_in: 3600,
      user: { id: USER.id, email: USER.email, created_at: "2026-10-01T00:00:00Z" }
    })
  };
  const { backend, storage } = boot(async (url) => {
    assert.match(url, /\/auth\/v1\/verify$/, "the OTP exchange is the only write path here");
    return verifyReply;
  }, null);

  await backend.auth.verifyOtp({ email: USER.email, token: "123456" });

  const raw = storage.get("kyrolll_sb_session");
  assert.ok(raw, "signing in writes the one shared session key");

  const stored = JSON.parse(raw);
  assert.equal(stored.accessToken, token, "stores the bearer as camelCase `accessToken`");
  assert.equal(stored.refreshToken, "refresh-roundtrip", "stores the refresh token as camelCase `refreshToken`");
  assert.equal(typeof stored.expiresAt, "number", "stores `expiresAt` as a number");
  assert.equal(stored.access_token, undefined, "never writes snake_case `access_token`");
  assert.equal(stored.refresh_token, undefined, "never writes snake_case `refresh_token`");
  assert.equal(stored.user.id, USER.id, "keeps the signed-in identity under `user`");

  // Read it back the way the next page load does: a fresh module over the same
  // bytes must see the visitor as signed in and read with that bearer.
  const reads = [];
  const next = boot(async (url, init) => {
    reads.push({ url, init });
    return { ok: true, status: 200, text: async () => "[]" };
  }, stored);

  assert.equal(next.backend.auth.currentUser().id, USER.id, "a fresh load resolves the stored session");
  await next.backend.licenses.list();
  const read = reads.find((call) => /\/rest\/v1\/licenses\?/.test(call.url));
  assert.ok(read, "the session is usable without a re-login");
  assert.equal(read.init.headers.Authorization, "Bearer " + token, "reads with the stored bearer");
});

