import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import worker from "./src/index.js";

test("Base wallet proof gates holder discounts, checkout and queued cashback", async () => {
  const account = privateKeyToAccount("0x" + "1".repeat(64));
  const records = new Map();
  const payments = [];
  const tasks = [];
  const rewardCalls = [];
  let balance = 1n;
  const env = {
    TOKEN_PERKS_ENABLED: "true",
    BASE_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000001",
    BASE_RPC_URL: "https://rpc.example",
    BEAT_CATALOG: JSON.stringify({ beat1: { title: "BEAT 01" } }),
    BEAT_LINKS: JSON.stringify({ beat1: { mp3: "https://files.example/beat1.mp3" } }),
    ORDERS: { get: async (key) => records.get(key) ?? null, put: async (key, value) => records.set(key, value), delete: async (key) => records.delete(key), list: async () => ({ keys: [...records.keys()].filter((name) => name.startsWith("cashback:")).map((name) => ({ name })) }) },
    NOWPAYMENTS_IPN_SECRET: "secret"
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).replace(/\/$/, "") === env.BASE_RPC_URL) {
      const rpc = JSON.parse(options.body);
      assert.equal(rpc.method, "eth_call");
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result: "0x" + balance.toString(16).padStart(64, "0") });
    }
    if (String(url).endsWith("/payment")) {
      payments.push(JSON.parse(options.body));
      return Response.json({ payment_id: payments.length, pay_amount: 8.46, pay_address: "payment", pay_currency: "usdtsol", payment_status: "waiting" });
    }
    if (String(url) === "https://rewards.example/dispatch") {
      rewardCalls.push({ headers: options.headers, body: JSON.parse(options.body) });
      return Response.json({ txHash: "0x" + "a".repeat(64) });
    }
    throw new Error("Unexpected fetch: " + url);
  };
  const api = async (path, body) => {
    const res = await worker.fetch(new Request("https://worker.example" + path, { method: "POST", body: JSON.stringify(body) }), env, { waitUntil: (task) => tasks.push(task) });
    return { status: res.status, data: await res.json() };
  };
  try {
    const timestamp = Date.now();
    const message = `KYROlll Base holder verification\nWallet: ${account.address}\nTimestamp: ${timestamp}`;
    const proof = { timestamp, signature: await account.signMessage({ message }) };
    const request = { walletAddress: account.address, proof };
    const verified = await api("/api/verify-token", request);
    assert.equal(verified.data.holder, true, JSON.stringify(verified));
    assert.equal((await api("/api/verify-token", { ...request, walletAddress: "0x0000000000000000000000000000000000000002" })).status, 400);
    const checkout = { ...request, email: "buyer@example.com", coinSym: "USDT", total: 8.46, items: [{ id: "beat1", type: "mp3" }] };
    assert.equal((await api("/api/checkout", { ...checkout, total: 9.95 })).status, 400);
    const order = await api("/api/checkout", checkout);
    assert.equal(order.status, 200, JSON.stringify(order.data));
    assert.equal(payments[0].price_amount, 8.46);
    assert.equal(JSON.parse(records.get("order:" + order.data.order_id)).walletAddress, account.address);
    balance = 0n;
    assert.equal((await api("/api/checkout", checkout)).status, 400);
    assert.equal((await api("/api/verify-token", request)).data.holder, false);
    balance = 1n;
    env.TOKEN_PERKS_ENABLED = "false";
    assert.equal((await api("/api/verify-token", request)).status, 503);
    assert.equal((await api("/api/checkout", { ...checkout, total: 8.46 })).status, 400);
    assert.equal((await api("/api/checkout", { ...checkout, total: 9.95 })).status, 200);
    records.set("cashback:test-order", JSON.stringify({ orderId: "test-order", walletAddress: account.address, usdAmount: 1, status: "pending", chainId: 8453 }));
    await worker.scheduled({}, env, { waitUntil: (task) => tasks.push(task) });
    await Promise.all(tasks);
    assert.equal(JSON.parse(records.get("cashback:test-order")).status, "pending");
    env.TOKEN_PERKS_ENABLED = "true";
    env.REWARDS_WEBHOOK_URL = "https://rewards.example/dispatch";
    env.REWARDS_WEBHOOK_SECRET = "test-secret";
    await worker.scheduled({}, env, { waitUntil: (task) => tasks.push(task) });
    await Promise.all(tasks);
    assert.equal(JSON.parse(records.get("cashback:test-order")).status, "submitted");
    assert.equal(rewardCalls[0].headers["Idempotency-Key"], "test-order");
  } finally { globalThis.fetch = originalFetch; }
});
