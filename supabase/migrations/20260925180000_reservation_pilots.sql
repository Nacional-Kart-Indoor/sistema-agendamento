-- Coleta de nome+CPF dos pilotos extras (quantidade_pilotos > 1), feita numa
-- página pública própria DEPOIS do pagamento confirmado — nunca durante o
-- checkout. Também passa a guardar o CPF de quem fez a reserva (hoje só
-- existia transitoriamente na Asaas, nunca ficava no nosso banco).

ALTER TABLE public.reservations
  ADD COLUMN customer_cpf text,
  ADD COLUMN pilotos_token text UNIQUE,
  ADD COLUMN pilotos_completos boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.reservations.pilotos_token IS 'Token aleatório (256 bits, gerado em asaas-webhook) que dá acesso público e não-adivinhável a /reserva/{token}/pilotos. Só gerado quando num_pilots > 1.';

CREATE TABLE public.reservation_pilots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  nome text NOT NULL,
  cpf text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reservation_pilots ENABLE ROW LEVEL SECURITY;

-- Só leitura pra staff — a escrita pública acontece via Edge Function com
-- service_role (submit-reservation-pilots), nunca por policy direta (evita
-- que o token vire uma forma de enumerar/escrever na tabela via RLS).
CREATE POLICY reservation_pilots_select_staff ON public.reservation_pilots
  FOR SELECT
  USING (has_role(auth.uid(), 'atendente'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
