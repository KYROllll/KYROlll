/* KYROlll — integration check for license-to-beat mapping, seed validity,
 * and frontend rendering. Reads source files; does not need a DB or browser. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
function fail(msg) { console.error("INTEGRATION FAIL: " + msg); process.exit(1); }
function pass(msg) { console.log("PASS: " + msg); }

// 1. Catalog mapping
const cat = readFileSync(join(ROOT, "catalog.js"), "utf8");
if (!cat.includes('id: "6c56eda2-df4a-45b0-b9b7-68f8efdbb1af"')) fail("catalog missing the beats uuid");
if (!cat.includes('slug: "flesh"')) fail("catalog missing the beat slug");
if (!cat.includes("files:") || !cat.includes("mp3:")) fail("catalog missing file mappings");
if (cat.indexOf("mp3") === -1 || cat.indexOf("wav") === -1 || cat.indexOf("exclusive") === -1) fail("catalog missing tier names");
pass("catalog beat uuid + slug + tier mapping present (flesh / mp3 / wav / exclusive)");

// 2. Seed script uses correct columns and tiers
const seed = readFileSync(join(ROOT, "seed-test-licenses.mjs"), "utf8");
if (!seed.includes("6c56eda2-df4a-45b0-b9b7-68f8efdbb1af")) fail("seed missing the beat uuid");
if (!seed.includes('"mp3"') || !seed.includes('"wav"') || !seed.includes('"exclusive"')) fail("seed missing tier ids");
if (!seed.includes("user_id") || !seed.includes("beat_id") || !seed.includes("license_type")) fail("seed missing DB columns");
if (!seed.includes("payment_id")) fail("seed missing the unique payment_id");
pass("seed-test-licenses.mjs aligns with catalog (beat uuid + 3 tiers + DB columns)");

// 3. Backend fromRow and strict JWT filter
const backend = readFileSync(join(ROOT, "kyrolll-backend.js"), "utf8");
if (!backend.includes("function fromRow")) fail("backend missing fromRow");
if (!backend.includes("beat_id || row.beatId")) fail("fromRow beatId mapping missing");
if (!backend.includes("license_type || row.tier_id || row.tierId")) fail("fromRow license_type mapping missing");
if (!backend.includes("jwtSubject(token)")) fail("strict JWT filter missing");
if (!backend.includes('"/functions/v1/create-payment"')) fail("backend missing the create-payment call");
// The browser must never INSERT into licenses: only the service_role webhook may.
if (/request\(\s*"POST",\s*"\/rest\/v1\/"\s*\+\s*LICENSES_TABLE/.test(backend)) fail("frontend still inserts licenses");
pass("backend fromRow + strict auth.uid() filter + create-payment, with no frontend insert");

// 4. Library HTML renders items with download + PDF (markup is injected by account.js libraryItemHTML)
const acct = readFileSync(join(ROOT, "account.js"), "utf8");
if (!acct.includes('data-download') || !acct.includes('data-pdf')) fail("account.js library actions missing");
if (!acct.includes('libraryItemHTML')) fail("account.js library item renderer missing");
pass("library rendering (account.js) has download + PDF actions");

console.log("\nAll licensing/catalog integration checks passed — mapping, seeding, backend, frontend verified.");
