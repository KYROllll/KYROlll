-- KYROlll — `beats` reference table + the payment-shaped `licenses` table.
--
-- Ordering: this is 0003, after `0001_licenses_rls.sql` (the original license
-- table) and `0002_licenses_foreign_key.sql` (which pinned
-- `licenses.user_id` to `auth.users(id)`). It replaces the original `licenses`
-- shape from `migrations/0001_licenses_rls.sql` (text `beat_id`, `tier_id`,
-- `beat_title`, `purchased_at`, owner-writable) with the shape the NOWPayments
-- flow needs — including the `user_id → auth.users(id)` foreign key that 0002
-- added, now declared inline on the recreated table:
--
--   * `beat_id` is now a real uuid that references `public.beats(id)`, so a
--     license can only ever point at a beat that exists (the storefront's
--     catalog carries the same uuid — see `catalog.js`).
--   * `license_type` / `price` / `payment_id` / `status` / `created_at` replace
--     the old tier columns, and `payment_id` carries the NOWPayments id.
--   * The ONLY policy is SELECT where `auth.uid() = user_id`. There is no
--     INSERT/UPDATE/DELETE policy: authenticated buyers can read their rows and
--     nothing else, and every row is written by the `nowpayments-webhook` Edge
--     Function with the service_role key (which bypasses RLS).
--
-- !! DESTRUCTIVE: the `licenses` table is dropped and recreated because the old
--    column shape cannot be migrated in place. Export it first if it holds rows
--    you care about:
--      copy (select * from public.licenses) to stdout with csv header;
--
-- Idempotent: the beats seed is `on conflict do nothing`, the policies are
-- drop-then-create, and the licenses table is recreated from scratch, so
-- re-running this file always lands on the same schema.
--
-- Apply either way:
--   SUPABASE_ACCESS_TOKEN=… node set-licenses-policy.mjs
-- or paste this whole file into the SQL editor
--   https://supabase.com/dashboard/project/vuryglxywrqdnvnbelvp/sql/new
--
-- (`gen_random_uuid()` ships with every Supabase project — no extension needed.)

-- ---------------------------------------------------------------- beats -----
-- The catalog's beat ids are uuids, and `licenses.beat_id` references this
-- table, so the beat has to exist before a license can point at it. The slug is
-- kept as the stable human handle (old `?beat=flesh` links resolve through it).
create table if not exists public.beats (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  created_at timestamptz not null default now()
);

-- The catalog is public reference data; the storefront only ever reads it.
alter table public.beats enable row level security;
drop policy if exists "beats are public" on public.beats;
create policy "beats are public" on public.beats
  for select to anon, authenticated using (true);
grant select on public.beats to anon, authenticated;

-- Seed the beat the storefront ships with. The uuid below is the SAME uuid in
-- `catalog.js` (the `flesh` entry's `id`); keep the two in step. `on conflict`
-- is on `slug` so re-running never rewrites the id or duplicates the row.
insert into public.beats (id, slug, title) values
  ('6c56eda2-df4a-45b0-b9b7-68f8efdbb1af', 'flesh', '[FREE] DON TOLIVER TYPE BEAT - FLESH')
on conflict (slug) do nothing;

-- -------------------------------------------------------------- licenses ----
drop table if exists public.licenses cascade;

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  beat_id uuid not null references public.beats(id) on delete restrict,
  license_type text not null check (license_type in ('mp3', 'wav', 'exclusive')),
  price numeric(10, 2) not null check (price >= 0),
  -- NOWPayments payment id. Unique on purpose: the IPN can be retried, and the
  -- webhook's `ON CONFLICT DO NOTHING` turns a retry into a no-op instead of a
  -- second license.
  payment_id text unique,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

-- The library reads "this user's rows, newest first".
create index if not exists licenses_user_id_created_at_idx
  on public.licenses (user_id, created_at desc);

-- --------------------------------------------------------------- security ---
alter table public.licenses enable row level security;

-- SELECT only, and only the owner's rows. `to authenticated` keeps anonymous
-- callers (whose `auth.uid()` is null) out of the policy entirely.
drop policy if exists "read own licenses" on public.licenses;
create policy "read own licenses" on public.licenses
  for select to authenticated
  using (auth.uid() = user_id);

-- Deliberately NO insert/update/delete policy for `authenticated`. The webhook
-- is the single writer (service_role bypasses RLS). If a frontend insert policy
-- is ever added back, the storefront would be able to mint its own licenses.
grant select on public.licenses to authenticated;

-- PostgREST caches the schema; nudge it so the new shape is live immediately.
notify pgrst, 'reload schema';
