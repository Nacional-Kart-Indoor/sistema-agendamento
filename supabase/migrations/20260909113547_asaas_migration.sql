-- ============================================
-- Migração Stripe -> Asaas
-- ============================================
-- Formaliza no repo colunas que já existem em produção (criadas fora de
-- migration ao longo do tempo) e adiciona o que é novo para a Asaas.
-- Tudo idempotente (IF NOT EXISTS) — seguro de rodar sobre produção.

-- Colunas já usadas em produção pelo fluxo de pagamento / recuperação de carrinho
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS checkout_url text;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS checkout_url_expires_at timestamptz;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS reservation_code text;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS abandonment_notified_at timestamptz;

-- Novo: cache do id do cliente Asaas (cus_...) para rastreio / reuso
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS asaas_customer_id text;

-- Índice para a consulta reserva-por-cobrança (verify-asaas-payment e retries)
CREATE INDEX IF NOT EXISTS idx_reservations_payment_id ON public.reservations(payment_id);

COMMENT ON COLUMN public.reservations.payment_id IS
  'Id da cobrança na Asaas (pay_...). Antes: Stripe PaymentIntent.';
COMMENT ON COLUMN public.reservations.payment_method IS
  'billingType cru retornado pela Asaas no webhook (PIX / CREDIT_CARD / ...) ou ''asaas'' como fallback. String exata para cartão de débito a confirmar no teste T3.';
COMMENT ON COLUMN public.reservations.asaas_customer_id IS
  'Id do cliente na Asaas (cus_...), resolvido por CPF/CNPJ em create-asaas-charge.';
