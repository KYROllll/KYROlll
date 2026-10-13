/* Tests for set-auth-email-templates.mjs — PATCHes the Supabase Management API
 * auth config with the branded, link-free KYROlll email templates. Runs without
 * network: fetch is stubbed. Not meant to touch the live project.
 */
import test from "node:test";
import assert from "node:assert/strict";

function importScript() {
  delete process.env.SUPABASE_ACCESS_TOKEN;
  delete process.env.SUPPORT_EMAIL;
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
  assert.match(magic, /#080809/, "uses the KYROlll page background");
  assert.match(magic, /ONE-TIME CODE/);
  assert.doesNotMatch(magic, /ConfirmationURL/, "no stray Supabase magic link");
  assert.doesNotMatch(magic, /Supabase/i, "no Supabase branding");
  assert.doesNotMatch(magic, /localhost:3000/, "no placeholder site URL");
  assert.doesNotMatch(magic, /\{\{ \.SiteURL \}\}\/auth/, "no GoTrue callback path");

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
