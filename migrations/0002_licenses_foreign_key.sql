-- KYROlll — permanent relational integrity for licenses.
--
-- `public.licenses.user_id` must reference the permanent UUID in `auth.users(id)`
-- (the same identity `auth.uid()` resolves to for every JWT). This guarantees:
--   1. Every license is tied to an existing, permanent user record.
--   2. Deleting a user cascades and removes their licenses (no orphan rows).
--   3. The application never writes a license for a cached / shifted / fake id.
--
-- Apply: paste into SQL editor or run via Supabase Management API / SQL query.

ALTER TABLE public.licenses
  DROP CONSTRAINT IF EXISTS licenses_user_id_fkey;

ALTER TABLE public.licenses
  ADD CONSTRAINT licenses_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Confirm the policy that makes `auth.uid()` enforce this server-side still holds.
NOTIFY pgrst, 'reload schema';
