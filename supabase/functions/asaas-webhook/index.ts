import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { mapAsaasEventToReservation } from "../_shared/asaas.ts";
import { markReservationPaid, runPostPaymentEffects } from "../_shared/post-payment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, asaas-access-token",
};

// ─── Logger ───────────────────────────────────────────────────────────────────
const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[ASAAS-WEBHOOK] ${step}${detailsStr}`);
};

// ─── Handler principal ────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Webhook received");

    // ── Autenticação: token simples no header (a Asaas não assina com HMAC) ──
    const expectedToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN");
    const receivedToken = req.headers.get("asaas-access-token");
    if (!expectedToken || receivedToken !== expectedToken) {
      logStep("ERRO: token de webhook inválido");
      // Requisição não autêntica — aceitável responder != 2xx aqui.
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json();
    const event: string = payload?.event;
    const payment = payload?.payment;
    const reservationId: string | undefined = payment?.externalReference;

    logStep("Event", { event, paymentId: payment?.id, reservationId, status: payment?.status, billingType: payment?.billingType });

    const targetStatus = mapAsaasEventToReservation(event);
    if (!targetStatus) {
      logStep("Evento ignorado", { event });
      return new Response(JSON.stringify({ received: true, ignored: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!reservationId) {
      logStep("Webhook sem externalReference — ignorado", { event });
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: reservation, error: fetchError } = await supabase
      .from("reservations")
      .select("id, status")
      .eq("id", reservationId)
      .single();

    if (fetchError || !reservation) {
      // Evento órfão — não retrair a fila da Asaas por causa disso.
      logStep("Reserva não encontrada — respondendo 200", { reservationId, error: fetchError?.message });
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Pagamento confirmado / recebido ─────────────────────────────────────
    if (targetStatus === "paid") {
      // Marca paid (ou confirma que já estava) e garante código/token sem trocar
      // os que já existem. Payment_method guarda o valor CRU do billingType da
      // Asaas ("PIX" ou "CREDIT_CARD"). Decisão (sessão 6): a Asaas não expõe se
      // um pagamento com cartão foi crédito ou débito em nenhum campo documentado
      // — tratar cartão como categoria única, sem tentar diferenciar.
      const { transitioned, reservationCode } = await markReservationPaid(supabase, reservationId, payment);
      logStep(transitioned ? "Reserva atualizada para paid" : "Reserva já estava paga", { reservationId, reservationCode });

      // Roda mesmo se a reserva já estava paga: se o verify-asaas-payment marcou
      // paid antes deste webhook, os efeitos ainda não rodaram. A trava dentro de
      // runPostPaymentEffects garante uma execução só (retry da Asaas e
      // PAYMENT_RECEIVED depois do CONFIRMED viram no-op).
      await runPostPaymentEffects(supabase, reservationId);

      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Cobrança vencida ───────────────────────────────────────────────────
    if (targetStatus === "expired") {
      if (reservation.status === "pending") {
        await supabase.from("reservations").update({ status: "expired" }).eq("id", reservationId);
        logStep("Reserva marcada como expired", { reservationId });
      } else {
        logStep("PAYMENT_OVERDUE ignorado (reserva não está pending)", { reservationId, status: reservation.status });
      }
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Estorno / chargeback / exclusão ────────────────────────────────────
    if (targetStatus === "cancelled") {
      if (reservation.status !== "cancelled") {
        await supabase.from("reservations").update({ status: "cancelled" }).eq("id", reservationId);
        // Dispara trg_reservations_recalc e libera a vaga.
        logStep("Reserva marcada como cancelled", { reservationId, event });
      }
      return new Response(JSON.stringify({ received: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logStep("ERROR", { message: errorMessage });
    // 500 → a Asaas re-tenta. A fila só pausa após 15 falhas consecutivas.
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
