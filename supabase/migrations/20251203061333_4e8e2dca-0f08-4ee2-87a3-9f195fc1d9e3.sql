-- Drop all existing policies on reservations
DROP POLICY IF EXISTS "Anyone can create reservations" ON public.reservations;

-- Recreate with explicit public schema and simpler syntax
CREATE POLICY "allow_public_insert_reservations" 
ON public.reservations 
AS PERMISSIVE
FOR INSERT 
TO public
WITH CHECK (true);