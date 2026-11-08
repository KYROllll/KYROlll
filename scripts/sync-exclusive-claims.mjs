#!/usr/bin/env node
/* Merge the live exclusive-claim bus (ntfy.sh) into the shared seed that every
   page reads from `data/exclusive-claims.json`.

   The storefront is static, so there is no database to write to. The browser
   publishes a claim to a public ntfy topic; this script runs from a scheduled
   GitHub Action, polls the topic's cached history, and commits the earliest
   claim for each beat into the seed. Every page fetches the seed and also
   listens to the same topic for live updates, so a claim reaches every open
   device immediately and every future visitor through the committed file.

   Run with `--reset` (the Action's manual "reset" input) to retire the whole
   register: it bumps `generation`, clears the claims and moves the cursor past
   every old message. Old bus messages are ignored by the generation check. */
import { readFile, writeFile } from "node:fs/promises";

const FILE = new URL("../data/exclusive-claims.json", import.meta.url);
const BUS = "https://ntfy.sh";
const args = new Set(process.argv.slice(2));

function isoFromSeconds(seconds) {
  const value = Number(seconds);
  return new Date((Number.isFinite(value) ? value : Date.now() / 1000) * 1000).toISOString();
}

function validClaim(record) {
  return record && typeof record === "object" && typeof record.at === "string" &&
    !Number.isNaN(Date.parse(record.at));
}

/* Earliest claim wins. ntfy's server `time` (normalised into `at`) is the
   clock; the message id breaks a same-second tie deterministically. */
function earlier(candidate, current) {
  if (!validClaim(current)) return true;
  const a = Date.parse(candidate.at);
  const b = Date.parse(current.at);
  if (a !== b) return a < b;
  return String(candidate.msgId || "") < String(current.msgId || "");
}

async function readSeed() {
  const raw = JSON.parse(await readFile(FILE, "utf8"));
  const now = new Date().toISOString();
  return {
    version: 2,
    generation: typeof raw.generation === "string" && raw.generation ? raw.generation : now,
    topic: typeof raw.topic === "string" ? raw.topic : "",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
    cursor: Number.isFinite(raw.cursor) ? raw.cursor : 0,
    claims: raw.claims && typeof raw.claims === "object" && !Array.isArray(raw.claims) ? raw.claims : {}
  };
}

async function writeSeed(seed) {
  await writeFile(FILE, JSON.stringify(seed, null, 2) + "\n");
}

async function main() {
  const seed = await readSeed();

  if (args.has("--reset")) {
    const now = Math.floor(Date.now() / 1000);
    seed.generation = new Date(now * 1000).toISOString();
    seed.claims = {};
    seed.cursor = now;
    seed.updatedAt = new Date(now * 1000).toISOString();
    await writeSeed(seed);
    console.log("Exclusive-claims register reset for generation " + seed.generation);
    return;
  }

  if (!seed.topic) throw new Error("data/exclusive-claims.json has no ntfy topic");

  const url = BUS + "/" + encodeURIComponent(seed.topic) + "/json?poll=1&since=" +
    (seed.cursor > 0 ? String(seed.cursor) : "all");
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("ntfy poll failed: HTTP " + res.status);

  const text = await res.text();
  let changed = false;
  let cursor = seed.cursor;

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch (err) { continue; }
    if (!event || event.event !== "message" || typeof event.message !== "string") continue;
    if (Number.isFinite(event.time) && event.time > cursor) cursor = event.time;

    let body;
    try { body = JSON.parse(event.message); } catch (err) { continue; }
    if (!body || body.type !== "claim") continue;
    /* Strict: a claim from a previous generation (before a store-wide reset) is
       retired, and a generation-less message is never trusted into the seed. */
    if (String(body.generation || "") !== String(seed.generation || "")) continue;
    if (typeof body.beatId !== "string" || !body.beatId) continue;

    const record = {
      at: isoFromSeconds(event.time),
      ownerId: typeof body.ownerId === "string" ? body.ownerId : "",
      msgId: typeof event.id === "string" ? event.id : "",
      nonce: typeof body.nonce === "string" ? body.nonce : ""
    };
    if (earlier(record, seed.claims[body.beatId])) {
      seed.claims[body.beatId] = record;
      changed = true;
    }
  }

  if (cursor > seed.cursor) {
    seed.cursor = cursor;
    changed = true;
  }
  if (changed) {
    seed.updatedAt = new Date().toISOString();
    await writeSeed(seed);
    console.log("Exclusive-claims seed updated (" + Object.keys(seed.claims).length + " claims).");
  } else {
    console.log("No claim changes.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
