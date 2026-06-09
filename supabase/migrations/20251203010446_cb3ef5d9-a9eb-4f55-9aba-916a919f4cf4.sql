-- Drop the existing policy
DROP POLICY IF EXISTS "Anyone can create reservations" ON public.reservations;

-- Create a PERMISSIVE policy for INSERT that works with anon role
CREATE POLICY "Anyone can create reservations" 
ON public.reservations 
FOR INSERT 
TO anon, authenticated
WITH CHECK (true);