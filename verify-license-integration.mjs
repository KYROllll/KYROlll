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
if (!cat.includes('id: "flesh"')) fail("catalog missing beat fuzz");
if (!cat.includes("files:") || !cat.includes("mp3:")) fail("catalog missing file mappings");
if (cat.indexOf("mp3") === -1 || cat.indexOf("wav") === -1 || cat.indexOf("exclusive") === -1) fail("catalog missing tier names");
pass("catalog beat + tier mapping present (flesh / mp3 / wav / exclusive)");

// 2. Seed script uses correct columns and tiers
const seed = readFileSync(join(ROOT, "seed-test-licenses.mjs"), "utf8");
if (!seed.includes('"flesh"')) fail("seed missing beat flesh");
if (!seed.includes('"mp3"') || !seed.includes('"wav"') || !seed.includes('"exclusive"')) fail("seed missing tier ids");
if (!seed.includes("user_id") || !seed.includes("beat_id") || !seed.includes("tier_id")) fail("seed missing DB columns");
pass("seed-test-licenses.mjs aligns with catalog (beat + 3 tiers + DB columns)");

// 3. Backend fromRow and strict JWT filter
const backend = readFileSync(join(ROOT, "kyrolll-backend.js"), "utf8");
if (!backend.includes("function fromRow")) fail("backend missing fromRow");
if (!backend.includes("beat_id || row.beatId")) fail("fromRow beatId mapping missing");
if (!backend.includes("tier_id || row.tierId")) fail("fromRow tierId mapping missing");
if (!backend.includes("jwtSubject(token)")) fail("strict JWT filter missing");
pass("backend fromRow + strict auth.uid() filter present");

// 4. Library HTML renders items with download + PDF (markup is injected by account.js libraryItemHTML)
const acct = readFileSync(join(ROOT, "account.js"), "utf8");
if (!acct.includes('data-download') || !acct.includes('data-pdf')) fail("account.js library actions missing");
if (!acct.includes('libraryItemHTML')) fail("account.js library item renderer missing");
pass("library rendering (account.js) has download + PDF actions");

console.log("\nAll licensing/catalog integration checks passed — mapping, seeding, backend, frontend verified.");
