// Table-based, inline-styled shell shared by receipts and notifications.
// Raster artwork works in clients that strip SVG, CSS backgrounds, or animation.
export const SITE_URL = "https://www.kencarter.abrdns.com";
export const LOGO_URL = `${SITE_URL}/assets/kyrolll-flower.jpg`;
const DOODLE_URL = `${SITE_URL}/assets/kyrolll-email-doodles.png`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function brandedEmailHtml({ title, eyebrow, subtitle, content }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)} — KYROlll</title>
<style>body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%}table{border-collapse:collapse}a{overflow-wrap:anywhere}@media only screen and (max-width:480px){.brand-pad{padding-left:18px!important;padding-right:18px!important}.brand-title{font-size:28px!important}}</style>
</head><body style="margin:0;padding:0;background-color:#e7e1d6;color:#1c1b18;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">KYROlll — ${escapeHtml(title)}. ${escapeHtml(subtitle || "Original sound. Limited editions.")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#e7e1d6"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f1ea" style="width:100%;max-width:600px;background-color:#f4f1ea;border:1px solid #d5cec2;">
<tr><td align="center" bgcolor="#1c1b18" style="padding:12px;color:#f4f1ea;font-size:9px;letter-spacing:3px;">INDEPENDENT SOUND / KYROlll</td></tr>
<tr><td align="center" style="padding:32px 20px 20px;">
<a href="${SITE_URL}" style="text-decoration:none;color:#1c1b18;"><img src="${LOGO_URL}" width="100" height="100" alt="KYROlll silver flower" style="display:block;width:100px;height:100px;border:0;"></a>
<p style="margin:14px 0 0;color:#1c1b18;font-size:40px;font-weight:500;letter-spacing:-3px;line-height:1.1;">KYROlll</p>
<p style="margin:9px 0 0;color:#71695e;font-family:Georgia,'Times New Roman',serif;font-size:15px;font-style:italic;">Original sound. Limited editions.</p>
</td></tr>
<tr><td align="center" bgcolor="#1c1b18"><img src="${DOODLE_URL}" width="600" height="76" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>
<tr><td align="center" class="brand-pad" style="padding:32px 30px 0;">
<p style="margin:0 0 12px;color:#71695e;font-size:9px;font-weight:700;letter-spacing:2.5px;">${escapeHtml(eyebrow || "KYROlll / STUDIO NOTES")}</p>
<h1 class="brand-title" style="margin:0;color:#1c1b18;font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:1.2;font-weight:400;">${escapeHtml(title)}</h1>
<p style="margin:12px 0 0;color:#71695e;font-size:11px;line-height:1.7;letter-spacing:.5px;">${escapeHtml(subtitle || "")}</p>
</td></tr>
<tr><td class="brand-pad" style="padding:26px 30px 34px;color:#1c1b18;font-size:14px;line-height:1.7;">${content}</td></tr>
<tr><td align="center" bgcolor="#1c1b18" style="padding:26px 20px;color:#f4f1ea;">
<p style="margin:0 0 12px;font-size:10px;letter-spacing:2px;">KYROlll — ALL RIGHTS RESERVED</p>
<a href="${SITE_URL}" style="color:#f4f1ea;font-size:11px;text-decoration:underline;letter-spacing:1px;">EXPLORE THE STORE &rarr;</a>
</td></tr></table></td></tr></table></body></html>`;
}
