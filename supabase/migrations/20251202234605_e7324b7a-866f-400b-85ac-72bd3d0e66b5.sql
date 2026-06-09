-- Fix 1: Remove overly permissive RLS policies on reservations table
-- The webhooks use service role key which bypasses RLS, so they'll continue to work

-- Drop the permissive SELECT policy (exposes all customer PII)
DROP POLICY IF EXISTS "Reservations viewable by email" ON public.reservations;

-- Drop the permissive UPDATE policy (allows anyone to modify reservations)
DROP POLICY IF EXISTS "Reservations can be updated" ON public.reservations;

-- Keep the INSERT policy as-is since users need to create reservations
-- The service role key used by webhooks will bypass RLS for updates