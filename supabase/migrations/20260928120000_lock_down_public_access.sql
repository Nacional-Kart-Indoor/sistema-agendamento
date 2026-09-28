-- Fecha acessos públicos (chave anon, embutida no site) que não são usados
-- por ninguém — toda escrita legítima passa pelas Edge Functions com
-- service_role, e o frontend só chama as RPCs de staff (set_attendance etc.).

-- 1) Fila de WhatsApp: claim_whatsapp_batch devolvia telefone + texto da
--    mensagem (nome, código da reserva, link de pilotos) pra qualquer visitante,
--    e ainda marcava as mensagens como "em envio" — dava pra ler e sabotar a
--    fila. acquire_whatsapp_send_slot deixava qualquer um segurar o lock de
--    envio. Só o whatsapp-queue-processor e o asaas-webhook (service_role) usam.
--    Essas funções foram criadas direto no banco (não há migration com a
--    assinatura), então revoga em todas as sobrecargas pelo nome.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('claim_whatsapp_batch', 'acquire_whatsapp_send_slot')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END;
$$;

-- 2) reservations: a policy antiga allow_public_insert_reservations deixava
--    qualquer visitante inserir reserva direto na tabela — inclusive já com
--    status 'paid', ocupando vaga sem pagar. O site cria reservas só pela
--    Edge Function create-reservation (service_role). Revogar o privilégio da
--    tabela independe do nome da policy em produção.
REVOKE INSERT, UPDATE, DELETE ON public.reservations FROM anon, authenticated;
DROP POLICY IF EXISTS "allow_public_insert_reservations" ON public.reservations;

-- 3) reservation_pilots: escrita só via submit-reservation-pilots (service_role).
REVOKE INSERT, UPDATE, DELETE ON public.reservation_pilots FROM anon, authenticated;
