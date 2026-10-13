/* Tests for seed-test-licenses.mjs — writes test licenses for one account
 * through the service_role key. Runs without network: fetch is stubbed. Not
 * meant to touch the live project.
 */
import test from "node:test";
import assert from "node:assert/strict";

function importScript() {
  delete process.env.SEED_EMAIL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.argv = process.argv.filter((arg) => arg !== "--remove");
  return import("./seed-test-licenses.mjs?t=" + Math.random());
}

test("requires SEED_EMAIL", async () => {
  const { main } = await importScript();
  await assert.rejects(main(), /SEED_EMAIL is required/);
});

test("without a service key it hands over the equivalent SQL", async () => {
  const { main } = await importScript();
  process.env.SEED_EMAIL = "matan@example.com";
  await assert.rejects(main(), (err) => {
    assert.match(err.message, /SUPABASE_SERVICE_ROLE_KEY is required/);
    assert.match(err.message, /insert into public\.licenses/);
    assert.match(err.message, /where email = 'matan@example\.com'/);
    return true;
  });
});

test("finds the user, clears the seeded tiers, then writes all three", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const method = (init && init.method) || "GET";
    if (url.includes("/auth/v1/admin/users")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ users: [{ id: "user-123", email: "matan@example.com" }] }) };
    }
    if (method === "DELETE") {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: "old-1" }]) };
    }
    return { ok: true, status: 201, text: async () => JSON.stringify([{ id: "new-1" }, { id: "new-2" }, { id: "new-3" }]) };
  };

  const { main } = await importScript();
  process.env.SEED_EMAIL = "matan@example.com";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service_role_test";
  await main();

  assert.equal(calls.length, 3, "admin lookup, delete, insert");
  const [lookup, del, insert] = calls;

  assert.match(lookup.url, /\/auth\/v1\/admin\/users\?page=1&per_page=200$/);
  assert.equal(lookup.init.headers.apikey, "service_role_test");
  assert.equal(lookup.init.headers.Authorization, "Bearer service_role_test");

  assert.equal(del.init.method, "DELETE");
  assert.match(del.url, /^https:\/\/[a-z0-9]{20,}\.supabase\.co\/rest\/v1\/licenses\?/, "uses the real project host, not the doc placeholder");
  assert.doesNotMatch(del.url, /YOUR-PROJECT/);
  assert.match(del.url, /\/rest\/v1\/licenses\?user_id=eq\.user-123&beat_id=eq\.flesh&tier_id=in\.\(mp3,wav,exclusive\)$/);

  assert.equal(insert.init.method, "POST");
  assert.equal(insert.init.headers.Prefer, "return=representation");
  const rows = JSON.parse(insert.init.body);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.tier_id), ["mp3", "wav", "exclusive"]);
  assert.deepEqual(rows.map((r) => r.tier), ["MP3 LEASE", "STANDARD WAV LEASE", "EXCLUSIVE LEASE"]);
  assert.deepEqual(rows.map((r) => r.price), ["$9.95", "$14.95", "$299.95"]);
  rows.forEach((row) => {
    assert.equal(row.user_id, "user-123");
    assert.equal(row.beat_id, "flesh");
    assert.equal(row.beat_title, "[FREE] DON TOLIVER TYPE BEAT - FLESH");
    assert.ok(!("id" in row), "lets the table default the uuid");
    assert.match(row.purchased_at, /^\d{4}-\d{2}-\d{2}T/);
  });

  delete globalThis.fetch;
});

test("--remove deletes the seeded tiers and writes nothing", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/auth/v1/admin/users")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ users: [{ id: "user-123", email: "matan@example.com" }] }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify([{ id: "old-1" }, { id: "old-2" }]) };
  };

  const { main } = await importScript();
  process.env.SEED_EMAIL = "matan@example.com";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service_role_test";
  process.argv.push("--remove");
  await main();

  assert.equal(calls.length, 2, "admin lookup, delete");
  assert.equal(calls[1].init.method, "DELETE");

  delete globalThis.fetch;
});

test("surfaces a missing account clearly", async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ users: [] }) });
  const { main } = await importScript();
  process.env.SEED_EMAIL = "nobody@example.com";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service_role_test";
  await assert.rejects(main(), /No auth user found with email nobody@example\.com/);
  delete globalThis.fetch;
});
