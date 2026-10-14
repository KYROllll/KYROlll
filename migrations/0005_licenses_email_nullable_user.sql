-- KYROlll — licenses for an account-less checkout.
--
-- The store no longer has Supabase Auth: a visitor buys with an optional email
-- address, so a license row can no longer be tied to `auth.users(id)`. This
-- migration is NON-destructive — it never drops the table or its rows — and
-- reshapes it for that flow:
--
--   * `user_id` becomes NULLABLE. It stays for the historical rows that already
--     carry one; new rows simply leave it empty.
--   * the `user_id → auth.users(id)` foreign key is dropped (that constraint is
--     what makes a user-less row impossible).
--   * a nullable `email` column is added, so the address the buyer typed — or
--     the one NOWPayments collected — is kept on the row for support.
--
-- It then removes every RLS policy on `licenses` (they all keyed off
-- `auth.uid()`, which is always null now that no page signs in) and leaves the
-- table with RLS ON and NO policy: the publishable key reads zero rows, and the
-- only writer remains the `nowpayments-webhook` Edge Function (service_role,
-- which bypasses RLS). `public.beats` stays publicly readable so the catalog
-- and the checkout's beat lookup keep working.
--
-- Apply either way:
--   MIGRATION=migrations/0005_licenses_email_nullable_user.sql \
--     SUPABASE_ACCESS_TOKEN=… node set-licenses-policy.mjs
--   …or paste this whole file into the SQL editor
--   https://supabase.com/dashboard/project/vuryglxywrqdnvnbelvp/sql/new

-- ------------------------------------------------------------- licenses shape
alter table public.licenses add column if not exists email text;
alter table public.licenses alter column user_id drop not null;

-- Drop any foreign key on `licenses` that points at `auth.users`. The original
-- constraint is named `licenses_user_id_fkey`, but enumerate them by target so a
-- renamed one cannot survive and re-impose the auth.users dependency.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.licenses'::regclass
       and contype = 'f'
       and confrelid = 'auth.users'::regclass
  loop
    execute format('alter table public.licenses drop constraint %I', c.conname);
  end loop;
end $$;

-- ------------------------------------------------------------------- licenses
-- No `auth.uid()` policy remains. Drop EVERY policy on the table, then leave RLS
-- on with none: the anon/publishable key (which ships in the browser) reads zero
-- rows, never every customer's licenses.
alter table public.licenses enable row level security;

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

-- --------------------------------------------------------------------- beats
-- The catalog is shared, public data: keep it world-readable so the storefront
-- and `create-payment` (anon key) can resolve a beat uuid.
alter table public.beats enable row level security;

drop policy if exists "beats are public" on public.beats;
create policy "beats are public" on public.beats
  for select to anon, authenticated
  using (true);

grant select on public.beats to anon, authenticated;
