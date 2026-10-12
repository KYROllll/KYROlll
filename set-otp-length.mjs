/* KYROlll — align the Supabase Auth (GoTrue) email OTP length with the storefront.
 *
 * The length of the emailed one-time code is SERVER-side configuration
 * (GoTrue env `GOTRUE_MAILER_OTP_LENGTH`, editable in the Supabase dashboard at
 * Authentication → Providers → Email → "Email OTP Length"). It cannot be set
 * from the storefront or from the `/auth/v1/otp` request body — GoTrue's OTP
 * handler has no `otp_length` field and ignores unknown ones. Brand-new
 * projects default to 8 digits, and the auth page's code input asks for 8, so
 * this script defaults to 8 — run it to verify or pin `mailer_otp_length` so
 * the `{{ .Token }}` in the email template renders exactly the digits the code
 * input asks for (pass `OTP_LENGTH` to choose a different length).
 *
 * Usage (token from https://supabase.com/dashboard/account/tokens, Owner or
 * Administrator — this endpoint needs at least Admin):
 *
 *   SUPABASE_ACCESS_TOKEN=sb_pat_… node set-otp-length.mjs
 *   PROJECT_REF=… SUPABASE_ACCESS_TOKEN=… OTP_LENGTH=8 node set-otp-length.mjs
 *
 * The project ref is read from supabase-config.js by default. Only prints the
 * change; re-running is idempotent.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const API = "https://api.supabase.com/v1";
const LENGTH = parseInt(process.env.OTP_LENGTH, 10);

function projectRef() {
  if (process.env.PROJECT_REF) return process.env.PROJECT_REF.trim();
  const cfg = readFileSync(join(ROOT, "supabase-config.js"), "utf8");
  const match = cfg.match(/https:\/\/([a-z0-9]{20,})\.supabase\.co/);
  if (!match) throw new Error("Could not read the project ref from supabase-config.js — set PROJECT_REF.");
  return match[1];
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
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error(
    "SUPABASE_ACCESS_TOKEN is required — create a personal access token at " +
    "https://supabase.com/dashboard/account/tokens (Owner or Administrator role)."
  );
  const length = Number.isInteger(LENGTH) && LENGTH >= 4 && LENGTH <= 10 ? LENGTH : 8;
  const ref = projectRef();

  const headers = {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json"
  };

  const before = await call(`/projects/${ref}/config/auth`, { headers });
  if (before.status !== 200) {
    const message = (before.data && (before.data.message || before.data.msg)) || "request failed";
    throw new Error(
      `GET auth config failed (HTTP ${before.status}): ${message}` +
      (before.status === 401 ? " — is SUPABASE_ACCESS_TOKEN valid?" : "") +
      (before.status === 403 ? " — this endpoint needs the Owner or Administrator role." : "")
    );
  }
  const current = Number(before.data && before.data.mailer_otp_length);
  console.log(
    `project ${ref}: mailer_otp_length is ${Number.isFinite(current) ? current + " (GOTRUE_MAILER_OTP_LENGTH=" + current + ")" : "unset"}`
  );

  const patch = await call(`/projects/${ref}/config/auth`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ mailer_otp_length: length })
  });
  if (patch.status !== 200) {
    const message = (patch.data && (patch.data.message || patch.data.msg)) || "request failed";
    throw new Error(
      `PATCH auth config failed (HTTP ${patch.status}): ${message}` +
      (patch.status === 403 ? " — this endpoint needs the Owner or Administrator role (and/or auth_config_write permission)." : "")
    );
  }

  const after = Number(patch.data && patch.data.mailer_otp_length);
  console.log(`set mailer_otp_length to ${after || length} — the emailed {{ .Token }} is now ${after || length} digits.`);
  if (after !== length) console.log("Note: the project reported a different value; check Authentication → Providers → Email in the dashboard.");
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error(String((err && err.message) || err));
    process.exit(1);
  });
}

export { main };