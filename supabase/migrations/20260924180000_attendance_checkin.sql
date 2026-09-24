-- Conferência de presença: campos de check-in em reservations, mais uma RPC
-- restrita que só altera esses campos (reservations não tem UPDATE policy
-- hoje por design — atendente não deve editar dados de pagamento).

ALTER TABLE public.reservations
  ADD COLUMN attendance_status text CHECK (attendance_status IN ('present', 'absent')),
  ADD COLUMN checked_in_at timestamptz,
  ADD COLUMN checked_in_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.reservations.attendance_status IS 'Conferência de presença manual pelo atendente: null = ainda não conferido, present = compareceu, absent = não compareceu.';

CREATE OR REPLACE FUNCTION public.set_attendance(p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (has_role(auth.uid(), 'atendente'::app_role) OR has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('present', 'absent') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  UPDATE public.reservations
  SET attendance_status = p_status,
      checked_in_at = CASE WHEN p_status IS NULL THEN NULL ELSE now() END,
      checked_in_by = CASE WHEN p_status IS NULL THEN NULL ELSE auth.uid() END
  WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION public.set_attendance IS 'Marca presença/falta (ou reseta pra null) numa reservation. Único caminho de escrita pra esses campos — evita dar UPDATE geral em reservations pro atendente.';

GRANT EXECUTE ON FUNCTION public.set_attendance(uuid, text) TO authenticated;
