import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import worker from "./src/index.js";

function setup() {
  const store = new Map();
  const mails = [];
  const payments = [];
  const tasks = [];
  const env = {
    BEAT_CATALOG: JSON.stringify({
      beat1: { title: "BEAT 01" }, beat2: { title: "BEAT 02" },
      beat3: { title: "BEAT 03" }, "s2-beat7": { title: "BEAT 14" }
    }),
    ORDERS: {
      get: async (key) => store.get(key) ?? null,
      put: async (key, value) => { store.set(key, value); },
      delete: async (key) => { store.delete(key); }
    },
    BEAT_LINKS: JSON.stringify({
      beat1: { mp3: "https://files.example/beat1.mp3", wav: "https://files.example/beat1.wav" },
      beat2: { mp3: "https://files.example/beat2.mp3", wav: "https://files.example/beat2.wav" },
      beat3: { mp3: "https://files.example/beat3.mp3", wav: "https://files.example/beat3.wav" },
      "s2-beat7": { mp3: "https://files.example/beat14.mp3", wav: "https://files.example/beat14.wav" }
    }),
    NOWPAYMENTS_API_KEY: "test",
    NOWPAYMENTS_IPN_SECRET: "secret",
    RESEND_API_KEY: "test",
    EMAIL_MAX_ATTEMPTS: "1"
  };
  const ctx = { waitUntil: (task) => tasks.push(task) };
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith("/payment")) {
      payments.push(JSON.parse(options.body));
      return Response.json({ payment_id: payments.length, pay_amount: 9, pay_address: "wallet", pay_currency: "usdtsol", payment_status: "waiting" });
    }
    if (String(url).includes("resend.com/emails")) {
      mails.push(JSON.parse(options.body));
      return Response.json({ id: "sent" });
    }
    if (String(url).includes("kyrolll-flower.jpg")) return new Response(null, { status: 404 });
    throw new Error("Unexpected fetch " + url);
  };
  const api = async (path, method = "GET", body, headers = {}) => {
    const res = await worker.fetch(new Request("https://worker.example" + path, {
      method, body: body && JSON.stringify(body), headers
    }), env, ctx);
    return { status: res.status, data: await res.json() };
  };
  return { env, api, mails, payments, tasks, restore: () => { globalThis.fetch = fetchOriginal; } };
}

