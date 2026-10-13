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
    accessToken: "jwt-abc",
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
        { id: "row-1", beat_id: "flesh", beat_title: "FLESH", tier_id: "mp3", tier: "MP3 LEASE", price: "$9.95", purchased_at: "2026-10-01T00:00:00Z" }
      ])
    };
  });

  const items = await backend.licenses.list();

  assert.equal(calls.length, 1, "one read, no unexpected request");
  assert.equal(
    calls[0].url,
    SERVER + "/rest/v1/licenses?select=*&user_id=eq.user-123&order=purchased_at.desc",
    "filters explicitly by the signed-in user"
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer jwt-abc");
  assert.equal(calls[0].init.headers.apikey, ANON);
  assert.equal(items.length, 1);
  assert.equal(items[0].tierId, "mp3");
  assert.equal(items[0].beatId, "flesh");

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

test("a write lets the table own the id and adopts the server's", async () => {
  const calls = [];
  const { backend, storage } = boot(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 201, text: async () => JSON.stringify([{ id: "server-uuid" }]) };
  });

  const license = await backend.licenses.add({
    beatId: "flesh", beatTitle: "FLESH", tierId: "wav", tier: "STANDARD WAV LEASE", price: "$14.95"
  });

  const post = calls.find((call) => call.init.method === "POST");
  assert.ok(post, "posts the purchase");
  assert.match(post.url, /\/rest\/v1\/licenses$/);
  const body = JSON.parse(post.init.body);
  assert.ok(!("id" in body), "omits id so a uuid column accepts the row");
  assert.equal(body.user_id, "user-123");
  assert.equal(body.beat_id, "flesh");
  assert.equal(body.tier_id, "wav");

  assert.equal(license.id, "server-uuid", "adopts the server id so the next read de-dupes");
  const cached = JSON.parse(storage.get("kyrolll_library_user-123"));
  assert.equal(cached[0].id, "server-uuid");
});

test("a write that fails keeps the local copy and explains itself", async () => {
  const warn = captureWarn();
  const { backend } = boot(async () => ({
    ok: false, status: 400,
    text: async () => JSON.stringify({ message: 'invalid input syntax for type uuid: "lic_x"' })
  }));

  const license = await backend.licenses.add({
    beatId: "flesh", beatTitle: "FLESH", tierId: "mp3", tier: "MP3 LEASE", price: "$9.95"
  });
  warn.restore();

  assert.ok(license && license.id, "the optimistic local copy survives");
  assert.ok(warn.lines.some((line) => /license write failed/.test(line)));
});

test("refreshes a token that is about to expire before reading", async () => {
  const clock = makeClock(Date.now());
  const calls = [];
  const { backend } = boot(async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ access_token: "jwt-fresh", refresh_token: "refresh-2", expires_in: 3600, user: USER })
      };
    }
    return { ok: true, status: 200, text: async () => "[]" };
  }, { expiresAt: clock.get() + 120000 }, clock);

  assert.equal(calls.length, 0, "a valid token is not refreshed at load");

  clock.set(clock.get() + 90000); // now inside the refresh window
  await backend.licenses.list();

  const read = calls[calls.length - 1];
  assert.match(read.url, /\/rest\/v1\/licenses\?/);
  assert.equal(read.init.headers.Authorization, "Bearer jwt-fresh", "reads with the refreshed token");
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
        text: async () => JSON.stringify({ access_token: "jwt-fresh", refresh_token: "refresh-2", expires_in: 3600, user: USER })
      };
    }
    reads += 1;
    if (reads === 1) {
      return { ok: false, status: 401, text: async () => JSON.stringify({ message: "JWT expired" }) };
    }
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify([
        { id: "row-1", beat_id: "flesh", tier_id: "mp3", purchased_at: "2026-10-01T00:00:00Z" }
      ])
    };
  });

  const items = await backend.licenses.list();

  assert.equal(items.length, 1, "the retry succeeds");
  assert.equal(backend.licenses.diagnose().error, null, "a successful retry clears the error");
  const attempts = calls.filter((call) => /\/rest\/v1\/licenses\?/.test(call.url));
  assert.equal(attempts.length, 2, "one 401, then one retry");
  assert.equal(attempts[0].init.headers.Authorization, "Bearer jwt-abc");
  assert.equal(attempts[1].init.headers.Authorization, "Bearer jwt-fresh");
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

