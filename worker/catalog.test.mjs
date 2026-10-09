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
    if (String(url).includes("kyrolll-social.jpg")) return new Response(null, { status: 404 });
    throw new Error("Unexpected fetch " + url);
  };
  const api = async (path, method = "GET", body, headers = {}) => {
    const res = await worker.fetch(new Request("https://worker.example" + path, {
      method, body: body && JSON.stringify(body), headers
    }), env, ctx);
    return { status: res.status, data: await res.json() };
  };
  const download = (path) => worker.fetch(new Request("https://worker.example" + path), env, ctx);
  return { env, api, download, mails, payments, tasks, restore: () => { globalThis.fetch = fetchOriginal; } };
}

test("continuous catalog and all three tiers fulfill only their purchased formats", async () => {
  const { api, payments, mails, tasks, restore } = setup();
  try {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const script = readFileSync(new URL("../script.js", import.meta.url), "utf8");
    const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
    assert.doesNotMatch(html + script + css, /season|countdown|drops soon/i);
    assert.match(script, /id: "flesh"/);
    assert.match(script, /MP3_PRICE = 9\.95/);
    assert.match(script, /selected\.set\(id, type\)/);
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
    assert.match(mails[0].html, /kyrolll-metal\.png/);
    assert.match(mails[0].html, /kyrolll-email-doodles\.png/);
    assert.doesNotMatch(mails[0].html + mails[0].text, /Ken Carter|KEN CARTER/);
    assert.match(payments[0].order_description, /^KYROlll -/);
    assert.match(mails[0].html, /DOWNLOAD BEAT 01 — MP3/);
    assert.match(mails[0].html, /\?beat=beat1/);
    assert.match(mails[0].text, /\?beat=beat2/);
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

test("single-tier orders unlock and email only their purchased format", async () => {
  for (const tier of ["mp3", "wav"]) {
    const { api, mails, tasks, restore } = setup();
    try {
      const order = await api("/api/checkout", "POST", {
        email: "buyer@example.com", coinSym: "USDT", total: tier === "mp3" ? 9.95 : 14.95,
        items: [{ id: "beat1", type: tier }]
      });
      assert.equal(order.status, 200);
      assert.equal((await api("/api/status?order_id=" + order.data.order_id)).data.links, undefined);
      const payload = { order_id: order.data.order_id, payment_status: "finished", payment_id: order.data.payment_id };
      const signature = createHmac("sha512", "secret")
        .update(Object.keys(payload).sort().map((key) => String(payload[key])).join("|"))
        .digest("hex");
      assert.equal((await api("/api/ipn", "POST", payload, { "x-nowpayments-sig": signature })).data.released, true);
      await Promise.all(tasks);
      const after = await api("/api/status?order_id=" + order.data.order_id);
      assert.deepEqual(after.data.links.map(({ tier: deliveredTier, url }) => ({ tier: deliveredTier, url })),
        [{ tier, url: `https://files.example/beat1.${tier}` }]);
      assert.equal(mails.length, 1);
      assert.match(mails[0].text, new RegExp(`https://files\\.example/beat1\\.${tier}`));
      assert.doesNotMatch(mails[0].text + mails[0].html, new RegExp(`https://files\\.example/beat1\\.${tier === "mp3" ? "wav" : "mp3"}`));
    } finally { restore(); }
  }
});

test("2+1 discount requires three distinct non-exclusive leases", async () => {
  const { api, payments, restore } = setup();
  try {
    const items = [{ id: "beat1", type: "mp3" }, { id: "beat2", type: "wav" }];
    const tooSoon = await api("/api/checkout", "POST", {
      email: "buyer@example.com", coinSym: "USDT", total: 14.95,
      items, freePicks: ["beat1"]
    });
    assert.equal(tooSoon.status, 400);
    const exclusiveIsNotThird = await api("/api/checkout", "POST", {
      email: "buyer@example.com", coinSym: "USDT", total: 314.90,
      items: [...items, { id: "beat3", type: "exclusive" }], freePicks: ["beat1"]
    });
    assert.equal(exclusiveIsNotThird.status, 400);
    assert.equal(payments.length, 0);
    const qualified = await api("/api/checkout", "POST", {
      email: "buyer@example.com", coinSym: "USDT", total: 24.90,
      items: [...items, { id: "beat3", type: "mp3" }], freePicks: ["beat3"]
    });
    assert.equal(qualified.status, 200);
    assert.equal(payments[0].price_amount, 24.90);
  } finally { restore(); }
});

test("a WAV lease never receives an exclusive-only file", async () => {
  const { api, env, payments, restore } = setup();
  try {
    env.BEAT_LINKS = JSON.stringify({ beat1: { exclusive: "https://files.example/exclusive.wav" } });
    const wav = await api("/api/checkout", "POST", {
      email: "buyer@example.com", coinSym: "USDT", total: 14.95,
      items: [{ id: "beat1", type: "wav" }]
    });
    assert.equal(wav.status, 503);
    assert.equal(payments.length, 0);
    const exclusive = await api("/api/checkout", "POST", {
      email: "buyer@example.com", coinSym: "USDT", total: 299.95,
      items: [{ id: "beat1", type: "exclusive" }]
    });
    assert.equal(exclusive.status, 200);
  } finally { restore(); }
});

test("FLESH delivers the MP3 or WAV selected by its buyer, never both", async () => {
  const { api, download, env, payments, tasks, mails, restore } = setup();
  try {
    delete env.BEAT_CATALOG;
    env.FLESH_WAV_URL = "https://files.example/flesh.wav";
    assert.deepEqual((await api("/api/catalog")).data, { sold: [] });
    const mp3 = await api("/api/checkout", "POST", {
      email: "buyer@example.com", coinSym: "USDT", total: 9.95,
      items: [{ id: "flesh", type: "mp3" }]
    });
    assert.equal(mp3.status, 503, "no buyer MP3 URL means no MP3 charge");
    env.FLESH_MP3_URL = "https://files.example/flesh.mp3";
    const mp3Order = await api("/api/checkout", "POST", {
      email: "buyer@example.com", coinSym: "USDT", total: 9.95,
      items: [{ id: "flesh", type: "mp3" }]
    });
    assert.equal(mp3Order.status, 200);
    const order = await api("/api/checkout", "POST", {
      email: "buyer@example.com", coinSym: "USDT", total: 14.95,
      items: [{ id: "flesh", type: "wav" }]
    });
    assert.equal(order.status, 200);
    assert.equal(payments[0].order_description, 'KYROlll - Don Toliver type beat - "FLESH" MP3');
    assert.equal(payments[1].order_description, 'KYROlll - Don Toliver type beat - "FLESH" WAV');
    assert.equal((await api("/api/status?order_id=" + mp3Order.data.order_id)).data.links, undefined);
    assert.equal((await api("/api/status?order_id=" + order.data.order_id)).data.links, undefined);
    for (const purchase of [mp3Order, order]) {
      const payload = { order_id: purchase.data.order_id, payment_status: "finished", payment_id: purchase.data.payment_id };
      const signature = createHmac("sha512", "secret")
        .update(Object.keys(payload).sort().map((key) => String(payload[key])).join("|"))
        .digest("hex");
      assert.equal((await api("/api/ipn", "POST", payload, { "x-nowpayments-sig": signature })).data.released, true);
    }
    await Promise.all(tasks);
    const afterMp3 = await api("/api/status?order_id=" + mp3Order.data.order_id);
    assert.deepEqual(afterMp3.data.links.map(({ tier, url }) => ({ tier, url })), [{ tier: "mp3", url: env.FLESH_MP3_URL }]);
    const after = await api("/api/status?order_id=" + order.data.order_id);
    assert.deepEqual(after.data.links.map(({ tier, url }) => ({ tier, url })), [{ tier: "wav", url: env.FLESH_WAV_URL }]);
    assert.equal((await download("/api/exclusive-license?order_id=" + order.data.order_id)).status, 404);
    assert.equal(mails.length, 2);
    assert.match(mails[0].text, /https:\/\/files\.example\/flesh\.mp3/);
    assert.doesNotMatch(mails[0].text + mails[0].html, /https:\/\/files\.example\/flesh\.wav/);
    assert.match(mails[1].text, /https:\/\/files\.example\/flesh\.wav/);
    assert.doesNotMatch(mails[1].text + mails[1].html, /https:\/\/files\.example\/flesh\.mp3/);
  } finally { restore(); }
});

test("FLESH exclusive purchase delivers its MP3+WAV folder and matching personalized license", async () => {
  const { api, download, env, mails, tasks, payments, restore } = setup();
  try {
    env.FLESH_MP3_URL = "https://files.example/flesh.mp3";
    env.FLESH_WAV_URL = "https://files.example/flesh.wav";
    const checkout = { email: "buyer@example.com", coinSym: "USDT", total: 299.95, items: [{ id: "flesh", type: "exclusive" }] };
    assert.equal((await api("/api/checkout", "POST", checkout)).status, 503, "never charge for an exclusive WAV-only delivery");
    assert.equal(payments.length, 0);
    env.FLESH_EXCLUSIVE_URL = "https://drive.google.com/drive/folders/exclusive-test";
    const order = await api("/api/checkout", "POST", checkout);
    assert.equal(order.status, 200);
    const statusUrl = "/api/status?order_id=" + order.data.order_id;
    const pdfUrl = "/api/exclusive-license?order_id=" + order.data.order_id;
    assert.equal((await api(statusUrl)).data.links, undefined);
    assert.equal((await download(pdfUrl)).status, 403);
    assert.equal(mails.length, 0);

    const payload = { order_id: order.data.order_id, payment_status: "finished", payment_id: order.data.payment_id };
    const signature = createHmac("sha512", "secret")
      .update(Object.keys(payload).sort().map((key) => String(payload[key])).join("|"))
      .digest("hex");
    assert.equal((await api("/api/ipn", "POST", payload, { "x-nowpayments-sig": signature })).data.released, true);
    await Promise.all(tasks);
    const after = await api(statusUrl);
    assert.deepEqual(after.data.links.map(({ tier, url }) => ({ tier, url })), [{ tier: "exclusive", url: env.FLESH_EXCLUSIVE_URL }]);
    assert.deepEqual(after.data.licenses.map(({ tier, filename }) => ({ tier, filename })), [{ tier: "exclusive", filename: "EXCLUSIVE_LICENSE.pdf" }]);
    assert.equal(mails.length, 1);
    assert.match(mails[0].html, /EXCLUSIVE MP3 \+ WAV FOLDER/);
    assert.match(mails[0].text, /EXCLUSIVE MP3 \+ WAV FOLDER/);
    assert.match(mails[0].text, /\?beat=flesh/);
    assert(mails[0].html.includes(env.FLESH_EXCLUSIVE_URL) && mails[0].text.includes(env.FLESH_EXCLUSIVE_URL));
    assert(!mails[0].html.includes(env.FLESH_WAV_URL) && !mails[0].text.includes(env.FLESH_MP3_URL));
    assert.deepEqual(mails[0].attachments.map((file) => file.filename), ["EXCLUSIVE_LICENSE.pdf", "EXCLUSIVE_LICENSE.txt"]);
    assert.equal(Buffer.from(mails[0].attachments[1].content, "base64").toString("utf8").trim(),
      readFileSync(new URL("../EXCLUSIVE_LICENSE.txt", import.meta.url), "utf8").trim());
    const attachedPdf = Buffer.from(mails[0].attachments[0].content, "base64").toString("latin1");
    assert.match(attachedPdf.slice(0, 8), /^%PDF-/);
    assert(attachedPdf.includes("buyer@example.com") && attachedPdf.includes("FLESH"), "exclusive PDF identifies the purchaser and beat");
    const pdf = await download(pdfUrl);
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get("Content-Disposition"), /EXCLUSIVE_LICENSE\.pdf/);
    assert.match(Buffer.from(await pdf.arrayBuffer()).toString("latin1", 0, 8), /^%PDF-/);
    assert.deepEqual((await api("/api/catalog")).data.sold, ["flesh"]);
  } finally { restore(); }
});

test("unknown beat IDs are rejected even when stale file links remain", async () => {
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

test("100% off promo code KYROTEST sets total to $0 and successfully dispatches email and links including exclusive drive folder", async () => {
  const { api, env, mails, tasks, payments, restore } = setup();
  try {
    env.FLESH_MP3_URL = "https://files.example/flesh.mp3";
    env.FLESH_WAV_URL = "https://files.example/flesh.wav";
    env.FLESH_EXCLUSIVE_URL = "https://drive.google.com/drive/folders/1cTQc6XtjjsxDVT_F56sM85fAnbo_Y9CY";

    const checkout = {
      email: "testbuyer@example.com",
      coinSym: "USDT",
      total: 0,
      promoCode: "KYROTEST",
      items: [{ id: "flesh", type: "exclusive" }]
    };

    const res = await api("/api/checkout", "POST", checkout);
    assert.equal(res.status, 200);
    assert.equal(res.data.released, true);
    assert.equal(payments.length, 0, "No NOWPayments calls for $0 test orders");

    await Promise.all(tasks);
    assert.equal(mails.length, 1);
    assert.match(mails[0].text, /1cTQc6XtjjsxDVT_F56sM85fAnbo_Y9CY/);
    assert.match(mails[0].html, /1cTQc6XtjjsxDVT_F56sM85fAnbo_Y9CY/);
    assert.deepEqual(mails[0].attachments.map((f) => f.filename), ["EXCLUSIVE_LICENSE.pdf", "EXCLUSIVE_LICENSE.txt"]);
  } finally { restore(); }
});
