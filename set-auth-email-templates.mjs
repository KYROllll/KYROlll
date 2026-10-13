/* KYROlll — branded Supabase Auth emails.
 *
 * Every email Supabase Auth can send (the one-time sign-in code the storefront
 * triggers, plus signup confirmation, access recovery, email change and the
 * security notices) is rendered SERVER-side by GoTrue from the project's email
 * templates. The stock templates are generic, mention Supabase, and push a raw
 * `{{ .ConfirmationURL }}` magic link — which the code-only KYROlll auth page
 * never uses, so it only reads as clutter (and as a way in the user did not ask
 * for).
 *
 * This script PATCHes the auth config through the Management API to install the
 * KYROlll dark templates (the same ink as the storefront: #080809 page,
 * #101012 panel, #17171a code well, #a4a4aa labels, #927260 accent) and the
 * matching subjects. Every action template is code-only (`{{ .Token }}`); the
 * one deliberate exception is the invite, whose link IS the action, so it keeps
 * `{{ .ConfirmationURL }}` behind a worded button. Nothing else ships a link.
 *
 * Idempotent: only fields that differ from what the project already has are
 * PATCHed, so re-running prints "already up to date" and changes nothing.
 *
 * Usage (token from https://supabase.com/dashboard/account/tokens, Owner or
 * Administrator — this endpoint needs at least Admin):
 *
 *   SUPABASE_ACCESS_TOKEN=sb_pat_… node set-auth-email-templates.mjs
 *   SUPPORT_EMAIL=… PROJECT_REF=… SUPABASE_ACCESS_TOKEN=… node set-auth-email-templates.mjs
 *
 * The project ref is read from supabase-config.js by default, exactly like
 * set-otp-length.mjs. The template length must keep matching that project's
 * Email OTP Length (the code input shows `otpLength` digits, default 8).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));
const API = "https://api.supabase.com/v1";

// The storefront palette. Keep in step with style.css / BRAND-DESIGN.md.
const PAGE_BG = "#080809";
const PANEL_BG = "#101012";
const WELL_BG = "#17171a";
const BORDER = "#38383e";
const LABEL = "#a4a4aa";
const TEXT = "#e2e2e5";
const DIM = "#77777f";
const ACCENT = "#927260";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";

const DEFAULT_SUPPORT_EMAIL = "kyrolll00@gmail.com";

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function projectRef() {
  if (process.env.PROJECT_REF) return process.env.PROJECT_REF.trim();
  const cfg = readFileSync(join(ROOT, "supabase-config.js"), "utf8");
  const match = cfg.match(/https:\/\/([a-z0-9]{20,})\.supabase\.co/);
  if (!match) throw new Error("Could not read the project ref from supabase-config.js — set PROJECT_REF.");
  return match[1];
}

function supportEmail() {
  const trimmed = String(process.env.SUPPORT_EMAIL || "").trim();
  return trimmed || DEFAULT_SUPPORT_EMAIL;
}

/* --------------------------------------------------------------- the shell */

// One dark, inline-styled shell for every auth message: presentation tables for
// Outlook, a hidden preheader, a brown hairline, the wordmark, a tracked label,
// then the message body. Remote fonts/images are deliberately avoided so the
// mail renders identically with images blocked.
function shell({ title, preheader, eyebrow, heading, lead, body, footer }) {
  const note = footer ||
    "If you didn&#39;t request this, you can safely ignore this email &mdash; nothing on your account changed.";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAGE_BG};font-size:1px;line-height:1px;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};">
<tr>
<td align="center" style="padding:36px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;background-color:${PANEL_BG};border:1px solid ${BORDER};">
<tr><td style="height:3px;background-color:${ACCENT};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr>
<td style="padding:34px 34px 30px;">
<p style="margin:0 0 4px;font-family:${SANS};font-size:20px;font-weight:700;letter-spacing:1px;"><a href="{{ .SiteURL }}" style="color:#ffffff;text-decoration:none;">KYROlll</a></p>
<p style="margin:0 0 24px;font-family:${MONO};font-size:10px;font-weight:700;letter-spacing:2px;color:${LABEL};">${esc(eyebrow)}</p>
<h1 style="margin:0 0 10px;font-family:${SANS};font-size:22px;line-height:29px;font-weight:700;letter-spacing:1px;color:#ffffff;">${esc(heading)}</h1>
<p style="margin:0 0 20px;font-family:${SANS};font-size:14px;line-height:22px;color:${LABEL};">${esc(lead)}</p>
${body}
</td>
</tr>
<tr>
<td style="padding:20px 34px 26px;border-top:1px solid #26262b;">
<p style="margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:19px;color:${DIM};">${note}</p>
<p style="margin:0;font-family:${SANS};font-size:12px;line-height:19px;color:${DIM};">Support: <a href="mailto:${esc(supportEmail())}" style="color:${LABEL};text-decoration:underline;">${esc(supportEmail())}</a></p>
</td>
</tr>
</table>
<p style="margin:18px 0 0;font-family:${MONO};font-size:10px;letter-spacing:2px;color:#55555c;">KYROlll &middot; ORIGINAL SOUND</p>
</td>
</tr>
</table>
</body>
</html>`;
}

function paragraph(text) {
  return `<p style="margin:0 0 14px;font-family:${SANS};font-size:14px;line-height:22px;color:${TEXT};">${text}</p>`;
}

// The one-time code, set large in the monospace face the storefront uses for
// technical labels. `label` names the code for the flow it belongs to.
function codeWell(label) {
  return `<div style="margin:6px 0 18px;padding:20px 16px;background-color:${WELL_BG};border:1px solid ${BORDER};text-align:center;">
