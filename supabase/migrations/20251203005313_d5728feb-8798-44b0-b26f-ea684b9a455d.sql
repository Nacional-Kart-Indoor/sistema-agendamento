
-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Anyone can create reservations" ON public.reservations;

-- Create a PERMISSIVE policy for INSERT (default is permissive)
CREATE POLICY "Anyone can create reservations" 
ON public.reservations 
FOR INSERT 
TO public
WITH CHECK (true);
