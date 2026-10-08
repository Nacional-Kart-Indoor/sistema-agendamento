-- Efeitos pós-pagamento idempotentes (código, SellFlux, WhatsApp, Meta),
-- independentes de quem marcou a reserva como paga (asaas-webhook ou
-- verify-asaas-payment). Só ADD COLUMN nullable + função; não altera dados
-- existentes: reservas pagas antes daqui ficam com paid_at NULL e ficam de fora.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS post_payment_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_client_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sellflux_lead_id TEXT,
  ADD COLUMN IF NOT EXISTS sellflux_schedule_id TEXT,
  ADD COLUMN IF NOT EXISTS sellflux_status TEXT
    CONSTRAINT reservations_sellflux_status_check CHECK (sellflux_status IN ('ok', 'falhou', 'pendente'));

COMMENT ON COLUMN public.reservations.paid_at IS 'Quando virou paid (preenchido por mark_reservation_paid). Reservas pagas antes desta migration ficam NULL e nunca reexecutam efeitos';
COMMENT ON COLUMN public.reservations.post_payment_claimed_at IS 'Trava dos efeitos pós-pagamento: quem grava primeiro executa, os demais viram no-op';
COMMENT ON COLUMN public.reservations.whatsapp_client_sent_at IS 'Quando a confirmação foi enviada ao cliente pelo WhatsApp';
COMMENT ON COLUMN public.reservations.sellflux_status IS 'ok | falhou | pendente — falhou/pendente geram alerta em reconciliation_alerts';

-- Marca a reserva como paga (com paid_at) e preenche reservation_code /
-- pilotos_token só se ainda estiverem vazios (não troca código nem link de pilotos).
-- Retorna se houve transição para paid e o código final.
CREATE OR REPLACE FUNCTION public.mark_reservation_paid(
  p_reservation_id UUID,
  p_payment_id TEXT,
  p_payment_method TEXT,
  p_reservation_code TEXT,
  p_pilotos_token TEXT
)
RETURNS TABLE (transitioned BOOLEAN, reservation_code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_prev_status reservation_status;
  v_code TEXT;
BEGIN
  SELECT r.status, r.reservation_code INTO v_prev_status, v_code
  FROM reservations r
  WHERE r.id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Já paga: não mexe em nada (inclusive nas reservas pagas antes desta
  -- migration). Só devolve o código existente.
  IF v_prev_status = 'paid' THEN
    RETURN QUERY SELECT false, v_code;
    RETURN;
  END IF;

  UPDATE reservations r SET
    status = 'paid',
    paid_at = now(),
    payment_id = COALESCE(p_payment_id, r.payment_id),
    payment_method = COALESCE(p_payment_method, r.payment_method, 'asaas'),
    reservation_code = COALESCE(r.reservation_code, p_reservation_code),
    pilotos_token = CASE WHEN r.num_pilots > 1 THEN COALESCE(r.pilotos_token, p_pilotos_token) ELSE r.pilotos_token END
  WHERE r.id = p_reservation_id
  RETURNING r.reservation_code INTO v_code;

  RETURN QUERY SELECT true, v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_reservation_paid(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_reservation_paid(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
