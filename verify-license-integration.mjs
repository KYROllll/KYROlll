/* KYROlll — integration check for the account-less store: the catalog/beat
 * mapping, seed validity, the public payment call, and that no page still
 * reaches for the removed auth. Reads source files; needs no DB or browser. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
function fail(msg) { console.error("INTEGRATION FAIL: " + msg); process.exit(1); }
function pass(msg) { console.log("PASS: " + msg); }

const read = (name) => readFileSync(join(ROOT, name), "utf8");

// 1. Catalog mapping
const cat = read("catalog.js");
if (!cat.includes('id: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af"')) fail("catalog missing the beats uuid");
if (!cat.includes('slug: "flesh"')) fail("catalog missing the beat slug");
if (!cat.includes("files:") || !cat.includes("mp3:")) fail("catalog missing file mappings");
if (cat.indexOf("mp3") === -1 || cat.indexOf("wav") === -1 || cat.indexOf("exclusive") === -1) fail("catalog missing tier names");
pass("catalog beat uuid + slug + tier mapping present (flesh / mp3 / wav / exclusive)");

// 2. Seed script uses correct columns and tiers
const seed = read("seed-test-licenses.mjs");
if (!seed.includes("6c56eda2-df4a-45b0-b9b7-68f8efdbb1af")) fail("seed missing the beat uuid");
if (!seed.includes('"mp3"') || !seed.includes('"wav"') || !seed.includes('"exclusive"')) fail("seed missing tier ids");
if (!seed.includes("user_id") || !seed.includes("beat_id") || !seed.includes("license_type")) fail("seed missing DB columns");
if (!seed.includes("payment_id")) fail("seed missing the unique payment_id");
pass("seed-test-licenses.mjs aligns with catalog (beat uuid + 3 tiers + DB columns)");

// 3. The account-less backend: a public create-payment call, no session anywhere,
//    and the browser never INSERTs a license (only the service_role webhook may).
const backend = read("kyrolll-backend.js");
if (!backend.includes('"/functions/v1/create-payment"')) fail("backend missing the create-payment call");
if (!backend.includes("async function createInvoice")) fail("backend missing createInvoice");
if (/Authorization\s*:/.test(backend)) fail("backend still sends an Authorization header — there is no session");
if (/\bauth\s*:/.test(backend) || backend.includes("signInWithOtp")) fail("backend still exposes auth");
if (/request\(\s*"POST",\s*"\/rest\/v1\/"/.test(backend)) fail("frontend still writes to a table");
pass("backend is account-less (public createInvoice, no bearer, no frontend insert)");

// 4. The pages no longer reference the removed account screens.
const pages = ["index.html", "success.html", "support.html", "library.html"].map(read).join("\n");
if (/auth\.html|dashboard\.html/.test(pages)) fail("a page still links to the removed account screens");
if (/data-auth-action|header-auth/.test(pages)) fail("a page still carries an account control");
if (!read("library.html").includes("Your beat will be sent to your email after purchase.")) {
  fail("library.html is missing the account-less notice");
}
pass("pages are account-less (no auth/dashboard links, library shows the notice)");

// 5. create-payment takes the optional email and embeds the order JSON the
//    webhook reads back, without verifying a (non-existent) bearer.
const pay = read("supabase/functions/create-payment/index.ts");
if (!pay.includes("customer_email")) fail("create-payment does not pass customer_email");
if (!pay.includes("beat_id: beatId") || !pay.includes("license_type: licenseType") || !pay.includes("price,")) {
  fail("create-payment order_description is missing a field");
}
if (!pay.includes("email")) fail("create-payment does not accept the email field");
pass("create-payment embeds {email, beat_id, license_type, price} and pre-fills customer_email");

console.log("\nAll account-less integration checks passed — catalog, seeding, backend, pages, payment.");
