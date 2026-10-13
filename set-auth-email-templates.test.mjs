/* Tests for set-auth-email-templates.mjs — PATCHes the Supabase Management API
 * auth config with the branded, link-free KYROlll email templates. Runs without
 * network: fetch is stubbed. Not meant to touch the live project.
 */
import test from "node:test";
import assert from "node:assert/strict";

function importScript() {
  delete process.env.SUPABASE_ACCESS_TOKEN;
  delete process.env.SUPPORT_EMAIL;
  delete process.env.ASSET_BASE;
  return import("./set-auth-email-templates.mjs");
}

test("refuses to run without a management token", async () => {
  const { main } = await importScript();
  await assert.rejects(main(), /SUPABASE_ACCESS_TOKEN is required/);
});

test("installs dark, code-only KYROlll templates with branded subjects", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const method = (init && init.method) || "GET";
    return {
      status: 200,
      text: async () => JSON.stringify(method === "PATCH" ? {} : {})
    };
  };

  const { main, buildPayload } = await importScript();
  process.env.SUPABASE_ACCESS_TOKEN = "sb_pat_test";
  await main();

  assert.equal(calls.length, 2, "one GET then one PATCH");
  const [get, patch] = calls;
  assert.equal(get.init.method, undefined, "first call is a GET");
  assert.match(get.url, /\/v1\/projects\/vuryglxywrqdnvnbelvp\/config\/auth$/);
  assert.equal(patch.init.method, "PATCH");
  assert.equal(patch.init.headers.Authorization, "Bearer sb_pat_test");

  const body = JSON.parse(patch.init.body);

  // The sign-in code — the email the storefront actually triggers.
  assert.equal(body.mailer_subjects_magic_link, "Your KYROlll sign-in code");
  const magic = body.mailer_templates_magic_link_content;
  assert.match(magic, /\{\{ \.Token \}\}/, "shows the one-time code");
  assert.match(magic, /#050505/, "uses the pure-black page background");
  assert.match(magic, /ONE-TIME CODE/);
  assert.doesNotMatch(magic, /ConfirmationURL/, "no stray Supabase magic link");
  assert.doesNotMatch(magic, /Supabase/i, "no Supabase branding");
  assert.doesNotMatch(magic, /localhost:3000/, "no placeholder site URL");
  assert.doesNotMatch(magic, /\{\{ \.SiteURL \}\}\/auth/, "no GoTrue callback path");

  // The pure-black canvas is forced at every layer a light-mode client could
  // repaint or wrap in white: wrapper, body, container and the page itself.
  assert.match(magic, /<html[^>]+style="background-color:#050505 !important;"/, "inline background on <html>");
  assert.match(magic, /<body[^>]+bgcolor="#050505"/, "bgcolor on <body> for clients that drop CSS");
  assert.match(magic, /color-scheme:\s*dark only/, "pins the scheme in CSS");
  assert.match(magic, /@media \(prefers-color-scheme: light\)\s*\{[^}]*background-color:\s*#050505\s*!important/, "re-asserts black inside the light query");
  assert.match(magic, /max-width:520px;background-color:#050505 !important/, "the content container is pure black too");
  assert.match(magic, /\[data-ogsc\][^{]*\.kyro-panel[^{]*\{[^}]*#050505\s*!important/, "Outlook.com dark-mode hook repaints the container");
  assert.doesNotMatch(magic, /background-color:\s*#(?:fff|ffffff)\s*!important/i, "no forced white surface");
  assert.doesNotMatch(magic, /#080809|#101012/, "the old lighter page/panel greys are gone");

  // No-white-flash: the parser paints attributes before it applies <style>, so
  // every structural table and cell in every template must carry its own
  // background, both as a bgcolor attribute and as an inline `!important`
  // background. (The button lives only in the invite template, hence checking
  // the whole payload rather than just the sign-in mail.)
  assert.match(magic, /<td class="kyro-page"[^>]*bgcolor="#050505"/, "the outer gutter cell is black");
  let tableCount = 0;
  let cellCount = 0;
  Object.entries(buildPayload()).forEach(([field, value]) => {
    if (!field.startsWith("mailer_templates_")) return;
    (value.match(/<table[^>]*>/g) || []).forEach((t) => {
      tableCount += 1;
      assert.match(t, /bgcolor="#[0-9a-f]{6}"/i, `${field}: table without a bgcolor fallback: ${t}`);
      assert.match(t, /background-color:\s*#[0-9a-f]{6}\s*!important/i, `${field}: table without an inline !important background: ${t}`);
    });
    (value.match(/<td[^>]*>/g) || []).forEach((c) => {
      cellCount += 1;
      assert.match(c, /bgcolor="#[0-9a-f]{6}"/i, `${field}: cell without a bgcolor fallback: ${c}`);
    });
  });
  assert.ok(tableCount >= 4, "the wrapper/panel/logo/button tables are all covered");
  assert.ok(cellCount >= 5, "the structural cells are all covered");

  // The header opens on the storefront's own 3D flower, not a text wordmark.
  assert.match(magic, /<img[^>]+src="https:\/\/[^"]+\/assets\/kyrolll-flower-rest\.png"/, "linked 3D flower logo on a public host");
  assert.match(magic, /alt="KYROlll"/, "alt text keeps the brand readable with images off");
  assert.match(magic, /href="\{\{ \.SiteURL \}\}"/, "logo still links to the site");
  assert.doesNotMatch(magic, />KYROlll<\/a>/, "the plain-text wordmark is gone");

  // Every field the Management API accepts is present.
  ["confirmation", "recovery", "email_change", "reauthentication", "invite",
    "password_changed_notification", "email_changed_notification",
    "phone_changed_notification", "mfa_factor_enrolled_notification",
    "mfa_factor_unenrolled_notification", "identity_linked_notification",
    "identity_unlinked_notification"].forEach((key) => {
    assert.ok(body[`mailer_subjects_${key}`], `subject for ${key}`);
    assert.ok(body[`mailer_templates_${key}_content`], `template for ${key}`);
  });

  // The invite is the one flow whose link IS the action.
  assert.match(body.mailer_templates_invite_content, /ConfirmationURL/);

  // Nothing but the invite carries a link; buildPayload() enforces this.
  Object.entries(buildPayload()).forEach(([field, value]) => {
    if (field.startsWith("mailer_templates_") && !field.includes("invite")) {
      assert.doesNotMatch(value, /ConfirmationURL/, `${field} must be link-free`);
    }
  });

  delete globalThis.fetch;
});

test("is idempotent: a matching project gets no PATCH", async () => {
  const { main, buildPayload } = await importScript();
  process.env.SUPABASE_ACCESS_TOKEN = "sb_pat_test";

  // Pretend the project already holds exactly what we would write.
  const already = buildPayload();
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { status: 200, text: async () => JSON.stringify(already) };
  };

  await main();
  assert.equal(calls.length, 1, "only the GET, no PATCH");
  assert.equal(calls[0].init.method, undefined);

  delete globalThis.fetch;
});

test("surfaces the API error with role guidance on a 403", async () => {
  globalThis.fetch = async () => ({
    status: 403,
    text: async () => JSON.stringify({ message: "forbidden" })
  });
  const { main } = await importScript();
  process.env.SUPABASE_ACCESS_TOKEN = "sb_pat_test";
  await assert.rejects(main(), /Owner or Administrator/);
  delete globalThis.fetch;
});

test("honours ASSET_BASE for the logo host (fork on another domain)", async () => {
  const { buildPayload } = await importScript();
  process.env.ASSET_BASE = "https://staging.example.com/";
  const magic = buildPayload().mailer_templates_magic_link_content;
  assert.match(
    magic,
    /src="https:\/\/staging\.example\.com\/assets\/kyrolll-flower-rest\.png"/,
    "trailing slash is trimmed and the override wins"
  );
  delete process.env.ASSET_BASE;
});
