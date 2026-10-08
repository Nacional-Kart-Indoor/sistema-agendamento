-- Reservas pagas ANTES da trava existir: os efeitos já rodaram pelo webhook
-- antigo (todas têm reservation_code). Sem isto o reconciliation-check as veria
-- como "não processadas" e reenviaria WhatsApp/SellFlux a clientes antigos.
-- Altera dados: só preenche post_payment_claimed_at onde está NULL.
UPDATE public.reservations
SET post_payment_claimed_at = updated_at
WHERE status = 'paid'
  AND reservation_code IS NOT NULL
  AND post_payment_claimed_at IS NULL;
