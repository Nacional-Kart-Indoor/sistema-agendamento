-- Adicionar política SELECT para a tabela reservations
CREATE POLICY "allow_select_reservations" 
ON public.reservations 
AS PERMISSIVE
FOR SELECT 
TO anon, authenticated
USING (true);