<p style="margin:0 0 10px;font-family:${MONO};font-size:10px;font-weight:700;letter-spacing:2px;color:${LABEL};">${esc(label)}</p>
<p style="margin:0;font-family:${MONO};font-size:30px;line-height:38px;font-weight:700;letter-spacing:6px;color:#ffffff;word-break:break-all;">{{ .Token }}</p>
</div>`;
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;">
<tr>
<td style="background-color:#ffffff;">
<a href="${href}" style="display:inline-block;padding:14px 26px;font-family:${MONO};font-size:11px;font-weight:700;letter-spacing:2px;color:${PAGE_BG};text-decoration:none;">${esc(label)}</a>
</td>
</tr>
</table>`;
}

/* ------------------------------------------------------------- the messages */

// A code-only message: no link, just the digits the auth page asks for.
function codeMessage({ eyebrow, heading, lead, codeLabel, title, preheader, body, footer }) {
  return shell({
    title,
    preheader,
    eyebrow,
    heading,
    lead,
    body: codeWell(codeLabel) + paragraph(body || "The code is single-use and expires shortly. You can request a fresh one at any time."),
    footer
  });
}

function buildTemplates() {
  const support = supportEmail();

  const notification = (heading, lead, footer) => shell({
    title: heading,
    preheader: lead,
    eyebrow: "KYROlll SECURITY",
    heading,
    lead,
    body: paragraph("If this was you, no action is needed. If it wasn&#39;t, contact support immediately so we can secure your account."),
    footer
  });

  return {
    magic_link: {
      subject: "Your KYROlll sign-in code",
      content: codeMessage({
        title: "Your KYROlll sign-in code",
        preheader: "Your KYROlll sign-in code is inside.",
        eyebrow: "KYROlll ACCOUNT",
        heading: "YOUR SIGN-IN CODE",
        lead: "Enter this code on the KYROlll login screen to continue.",
        codeLabel: "ONE-TIME CODE"
      })
    },
    confirmation: {
      subject: "Confirm your KYROlll email",
      content: codeMessage({
        title: "Confirm your KYROlll email",
        preheader: "Enter this code to confirm your email.",
        eyebrow: "KYROlll ACCOUNT",
        heading: "CONFIRM YOUR EMAIL",
        lead: "Enter this code to finish creating your KYROlll account.",
        codeLabel: "CONFIRMATION CODE",
        body: "Confirming proves this address is yours, so we can send your licenses and receipts here."
      })
    },
    recovery: {
      subject: "Your KYROlll access code",
      content: codeMessage({
        title: "Your KYROlll access code",
        preheader: "Your KYROlll access code is inside.",
        eyebrow: "KYROlll ACCOUNT",
        heading: "USE THIS CODE TO CONTINUE",
        lead: "Enter this code to regain access to your KYROlll account.",
        codeLabel: "ACCESS CODE",
        footer: "If you didn&#39;t ask to regain access, ignore this email &mdash; your account stays exactly as it is."
      })
    },
    email_change: {
      subject: "Confirm your new KYROlll email",
      content: codeMessage({
        title: "Confirm your new KYROlll email",
        preheader: "Enter this code to confirm your new email.",
        eyebrow: "KYROlll ACCOUNT",
        heading: "CONFIRM YOUR NEW EMAIL",
        lead: "Enter this code to confirm {{ .NewEmail }} as the email on your KYROlll account.",
        codeLabel: "CONFIRMATION CODE",
        body: "Until you confirm, your account keeps its current address.",
        footer: "If you didn&#39;t ask to change your email, ignore this email and contact support."
      })
    },
    reauthentication: {
      subject: "Your KYROlll verification code",
      content: codeMessage({
        title: "Your KYROlll verification code",
        preheader: "Your KYROlll verification code is inside.",
        eyebrow: "KYROlll SECURITY",
        heading: "CONFIRM IT'S YOU",
        lead: "Enter this code to approve this change to your KYROlll account.",
        codeLabel: "VERIFICATION CODE"
      })
    },
    invite: {
      // The invite link IS the action, so — alone among the templates — this
      // one keeps `{{ .ConfirmationURL }}`, worded as a button.
      subject: "You're invited to KYROlll",
      content: shell({
        title: "You're invited to KYROlll",
        preheader: "Your invitation to KYROlll is ready.",
        eyebrow: "KYROlll ACCOUNT",
        heading: "YOU'RE INVITED",
        lead: "You&#39;ve been invited to open a KYROlll account.",
        body: button("{{ .ConfirmationURL }}", "ACCEPT INVITE") +
          paragraph("This invitation link is personal to {{ .Email }} and expires shortly.")
      })
    },
    password_changed_notification: {
      subject: "Your KYROlll password changed",
      content: notification("YOUR PASSWORD CHANGED", "The password on your KYROlll account was just changed.")
    },
    email_changed_notification: {
      subject: "Your KYROlll email changed",
      content: notification("YOUR EMAIL CHANGED", "The email on your KYROlll account was just changed.")
    },
    phone_changed_notification: {
      subject: "Your KYROlll phone number changed",
      content: notification("YOUR PHONE NUMBER CHANGED", "The phone number on your KYROlll account was just changed.")
    },
    mfa_factor_enrolled_notification: {
      subject: "A new sign-in method was added to KYROlll",
      content: notification("A SIGN-IN METHOD WAS ADDED", "A new sign-in method was just added to your KYROlll account.")
    },
    mfa_factor_unenrolled_notification: {
      subject: "A sign-in method was removed from KYROlll",
      content: notification("A SIGN-IN METHOD WAS REMOVED", "A sign-in method was just removed from your KYROlll account.")
    },
    identity_linked_notification: {
      subject: "A new identity was linked to KYROlll",
      content: notification("A NEW IDENTITY WAS LINKED", "A new sign-in identity was just linked to your KYROlll account.")
    },
    identity_unlinked_notification: {
      subject: "An identity was unlinked from KYROlll",
      content: notification("AN IDENTITY WAS UNLINKED", "A sign-in identity was just unlinked from your KYROlll account.")
    }
  };
}

