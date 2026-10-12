/* Tests for set-otp-length.mjs — PATCHes the Supabase Management API auth
 * config so GoTrue emails a 6-digit code. Runs without network: fetch is
 * stubbed. Not meant to touch the live project.
 */
import test from "node:test";
import assert from "node:assert/strict";

function importScript() {
  delete process.env.SUPABASE_ACCESS_TOKEN;
  return import("./set-otp-length.mjs");
}

test("refuses to run without a management token", async () => {
  const { main } = await importScript();
  await assert.rejects(main(), /SUPABASE_ACCESS_TOKEN is required/);
});

test("reads the ref from supabase-config.js and PATCHes mailer_otp_length to 8", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const method = (init && init.method) || "GET";
    const body = method === "PATCH"
      ? { mailer_otp_length: 8 }
      : { mailer_otp_length: 8 };
    return {
      status: 200,
      text: async () => JSON.stringify(body)
    };
  };

  const { main } = await importScript();
  process.env.SUPABASE_ACCESS_TOKEN = "sb_pat_test";
  await main();

  assert.equal(calls.length, 2, "one GET then one PATCH");
  const [get, patch] = calls;
  assert.equal(get.init.method, undefined, "first call is a GET");
  assert.match(get.url, /\/v1\/projects\/vuryglxywrqdnvnbelvp\/config\/auth$/);
  assert.equal(get.init.headers.Authorization, "Bearer sb_pat_test");
  assert.equal(patch.init.method, "PATCH");
  assert.equal(JSON.parse(patch.init.body).mailer_otp_length, 8);

  delete globalThis.fetch;
});

test("surfaces the API error with role guidance on a 403", async () => {
  globalThis.fetch = async () => ({
    status: 403,
    text: async () => JSON.stringify({ message: "forbidden" })
  });
  const { main } = await importScript();
  process.env.SUPABASE_ACCESS_TOKEN = "sb_pat_test";
  await assert.rejects(main(), /Owner or Administrator/);
  delete globalThis.fetch;
});