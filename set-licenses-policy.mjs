/* KYROlll — install the `licenses` schema and its row level security policy.
 *
 * This sends `migrations/0003_licenses_webhook.sql` through the Management
 * API's query endpoint — the SQL lives in the migration file, so there is one
 * source of truth and this script can never drift from what you would paste by
 * hand. It creates `public.beats`, recreates `public.licenses` in the payment
 * shape, and installs the SELECT-only owner policy.
 *
 * NOTE: `migrations/0001_licenses_rls.sql` (the original `for all` policy, which
 * also granted INSERT) is superseded — a buyer writing their own license row is
 * no longer possible. `migrations/0002_licenses_foreign_key.sql`'s
 * `user_id → auth.users(id)` foreign key is folded into the recreated table, so
 * it too is superseded (running it first is harmless). The only writer is the
 * `nowpayments-webhook` Edge Function, using the service_role key. Do not
 * re-apply 0001.
 *
 * A policy is Postgres DDL, so it cannot be set from the storefront: it needs
 * either the SQL editor or the Management API's query endpoint, which requires a
 * personal access token carrying `database_read`/`database_write`.
 *
 * The old `licenses` table is DROPPED and recreated by the migration — export it
 * first if it holds rows you care about.
 *
 * Usage (token from https://supabase.com/dashboard/account/tokens; the query
 * endpoint needs the `database_read`/`database_write` scopes, so grant both or
 * use `database_admin`):
 *
 *   SUPABASE_ACCESS_TOKEN=sb_pat_… node set-licenses-policy.mjs
 *   PROJECT_REF=… SUPABASE_ACCESS_TOKEN=… node set-licenses-policy.mjs
 *
 * The project ref is read from supabase-config.js by default. Without a token it
 * prints the migration to paste into the SQL editor instead. Re-running is
 * idempotent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const API = "https://api.supabase.com/v1";
const MIGRATION = join(ROOT, "migrations", "0003_licenses_webhook.sql");

function projectRef() {
  if (process.env.PROJECT_REF) return process.env.PROJECT_REF.trim();
  const cfg = readFileSync(join(ROOT, "supabase-config.js"), "utf8");
  const match = cfg.match(/https:\/\/([a-z0-9]{20,})\.supabase\.co/);
  if (!match) throw new Error("Could not read the project ref from supabase-config.js — set PROJECT_REF.");
  return match[1];
}

function migrationSql() {
  return readFileSync(MIGRATION, "utf8");
}

async function call(path, init) {
  const response = await fetch(API + path, init);
  let data = null;
  const text = await response.text();
  if (text) {
    try { data = JSON.parse(text); } catch (err) { data = text; }
  }
  return { status: response.status, data };
}

async function main() {
  const sql = migrationSql();
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "SUPABASE_ACCESS_TOKEN is required — create a personal access token with the " +
      "`database_read`/`database_write` scopes at https://supabase.com/dashboard/account/tokens.\n" +
      "Or paste this migration into the SQL editor:\n\n" + sql
    );
  }
  const ref = projectRef();

  const result = await call(`/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query: sql })
  });

  if (result.status !== 200 && result.status !== 201) {
    const message = (result.data && (result.data.message || result.data.msg)) || "request failed";
    throw new Error(
      `database/query failed (HTTP ${result.status}): ${message}` +
      (result.status === 401 ? " — is SUPABASE_ACCESS_TOKEN valid?" : "") +
      (result.status === 403 ? " — this endpoint needs a token with the `database_read`/`database_write` scopes." : "") +
      (result.status === 404 || result.status === 400
        ? " — does the public.licenses table exist? See AGENTS.md for the create-table SQL."
        : "")
    );
  }

  console.log(
    `project ${ref}: created public.beats + public.licenses (payment shape) with the ` +
    "SELECT-only owner policy. Buyers can read only their own rows; the nowpayments-webhook " +
    "function is the only writer. Re-running is idempotent."
  );
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error(String((err && err.message) || err));
    process.exit(1);
  });
}

export { main, projectRef, migrationSql };
