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
--   4. a stale PostgREST schema cache right after the table was created.
-- Each block below rules one of those out.

-- Replace the email if you are checking a different account.
--   account email = mamadovmatan1@gmail.com


-- ── 1. Does the table exist, is RLS on, and what do the policies/grants allow?
-- (This block never references the table directly, so it also works — and
--  returns table_exists = false — when the table has not been created yet.)
select
  to_regclass('public.licenses') is not null                                   as table_exists,
  (select relrowsecurity from pg_class where oid = to_regclass('public.licenses')) as rls_enabled,
  coalesce(
    (select string_agg(policyname || ' [' || cmd || ']', ' | ' order by cmd)
       from pg_policies where schemaname = 'public' and tablename = 'licenses'),
    'NO POLICIES — RLS returns zero rows')                                     as policies,
  has_table_privilege('authenticated', 'public.licenses', 'select')            as authenticated_can_select,
  has_table_privilege('anon', 'public.licenses', 'select')                     as anon_can_select;


-- ── 2. Is the seeded row attached to the account that is signing in?
-- account_id here must equal the "USER …" shown in the library error banner
-- (or, if you sign in on a different browser, the id the app reports).
select
  (select id from auth.users where email = 'mamadovmatan1@gmail.com')          as account_id,
  (select count(*) from public.licenses l
     where l.user_id = (select id from auth.users where email = 'mamadovmatan1@gmail.com'))
                                                                               as rows_for_account,
  (select count(*) from public.licenses)                                       as rows_total,
  (select string_agg(distinct l.tier_id, ', ' order by l.tier_id)
     from public.licenses l
     where l.user_id = (select id from auth.users where email = 'mamadovmatan1@gmail.com'))
                                                                               as tiers_for_account;


-- ── 3. What is actually in the table, and who owns it?
select l.id, l.user_id, u.email, l.beat_id, l.tier_id, l.tier, l.price, l.purchased_at
  from public.licenses l
  left join auth.users u on u.id = l.user_id
 order by l.purchased_at desc;


-- ── 4. Simulate the signed-in browser: does RLS expose the rows to the
--       `authenticated` role with that account's JWT claims? This is the exact
--       check the library makes. Rolled back, so nothing changes.
begin;
  select set_config('role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',  (select id::text from auth.users where email = 'mamadovmatan1@gmail.com'),
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

-- ── 6. If block 1 shows RLS on with no (or a wrong) policy, this creates the
--       owner-only policy the README documents. Safe to re-run.
-- alter table public.licenses enable row level security;
-- drop policy if exists "own licenses" on public.licenses;
-- create policy "own licenses" on public.licenses
--   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
