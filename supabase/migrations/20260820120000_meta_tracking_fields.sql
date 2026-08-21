-- Campos usados no Purchase via Meta Conversions API (dedupe com o pixel do navegador).
-- Capturados no momento em que a reserva é criada (create-reservation).
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS fbp TEXT,
  ADD COLUMN IF NOT EXISTS fbc TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS client_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS client_ip_address TEXT,
  ADD COLUMN IF NOT EXISTS event_source_url TEXT,
  ADD COLUMN IF NOT EXISTS meta_purchase_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.reservations.fbp IS 'Cookie _fbp do Meta Pixel (Conversions API)';
COMMENT ON COLUMN public.reservations.fbc IS 'Cookie _fbc do Meta Pixel, derivado do fbclid do anúncio (Conversions API)';
COMMENT ON COLUMN public.reservations.external_id IS 'ID anônimo e estável do navegador, usado no match do Meta';
COMMENT ON COLUMN public.reservations.meta_purchase_sent_at IS 'Quando o Purchase foi enviado à Conversions API';
