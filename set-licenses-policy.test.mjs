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
  assert.match(sql, /create policy "read own licenses" on public\.licenses\s+for select to authenticated\s+using \(auth\.uid\(\) = user_id\);/);
  assert.doesNotMatch(sql, /for all\s+to authenticated/, "no owner-writable policy survives");
  assert.doesNotMatch(sql, /for insert/, "buyers cannot insert a license — only the service_role webhook may");
  assert.match(sql, /drop policy if exists "read own licenses" on public\.licenses;/, "is idempotent");
  assert.match(sql, /notify pgrst, 'reload schema';/, "refreshes the PostgREST schema cache");
});

test("refuses to run without a management token, and hands over the SQL", async () => {
  const { main } = await importScript();
  await assert.rejects(main(), (err) => {
    assert.match(err.message, /SUPABASE_ACCESS_TOKEN is required/);
    assert.match(err.message, /create policy "read own licenses"/);
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

/* 0004 closes a public-read leak on a LIVE table without destroying it. It must
 * drop every policy (the permissive one may have any name) and re-install the
 * owner-only SELECT, and it must never drop the table — that is 0003's job. */
test("0004 closes the public read without dropping the table", async () => {
  const { migrationSql } = await importScript();
  process.env.MIGRATION = "migrations/0004_licenses_owner_only_select.sql";
  const sql = migrationSql();

  assert.match(sql, /alter table public\.licenses enable row level security;/,
    "turns RLS on even if it had been left off");
  assert.match(sql, /from pg_policies/,
    "enumerates the existing policies so a permissive one cannot survive by name");
  assert.match(sql, /create policy "read own licenses" on public\.licenses\s+for select to authenticated\s+using \(auth\.uid\(\) = user_id\);/,
    "installs exactly the owner-only policy");
  assert.match(sql, /grant select on public\.licenses to authenticated;/);
  assert.doesNotMatch(sql, /drop table/i, "must not destroy the live table (that is 0003)");
  assert.doesNotMatch(sql, /for insert/i, "buyers still cannot mint a license");

  delete process.env.MIGRATION;
});

/* 0005 reshapes `licenses` for the account-less checkout. It must be
 * non-destructive (no drop table / no drop column), make the row buyable
 * without a user (nullable user_id, no auth.users FK, a new email column) and
 * leave RLS on with NO policy — so the publishable key reads zero rows and only
 * the service_role webhook can write. */
test("0005 makes licenses account-less without destroying the table", async () => {
  const { migrationSql } = await importScript();
  process.env.MIGRATION = "migrations/0005_licenses_email_nullable_user.sql";
  const sql = migrationSql();

  assert.match(sql, /add column if not exists email text/,
    "adds the buyer email column");
  assert.match(sql, /alter column user_id drop not null/,
    "a row no longer needs a user");
  assert.match(sql, /confrelid = 'auth\.users'::regclass/,
    "drops the user_id → auth.users foreign key by target, not by name");
  assert.match(sql, /from pg_policies/,
    "enumerates the existing policies so an auth.uid() one cannot survive");
  assert.doesNotMatch(sql, /create policy[^;]*on public\.licenses/i,
    "leaves RLS on with no licenses policy");
  assert.doesNotMatch(sql, /drop table/i, "must not destroy the live table");
  assert.doesNotMatch(sql, /drop column/i, "must not drop a column");
  const code = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(code, /auth\.uid\(\)/, "no auth.uid() dependency survives in the SQL");
  assert.match(sql, /create policy "beats are public" on public\.beats/,
    "keeps the catalog world-readable for the checkout's beat lookup");

  delete process.env.MIGRATION;
});

test("MIGRATION selects which SQL is applied", async () => {
  process.env.MIGRATION = "migrations/0004_licenses_owner_only_select.sql";
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { status: 201, text: async () => "" };
  };

  const { main, migrationSql, migrationFile } = await importScript();
  process.env.SUPABASE_ACCESS_TOKEN = "sb_pat_test";

  assert.match(migrationFile(), /0004_licenses_owner_only_select\.sql$/);

  await main();
  assert.equal(calls.length, 1);
  const query = JSON.parse(calls[0].init.body).query;
  assert.equal(query, migrationSql(), "sends the selected migration verbatim");
  assert.match(query, /from pg_policies/);

  delete globalThis.fetch;
  delete process.env.MIGRATION;
});
