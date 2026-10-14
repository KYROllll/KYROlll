-- KYROlll — diagnose why inserted licenses do not appear on library.html.
--
-- Run these in the Supabase SQL editor (Project → SQL Editor). They are all
-- read-only; the last block only simulates a role inside a rolled-back
-- transaction. Run one numbered block at a time and read its result.
--
-- The library reads the table with the signed-in user's JWT and relies on RLS
-- to scope rows to that user, so a "not showing up" is one of:
--   1. the table does not exist, or the account it was seeded for is not the
--      account that is signed in (a different user_id),
--   2. RLS is enabled with no SELECT policy (the query succeeds but returns
--      zero rows — the classic silent empty library),
--   3. a stale / wrong-project session token, so the request is 401/403,
--   4. a stale PostgREST schema cache right after the table was created,
--   5. the deployed app and the schema are out of sync — the query names a
--      column the table does not have (e.g. the app orders by `created_at`
--      while the table still has `purchased_at`, or vice-versa). That is a
--      Postgres error, so PostgREST answers HTTP 500 **without** the
--      `Access-Control-Allow-Origin` header, and the browser reports it as a
--      CORS failure. The 500 body is invisible to the browser — read it with
--      curl (see the header of AGENTS.md) or the Postgres logs, and use block
--      0 below to see which column names actually exist.
-- Each block below rules one of those out.

-- Replace the email if you are checking a different account.
--   account email = mamadvmatan1@gmail.com


-- ── 0. What columns does the table actually have? The deployed app queries
--         select=*&user_id=eq.<id>&order=created_at.desc
--       and maps `license_type` / `price` / `payment_id` / `status` /
--       `created_at` / `beat_id`. An older build ordered by `purchased_at` and
--       read `tier_id`. If the list below does not contain `created_at` (or
--       still contains `purchased_at`), the app and the schema are on different
--       versions — which is what turns the read into an HTTP 500 (see note 5).
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'licenses'
 order by ordinal_position;


-- ── 1. Does the table exist, is RLS on, and what do the policies/grants allow?
-- (This block never references the table directly, so it also works — and
--  returns table_exists = false — when the table has not been created yet.)
select
  to_regclass('public.licenses') is not null                                   as table_exists,
  (select relrowsecurity from pg_class where oid = to_regclass('public.licenses')) as rls_enabled,
  coalesce(
    (select string_agg(policyname || ' [' || cmd || '] ' || coalesce(qual, ''), ' | ' order by cmd)
       from pg_policies where schemaname = 'public' and tablename = 'licenses'),
    'NO POLICIES — RLS returns zero rows')                                     as policies,
  (select data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'licenses' and column_name = 'user_id')
                                                                               as user_id_type,
  has_table_privilege('authenticated', 'public.licenses', 'select')            as authenticated_can_select,
  has_table_privilege('anon', 'public.licenses', 'select')                     as anon_can_select;


-- ── 2. Is the seeded row attached to the account that is signing in?
-- account_id here must equal the "USER …" shown in the library error banner
-- (or, if you sign in on a different browser, the id the app reports).
-- (Assumes `license_type` exists; if block 0 shows it does not, drop the
--  `tiers_for_account` line.)
select
  (select id from auth.users where email = 'mamadvmatan1@gmail.com')          as account_id,
  (select count(*) from public.licenses l
     where l.user_id = (select id from auth.users where email = 'mamadvmatan1@gmail.com'))
                                                                               as rows_for_account,
  (select count(*) from public.licenses)                                       as rows_total,
  (select string_agg(distinct l.license_type, ', ' order by l.license_type)
     from public.licenses l
     where l.user_id = (select id from auth.users where email = 'mamadvmatan1@gmail.com'))
                                                                               as tiers_for_account;


-- ── 3. What is actually in the table, and who owns it? `to_jsonb(l)` prints
--       whatever columns exist, so this block also runs against the old shape
--       (the named variant underneath only works after migration 0003).
select u.email, to_jsonb(l) as row
  from public.licenses l
  left join auth.users u on u.id = l.user_id;
-- After migration 0003 (new shape):
-- select l.id, l.user_id, u.email, l.beat_id, l.license_type, l.price,
--        l.payment_id, l.status, l.created_at
--   from public.licenses l
--   left join auth.users u on u.id = l.user_id
--  order by l.created_at desc;


-- ── 4. Simulate the signed-in browser: does RLS expose the rows to the
--       `authenticated` role with that account's JWT claims? This is the exact
--       check the library makes. Rolled back, so nothing changes.
begin;
  select set_config('role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',  (select id::text from auth.users where email = 'mamadvmatan1@gmail.com'),
      'role', 'authenticated'
    )::text,
    true
  );
  -- If block 2 says rows_for_account > 0 but this returns 0, it is the policy.
  select count(*) as visible_to_this_account from public.licenses;
rollback;


-- ── 5. If everything above looks right but the app still 404s on the table,
--       the PostgREST schema cache is stale. Reload it (safe, instant):
-- notify pgrst, 'reload schema';

-- ── 6. If block 1 shows RLS on with no (or a wrong) policy, this installs the
--       SELECT-only owner policy `migrations/0003_licenses_webhook.sql`
--       documents. There is deliberately NO insert policy: the only writer is
--       the nowpayments-webhook Edge Function, using the service_role key.
-- alter table public.licenses enable row level security;
-- drop policy if exists "read own licenses" on public.licenses;
-- create policy "read own licenses" on public.licenses
--   for select to authenticated using (auth.uid() = user_id);
