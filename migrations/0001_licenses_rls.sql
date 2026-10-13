-- KYROlll — `licenses` row level security: owners may read (and write) only
-- their own rows.
--
-- The library page reads `licenses` with the signed-in user's JWT and expects
-- to see exactly their own rows. `account.js` sends
--   GET /rest/v1/licenses?select=*&user_id=eq.<id>&order=purchased_at.desc
-- and RLS is the other half of that filter. This matters because of how RLS
-- fails closed *silently*: with RLS enabled and no matching policy, Postgres
-- returns zero rows and no error, so inserted licenses never appear and the
-- library just looks empty. Enabling RLS *and* creating this policy is what
-- makes `auth.uid() = user_id` true for the signed-in buyer.
--
-- Idempotent: drop-then-create, so re-running it — or re-running the block in
-- AGENTS.md — never stacks duplicate policies.
--
-- Apply either way:
--   SUPABASE_ACCESS_TOKEN=… node set-licenses-policy.mjs
-- or paste this whole file into the SQL editor
--   https://supabase.com/dashboard/project/vuryglxywrqdnvnbelvp/sql/new

alter table public.licenses enable row level security;

-- `for all` is what grants SELECT, and the INSERT a checkout makes. `using`
-- scopes reads; `with check` scopes writes, so a buyer can never see or create a
-- license that is not theirs. `to authenticated` keeps anonymous callers (who
-- have no `auth.uid()`) out of the policy entirely.
drop policy if exists "own licenses" on public.licenses;
create policy "own licenses" on public.licenses
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- If you would rather the read grant be its own explicit SELECT policy, use
-- these two instead of the `for all` policy above:
--
--   drop policy if exists "read own licenses" on public.licenses;
--   create policy "read own licenses" on public.licenses
--     for select to authenticated using (auth.uid() = user_id);
--   drop policy if exists "insert own licenses" on public.licenses;
--   create policy "insert own licenses" on public.licenses
--     for insert to authenticated with check (auth.uid() = user_id);

-- PostgREST caches the schema; nudge it so the new policy is live immediately.
notify pgrst, 'reload schema';
