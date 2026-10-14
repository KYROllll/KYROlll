-- KYROlll — close the public SELECT on `licenses`.
--
-- Why this exists: `public.licenses` must be readable only by the buyer who
-- owns the row. `migrations/0003_licenses_webhook.sql` installs that owner-only
-- SELECT policy, but it can be undone after the fact — a permissive policy added
-- from the dashboard (e.g. "Allow global secure license read"), a permissive
-- hand-written policy, or RLS left disabled. Any of those make the table
-- world-readable, and the anon/publishable key ships in the browser, so
-- `GET /rest/v1/licenses?select=*` with that key then returns EVERY customer's
-- license rows.
--
-- This migration is deliberately NON-destructive: unlike 0003 it never drops or
-- recreates the table, so it is safe to run against a live project that already
-- holds licenses. 0003 drops the table (and every row in it) and must not be
-- re-run for a policy fix.
--
-- It is also name-agnostic: rather than guess the permissive policy's name, it
-- drops EVERY policy currently on the table and installs exactly one. A
-- permissive policy this file does not know about therefore cannot survive.
--
-- Apply either way:
--   SUPABASE_ACCESS_TOKEN=… node set-licenses-policy.mjs
--     MIGRATION=migrations/0004_licenses_owner_only_select.sql
--   …or paste this whole file into the SQL editor
--   https://supabase.com/dashboard/project/vuryglxywrqdnvnbelvp/sql/new
--
-- Verify afterwards with the publishable key ONLY (no bearer): the read must
-- come back `200 []` (RLS filters everything), never a list of rows.

-- --------------------------------------------------------------- security ---
-- RLS on. (If it was left disabled, this is the whole fix on its own.)
alter table public.licenses enable row level security;

-- Drop every policy on the table, whatever its name — the dashboard's
-- "Allow global secure license read" / "Enable read access for all users", an
-- old "own licenses", the correct "read own licenses" from 0003, anything.
do $$
declare
  p record;
begin
  for p in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'licenses'
  loop
    execute format('drop policy if exists %I on public.licenses', p.policyname);
  end loop;
end $$;

-- The only policy: the owner may read their own rows. `to authenticated` keeps
-- anonymous callers out of the policy entirely — their `auth.uid()` is null, so
-- even if a grant exists, RLS matches no row and the read returns zero rows.
create policy "read own licenses" on public.licenses
  for select to authenticated
  using (auth.uid() = user_id);

-- Deliberately NO insert/update/delete policy for `authenticated`: the only
-- writer is the `nowpayments-webhook` Edge Function (service_role bypasses RLS).
-- A frontend insert policy would let the storefront mint its own licenses.
grant select on public.licenses to authenticated;