test("continuous catalog and all three tiers fulfill only their purchased formats", async () => {
  const { api, payments, mails, tasks, restore } = setup();
  try {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const script = readFileSync(new URL("../script.js", import.meta.url), "utf8");
    const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
    assert.doesNotMatch(html + script + css, /season|countdown|drops soon/i);
    assert.match(script, /const CATALOG = \[\];/);
    assert.match(script, /MP3_PRICE = 9\.95/);
    assert.match(script, /selected\.set\(id, type\)/);
    assert.match(css, /translateX\(-50%\)/);
    assert.match(script, /TICKER_TEXT\.repeat\(3\)/);
    assert.match(html, /class="ticker__track">\s*<span><\/span><span aria-hidden="true"><\/span>/);
    assert.match(html, /<h1[^>]+id="brand-title">KYROlll/);
    assert.doesNotMatch(html + script + css, /signature-video|sigVideo|signature-final-frame/);

    const checkout = {
      email: "buyer@example.com", coinSym: "USDT", total: 324.85,
      items: [
        { id: "beat1", type: "mp3" },
        { id: "beat2", type: "wav" },
        { id: "beat3", type: "mp3" },
        { id: "s2-beat7", type: "exclusive" }
      ], freePicks: ["beat3"]
    };
    const badTotal = await api("/api/checkout", "POST", { ...checkout, total: 1 });
    assert.equal(badTotal.status, 400);
    const badFreePick = await api("/api/checkout", "POST", { ...checkout, freePicks: ["s2-beat7"] });
    assert.equal(badFreePick.status, 400);
    const order = await api("/api/checkout", "POST", checkout);
    assert.equal(order.status, 200, JSON.stringify(order.data));
    assert.equal(payments[0].price_amount, 324.85);
    assert.doesNotMatch(payments[0].order_description, /season/i);
    const before = await api("/api/status?order_id=" + order.data.order_id);
    assert.equal(before.data.released, false);
    assert.equal(before.data.links, undefined);

    const payload = { order_id: order.data.order_id, payment_status: "finished", payment_id: order.data.payment_id };
    const signature = createHmac("sha512", "secret")
      .update(Object.keys(payload).sort().map((key) => String(payload[key])).join("|"))
      .digest("hex");
    const ipn = await api("/api/ipn", "POST", payload, { "x-nowpayments-sig": signature });
    assert.equal(ipn.data.released, true);
    await Promise.all(tasks);
    const after = await api("/api/status?order_id=" + order.data.order_id);
    assert.deepEqual(after.data.links.map((item) => item.tier), ["mp3", "wav", "mp3", "exclusive"]);
    assert.deepEqual(after.data.links.map((item) => item.url), [
      "https://files.example/beat1.mp3", "https://files.example/beat2.wav",
      "https://files.example/beat3.mp3", "https://files.example/beat14.wav"
    ]);
    assert.deepEqual(after.data.licenses.map((item) => item.tier), ["mp3", "wav", "exclusive"]);
    const sold = await api("/api/catalog");
    assert.deepEqual(sold.data.sold, ["s2-beat7"]);
    const soldAttempt = await api("/api/checkout", "POST", {
      email: "buyer@example.com", coinSym: "USDT", total: 9.95,
      items: [{ id: "s2-beat7", type: "mp3" }]
    });
    assert.equal(soldAttempt.status, 409);
    assert.equal(mails.length, 1);
    assert.match(mails[0].from, /^KYROlll </);
    assert.match(mails[0].subject, /^KYROlll —/);
    assert.match(mails[0].text, /^KYROlll —/);
    assert.match(mails[0].html, /kyrolll-flower\.jpg/);
    assert.match(mails[0].html, /kyrolll-email-doodles\.png/);
    assert.doesNotMatch(mails[0].html + mails[0].text, /Ken Carter|KEN CARTER/);
    assert.match(payments[0].order_description, /^KYROlll -/);
    assert.match(mails[0].html, /DOWNLOAD BEAT 01 — MP3/);
    assert.match(mails[0].html, /DOWNLOAD BEAT 02 — WAV/);
    assert.match(mails[0].html, /EXCLUSIVE MASTER RIGHTS/);
    assert.deepEqual(mails[0].attachments.map((item) => item.filename), [
      "MP3_LICENSE.pdf", "MP3_LICENSE.txt", "LICENSE.pdf", "LICENSE.txt", "EXCLUSIVE_LICENSE.pdf", "EXCLUSIVE_LICENSE.txt"
    ]);
    assert.equal(Buffer.from(mails[0].attachments[1].content, "base64").toString("utf8").trim(),
      readFileSync(new URL("../MP3_LICENSE.txt", import.meta.url), "utf8").trim());
    for (const [index, file] of [[3, "LICENSE.txt"], [5, "EXCLUSIVE_LICENSE.txt"]]) {
      assert.equal(Buffer.from(mails[0].attachments[index].content, "base64").toString("utf8").trim(),
        readFileSync(new URL("../" + file, import.meta.url), "utf8").trim());
    }
  } finally { restore(); }
});

test("missing MP3 file rejects checkout rather than delivering WAV to MP3 buyer", async () => {
  const { api, env, restore } = setup();
  try {
    env.BEAT_LINKS = JSON.stringify({ beat1: "https://files.example/beat1.wav" });
    const result = await api("/api/checkout", "POST", {
      email: "buyer@example.com", coinSym: "USDT", total: 9.95,
      items: [{ id: "beat1", type: "mp3" }]
    });
    assert.equal(result.status, 503);
    assert.match(result.data.error, /NOT YET AVAILABLE/);
  } finally { restore(); }
});

test("empty catalog rejects old beat IDs even when stale file links remain", async () => {
  const { api, env, payments, restore } = setup();
  try {
    delete env.BEAT_CATALOG;
    assert.deepEqual((await api("/api/catalog")).data, { sold: [] });
    const result = await api("/api/checkout", "POST", {
      email: "buyer@example.com", coinSym: "USDT", total: 9.95,
      items: [{ id: "beat1", type: "mp3" }]
    });
    assert.equal(result.status, 400);
    assert.equal(payments.length, 0);
  } finally { restore(); }
});