// Every template above stays link-free except the invite, whose link is the
// whole point. Strip the default magic link everywhere else — a code email that
// also carries `{{ .ConfirmationURL }}` is exactly the Supabase clutter the
// storefront does not want.
function assertNoStrayLinks(templates) {
  Object.entries(templates).forEach(([key, template]) => {
    if (key === "invite") return;
    if (template.content.includes("ConfirmationURL")) {
      throw new Error(`Template "${key}" still carries {{ .ConfirmationURL }}; only the invite may ship a link.`);
    }
  });
}

function buildPayload() {
  const templates = buildTemplates();
  assertNoStrayLinks(templates);
  const payload = {};
  Object.entries(templates).forEach(([key, template]) => {
    payload[`mailer_subjects_${key}`] = template.subject;
    payload[`mailer_templates_${key}_content`] = template.content;
  });
  return payload;
}

/* ------------------------------------------------------------------- api */

async function call(path, init) {
  const response = await fetch(API + path, init);
  let data = null;
  const text = await response.text();
  if (text) {
    try { data = JSON.parse(text); } catch (err) { data = text; }
  }
  return { status: response.status, data };
}

function apiError(verb, status, data) {
  const message = (data && (data.message || data.msg || data.error)) || "request failed";
  return new Error(
    `${verb} auth config failed (HTTP ${status}): ${message}` +
    (status === 401 ? " — is SUPABASE_ACCESS_TOKEN valid?" : "") +
    (status === 403 ? " — this endpoint needs the Owner or Administrator role (and/or auth_config_write)." : "")
  );
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error(
    "SUPABASE_ACCESS_TOKEN is required — create a personal access token at " +
    "https://supabase.com/dashboard/account/tokens (Owner or Administrator role)."
  );
  const ref = projectRef();
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const payload = buildPayload();

  const before = await call(`/projects/${ref}/config/auth`, { headers });
  if (before.status !== 200) throw apiError("GET", before.status, before.data);

  // Only send fields that differ, so a re-run is a true no-op.
  const patch = {};
  Object.entries(payload).forEach(([field, value]) => {
    if (String(before.data[field] == null ? "" : before.data[field]) !== String(value)) patch[field] = value;
  });

  if (!Object.keys(patch).length) {
    console.log(`project ${ref}: KYROlll auth emails are already up to date — nothing to change.`);
    return;
  }
  console.log(`project ${ref}: updating ${Object.keys(patch).length} field(s) — ${Object.keys(patch).join(", ")}`);

  const after = await call(`/projects/${ref}/config/auth`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patch)
  });
  if (after.status !== 200) throw apiError("PATCH", after.status, after.data);

  console.log(
    `project ${ref}: installed ${Object.keys(payload).length / 2} branded KYROlll auth email(s). ` +
    "Re-running is idempotent."
  );
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error(String((err && err.message) || err));
    process.exit(1);
  });
}

export { main, buildPayload, buildTemplates };
