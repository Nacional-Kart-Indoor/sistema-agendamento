-- Saúde de integrações externas, gravada pelo reconciliation-check e lida pelo
-- painel da atendente. Motivação: em out/2026 a sessão do WhatsApp na Evolution
-- caiu (401, aparelho desvinculado) e ficou ~10 dias sem enviar nada, com o
-- manager mostrando "Connected" e ninguém sabendo. O alerta à equipe também ia
-- por WhatsApp, então caía junto.

CREATE TABLE IF NOT EXISTS public.system_health (
  component text PRIMARY KEY,
  ok boolean NOT NULL,
  detail text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  down_since timestamptz,
  last_ok_at timestamptz
);

COMMENT ON TABLE public.system_health IS 'Último resultado da checagem de cada integração (ex.: whatsapp). Escrita só pelo service role (reconciliation-check); leitura por atendente/admin.';

ALTER TABLE public.system_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff can read system_health" ON public.system_health;
CREATE POLICY "staff can read system_health"
  ON public.system_health
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'atendente'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON public.system_health FROM anon;
GRANT SELECT ON public.system_health TO authenticated;
