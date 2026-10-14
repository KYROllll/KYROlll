/* Tests for kyrolll-backend.js — the database-free client: the public
 * create-payment invoice call. There is no session and no table read to reason
 * about any more, so there is no auth or license-lookup path to test. The
 * module is a browser IIFE, so each test runs it in a fresh vm context with
 * window/localStorage/fetch shims. No network. */
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
const BEAT = "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af";

function memoryStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    get: (key) => map.get(key)
  };
}

// Run a fresh copy of the IIFE in its own context. `options.config === null`
// boots with no project attached (local-demo mode); `options.storage` seeds
// localStorage (e.g. the local sold-exclusive record).
function boot(fetchImpl, options) {
  const opts = options || {};
  const config = opts.config === null
    ? {}
    : Object.assign({ url: SERVER, anonKey: ANON }, opts.config || {});
  const storage = memoryStorage(opts.storage || {});
  const win = {
    KYROlll_SUPABASE: config,
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

const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const readCalls = (calls, needle) => calls.filter((call) => call.url.includes(needle));

test("is configured from supabase-config and exposes only the payments API", () => {
  const { backend } = boot(async () => ok([]));
  assert.equal(backend.configured, true);
  assert.equal(backend.mode, "supabase", "a filled project switches the store to Supabase mode");
  assert.equal(typeof backend.payments.createInvoice, "function");
  assert.equal(backend.licenses, undefined, "the browser never reads a Supabase table");
  assert.equal(backend.auth, undefined, "no auth namespace survives the account-less rewrite");
  assert.equal(backend.storage, undefined, "no storage namespace — files are emailed, not downloaded");
});

test("an unconfigured project stays in local mode and makes no request", async () => {
  let called = 0;
  const { backend } = boot(async () => { called += 1; return ok([]); }, { config: null });
  assert.equal(backend.configured, false);
  assert.equal(backend.mode, "local");

  await assert.rejects(
    () => backend.payments.createInvoice({ beatId: BEAT, licenseType: "mp3" }),
    /SUPABASE NOT CONFIGURED/
  );
  assert.equal(called, 0, "nothing leaves the browser");
});

test("createInvoice posts the selection, with no bearer", async () => {
  const calls = [];
  const { backend } = boot(async (url, init) => {
    calls.push({ url, init });
    return ok({ url: "https://nowpayments.io/payment/?iid=1" });
  });

  const invoice = await backend.payments.createInvoice({ beatId: BEAT, licenseType: "mp3" });

  assert.equal(invoice.url, "https://nowpayments.io/payment/?iid=1", "returns the hosted invoice URL");
  const post = readCalls(calls, "/functions/v1/create-payment")[0];
  assert.ok(post, "calls the function");
  assert.equal(post.init.method, "POST");
  assert.equal(post.init.headers.apikey, ANON);
  assert.equal(post.init.headers.Authorization, undefined, "the storefront is public — no token");
  assert.deepEqual(JSON.parse(post.init.body), { beat_id: BEAT, license_type: "mp3" },
    "no email key when the buyer skipped the step");
});

test("createInvoice carries the optional email when the buyer gave one", async () => {
  const calls = [];
  const { backend } = boot(async (url, init) => { calls.push({ url, init }); return ok({ url: "https://x" }); });

  await backend.payments.createInvoice({ beatId: BEAT, licenseType: "wav", email: "buyer@example.com" });

  const post = readCalls(calls, "/functions/v1/create-payment")[0];
  assert.deepEqual(JSON.parse(post.init.body), {
    beat_id: BEAT,
    license_type: "wav",
    email: "buyer@example.com"
  });
});

test("createInvoice rejects a missing selection without a request", async () => {
  let called = 0;
  const { backend } = boot(async () => { called += 1; return ok([]); });

  await assert.rejects(() => backend.payments.createInvoice({ licenseType: "mp3" }), /MISSING LICENSE SELECTION/);
  await assert.rejects(() => backend.payments.createInvoice({ beatId: BEAT }), /MISSING LICENSE SELECTION/);
  assert.equal(called, 0, "nothing is sent when the selection is incomplete");
});

test("a dropped connection surfaces as status 0 / network", async () => {
  const { backend } = boot(async () => { throw new TypeError("Failed to fetch"); });

  await assert.rejects(
    () => backend.payments.createInvoice({ beatId: BEAT, licenseType: "mp3" }),
    (err) => {
      assert.equal(err.status, 0);
      assert.equal(err.network, true);
      assert.match(err.message, /Network\/CORS/);
      return true;
    }
  );
});

test("an HTTP error keeps its status and body", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const { backend } = boot(async () => ({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: "COULD NOT CREATE INVOICE" })
    }));

    await assert.rejects(
      () => backend.payments.createInvoice({ beatId: BEAT, licenseType: "mp3" }),
      (err) => {
        assert.equal(err.status, 502);
        assert.match(String(err.body), /COULD NOT CREATE INVOICE/);
        return true;
      }
    );
  } finally {
    console.error = original;
  }
});
