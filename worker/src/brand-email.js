// Inline styles + presentation tables survive clients that strip CSS or SVG.
// The PDF emitter needs JPEG; emails use the transparent die-cut PNG.
export const SITE_URL = "https://www.kencarter.abrdns.com";
export const LOGO_URL = `${SITE_URL}/assets/kyrolll-social.jpg`;
export const EMAIL_LOGO_URL = `${SITE_URL}/assets/kyrolll-metal.png`;
const DOODLE_URL = `${SITE_URL}/assets/kyrolll-email-doodles.png`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function brandedEmailHtml({ title, eyebrow, subtitle, content }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(title)} — KYROlll</title>
<style>:root{color-scheme:dark}body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%}table{border-collapse:collapse}img{border:0;outline:none}a{overflow-wrap:anywhere}@media only screen and (max-width:480px){.brand-pad{padding-left:20px!important;padding-right:20px!important}.brand-title{font-size:32px!important}.brand-wordmark{font-size:56px!important}}</style>
</head><body style="margin:0;padding:0;background-color:#080809;color:#f3f3f1;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">KYROlll — ${escapeHtml(title)} ${escapeHtml(subtitle || "Sound from the underground.")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#080809"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#101012" style="width:100%;max-width:600px;background-color:#101012;border:1px solid #38383e;">
<tr><td class="brand-pad" bgcolor="#080809" style="padding:16px 32px;border-bottom:1px solid #38383e;color:#a4a4aa;font-family:Consolas,'Courier New',monospace;font-size:9px;letter-spacing:2px;">INDEPENDENT SOUND &nbsp;/&nbsp; OFFICIAL KYROlll STORE</td></tr>
<tr><td align="center" bgcolor="#080809" style="padding:32px 20px 26px;">
<a href="${SITE_URL}" style="text-decoration:none;color:#f3f3f1;"><img src="${EMAIL_LOGO_URL}" width="148" height="148" alt="KYROlll — custom-cut silver flower" style="display:block;width:148px;height:148px;border:0;"></a>
<p class="brand-wordmark" style="margin:16px 0 0;color:#f3f3f1;font-size:72px;font-weight:900;letter-spacing:-5px;line-height:1;">KYROlll<span style="font-size:30px;vertical-align:top;letter-spacing:0;">✳</span></p>
<p style="margin:14px 0 0;color:#a4a4aa;font-family:Consolas,'Courier New',monospace;font-size:9px;letter-spacing:2px;line-height:1.7;">SOUND FROM THE UNDERGROUND.</p>
</td></tr>
<tr><td align="center" bgcolor="#080809" style="border-bottom:1px solid #38383e;"><img src="${DOODLE_URL}" width="600" height="76" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>
<tr><td class="brand-pad" style="padding:32px 32px 0;">
<p style="margin:0 0 16px;color:#bcbcc3;font-family:Consolas,'Courier New',monospace;font-size:9px;font-weight:700;letter-spacing:2px;">${escapeHtml(eyebrow || "KYROlll / TRANSMISSIONS")}</p>
<h1 class="brand-title" style="margin:0;color:#f3f3f1;font-size:44px;line-height:1;font-weight:900;letter-spacing:-2px;text-transform:uppercase;">${escapeHtml(title)}</h1>
<p style="margin:16px 0 0;color:#a4a4aa;font-size:12px;line-height:1.8;">${escapeHtml(subtitle || "")}</p>
</td></tr>
<tr><td class="brand-pad" style="padding:24px 32px 36px;color:#f3f3f1;font-size:13px;line-height:1.8;overflow-wrap:anywhere;">${content}</td></tr>
<tr><td class="brand-pad" bgcolor="#080809" style="padding:26px 32px;color:#f3f3f1;border-top:1px solid #38383e;">
<p style="margin:0 0 18px;font-size:20px;font-weight:900;letter-spacing:-.7px;">MAKE SOMETHING THEY CAN'T IGNORE.</p>
<a href="${SITE_URL}" style="color:#f3f3f1;font-size:10px;font-weight:700;text-decoration:underline;letter-spacing:1px;">BACK TO THE SOUND ARCHIVE &rarr;</a>
<p style="margin:24px 0 0;color:#a4a4aa;font-family:Consolas,'Courier New',monospace;font-size:8px;letter-spacing:1px;">KYROlll / ORIGINAL PRODUCTION / ALL RIGHTS RESERVED</p>
</td></tr></table></td></tr></table></body></html>`;
}
