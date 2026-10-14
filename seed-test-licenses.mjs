/* KYROlll — seed test/purchased licenses into one account's library.
 *
 * Legacy from the account era: the (now removed) library page read the
 * `licenses` table through the signed-in user's session, and RLS pinned every
 * row to `auth.uid() = user_id`, so this seeder cannot use the anon key:
 * nothing may write a license the buyer does not own. It needs the project's
 * **service_role** key, which bypasses RLS, to (a) find the account by email
 * through the GoTrue admin API and (b) write the rows through PostgREST.
 *
 * It is idempotent: the tiers it is about to write are deleted first, so
 * re-running never stacks duplicates (and `payment_id` is unique, so a stray
 * re-insert of the same seed is rejected rather than duplicated). Pass
 * `--remove` to take the seeded rows back out. These rows stand in for what the
 * `nowpayments-webhook` Edge Function writes after a real finished payment.
 *
 * Usage (service_role key: Supabase dashboard → Project Settings → API →
 * `service_role`; it must never ship to a browser):
 *
 *   SEED_EMAIL=you@example.com SUPABASE_SERVICE_ROLE_KEY=… node seed-test-licenses.mjs
 *   SEED_EMAIL=you@example.com SUPABASE_SERVICE_ROLE_KEY=… node seed-test-licenses.mjs --remove
 *
 * Without SUPABASE_SERVICE_ROLE_KEY it prints the equivalent SQL to run in the
 * Supabase SQL editor (Settings → SQL Editor) instead of failing silently.
 *
 * The rows mirror `catalog.js` — the one beat and its three tiers — so the
 * seeded entries resolve their artwork, download and PDF exactly like a real
 * purchase. Keep them in step with catalog.js if it changes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));

// The single catalog beat, and the three official tiers (catalog.js). The beat's
// `id` is its uuid — the same value catalog.js carries and public.beats holds,
// since `licenses.beat_id` is a foreign key into that table. `license_type`
// resolves files/PDF; the library resolves the display name from catalog.js.
const BEAT = {
  id: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af",
  slug: "flesh",
  title: "[FREE] DON TOLIVER TYPE BEAT - FLESH"
};
// `price` is numeric (the table's column is numeric), not the "$9.95" display
// string the storefront shows.
const TIERS = [
  { id: "mp3", name: "MP3 LEASE", price: 9.95 },
  { id: "wav", name: "STANDARD WAV LEASE", price: 14.95 },
  { id: "exclusive", name: "EXCLUSIVE LEASE", price: 299.95 }
];

function config() {
  const cfg = readFileSync(join(ROOT, "supabase-config.js"), "utf8");
  // Match the real project ref (lowercase subdomain), not the `YOUR-PROJECT`
  // placeholder in the file's doc comment.
  const ref = (cfg.match(/https:\/\/([a-z0-9]{20,})\.supabase\.co/) || [])[1];
  const table = (cfg.match(/licenses:\s*"([^"]+)"/) || [])[1] || "licenses";
  if (!ref) throw new Error("Could not read the Supabase project ref from supabase-config.js.");
  return { url: "https://" + ref + ".supabase.co", table };
}

function message(data) {
  return (data && (data.message || data.msg || data.error_description || data.error || data.hint)) || JSON.stringify(data);
}

async function api(base, key, path, init) {
  const response = await fetch(base + path, {
    ...init,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...((init && init.headers) || {})
    }
  });
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (err) { data = text; } }
  return { ok: response.ok, status: response.status, data };
}

// Resolve the account email to the auth user id the licenses table references.
// GoTrue's admin list is paginated and this is a single-user lookup, so it walks
// the pages until the address shows up (or the pages run out).
async function findUserId(base, key, email) {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const res = await api(base, key, `/auth/v1/admin/users?page=${page}&per_page=200`, { method: "GET" });
    if (!res.ok) throw new Error(`admin users lookup failed (HTTP ${res.status}): ${message(res.data)}`);
    const users = Array.isArray(res.data) ? res.data : (res.data && res.data.users) || [];
    const hit = users.find((user) => String(user.email || "").toLowerCase() === wanted);
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

function seedFilter(userId, tierIds) {
  const tiers = tierIds.map(encodeURIComponent).join(",");
  return `user_id=eq.${encodeURIComponent(userId)}&beat_id=eq.${encodeURIComponent(BEAT.id)}&license_type=in.(${tiers})`;
}

async function removeRows(base, key, table, userId, tierIds) {
  const res = await api(base, key, `/rest/v1/${table}?${seedFilter(userId, tierIds)}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" }
  });
  if (!res.ok) throw new Error(`delete failed (HTTP ${res.status}): ${message(res.data)}`);
  return Array.isArray(res.data) ? res.data : [];
}

async function insertRows(base, key, table, userId) {
  const now = Date.now();
  // `payment_id` is UNIQUE — it is what makes the webhook's insert idempotent —
  // so the seeder writes a deterministic one per (account, tier): a re-run
  // collides with itself, never with another account's seed.
  const body = TIERS.map((tier, index) => ({
    user_id: userId,
    beat_id: BEAT.id,
    license_type: tier.id,
    price: tier.price,
    payment_id: `seed-${userId.slice(0, 8)}-${tier.id}`,
    status: "active",
    // A different day per tier so the library's date column reads like a real history.
    created_at: new Date(now - index * 86400000).toISOString()
  }));
  const res = await api(base, key, `/rest/v1/${table}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`insert failed (HTTP ${res.status}): ${message(res.data)}`);
  return Array.isArray(res.data) ? res.data : body;
}

// The same job as one statement, for pasting into the SQL editor when no
// service_role key is at hand. Idempotent for the same reason: delete, then add.
function sql(email) {
  const quoted = String(email).replace(/'/g, "''");
  const values = TIERS.map((tier) =>
    `('${tier.id}', ${tier.price}, 'seed-' || left(u.id::text, 8) || '-${tier.id}')`
  ).join(",\n  ");
  return `delete from public.licenses\n where user_id = (select id from auth.users where email = '${quoted}')\n   and beat_id = '${BEAT.id}'\n   and license_type in (${TIERS.map((tier) => `'${tier.id}'`).join(", ")});\n\ninsert into public.licenses (user_id, beat_id, license_type, price, payment_id, status, created_at)\nselect u.id, '${BEAT.id}', t.license_type, t.price, t.payment_id, 'active', now()\n  from auth.users u\n  cross join (values\n  ${values}\n) as t(license_type, price, payment_id)\n where u.email = '${quoted}';`;
}

async function main() {
  const email = String(process.env.SEED_EMAIL || "").trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const remove = process.argv.includes("--remove");
  if (!email) throw new Error("SEED_EMAIL is required — the account whose library to seed.");

  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required (RLS pins licenses to the owner, so the anon key cannot write them).\n" +
      "Get it from Project Settings → API → service_role, or run this SQL in the SQL editor:\n\n" +
      sql(email)
    );
  }

  const { url, table } = config();
  const user = await findUserId(url, key, email);
  if (!user) throw new Error(`No auth user found with email ${email}.`);
  const tierIds = TIERS.map((tier) => tier.id);

  if (remove) {
    const removed = await removeRows(url, key, table, user.id, tierIds);
    console.log(`project ${url}: removed ${removed.length} seeded license(s) for ${email}.`);
    return;
  }

  const deleted = await removeRows(url, key, table, user.id, tierIds);
  const inserted = await insertRows(url, key, table, user.id);
  console.log(
    `project ${url}: seeded ${inserted.length} license(s) for ${email} (${user.id}) ` +
    `— replaced ${deleted.length} existing row(s).`
  );
}

export { main, findUserId, removeRows, insertRows, sql, BEAT, TIERS };

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error(String((err && err.message) || err));
    process.exit(1);
  });
}
