/* Tests for set-licenses-policy.mjs — installs the owner-only RLS policy on
 * `licenses` through the Supabase Management API. Runs without network: fetch is
 * stubbed. Not meant to touch the live project.
 */
import test from "node:test";
import assert from "node:assert/strict";

function importScript() {
  delete process.env.SUPABASE_ACCESS_TOKEN;
  delete process.env.PROJECT_REF;
  return import("./set-licenses-policy.mjs");
}

test("the migration grants owners their own rows", async () => {
  const { migrationSql } = await importScript();
  const sql = migrationSql();

  assert.match(sql, /alter table public\.licenses enable row level security;/);
  assert.match(sql, /for all\s+to authenticated\s+using \(auth\.uid\(\) = user_id\)\s+with check \(auth\.uid\(\) = user_id\);/);
  assert.match(sql, /drop policy if exists "own licenses" on public\.licenses;/, "is idempotent");
  assert.match(sql, /notify pgrst, 'reload schema';/, "refreshes the PostgREST schema cache");
});

test("refuses to run without a management token, and hands over the SQL", async () => {
  const { main } = await importScript();
  await assert.rejects(main(), (err) => {
    assert.match(err.message, /SUPABASE_ACCESS_TOKEN is required/);
    assert.match(err.message, /create policy "own licenses"/);
    return true;
  });
});

test("posts the migration to database/query with the ref from supabase-config.js", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { status: 201, text: async () => "" };
  };

  const { main, migrationSql } = await importScript();
  process.env.SUPABASE_ACCESS_TOKEN = "sb_pat_test";
  await main();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.supabase.com/v1/projects/vuryglxywrqdnvnbelvp/database/query");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sb_pat_test");
  const query = JSON.parse(calls[0].init.body).query;
  assert.equal(query, migrationSql(), "sends the migration verbatim");
  assert.match(query, /auth\.uid\(\) = user_id/);

  delete globalThis.fetch;
});

test("explains a missing database_write scope on a 403", async () => {
  globalThis.fetch = async () => ({
    status: 403,
    text: async () => JSON.stringify({ message: "Missing required permission(s): database_write" })
  });
  const { main } = await importScript();
  process.env.SUPABASE_ACCESS_TOKEN = "sb_pat_test";
  await assert.rejects(main(), /database_write/);
  delete globalThis.fetch;
});
