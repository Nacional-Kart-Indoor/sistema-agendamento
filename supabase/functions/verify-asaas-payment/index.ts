import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { asaasFetch, isPaidStatus } from "../_shared/asaas.ts";
import { markReservationPaid, runPostPaymentEffects } from "../_shared/post-payment.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[VERIFY-ASAAS-PAYMENT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { reservation_id } = await req.json();

    if (!reservation_id) {
      return new Response(JSON.stringify({ error: "Missing reservation_id" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    logStep("Verifying reservation", { reservation_id });

    const { data: existing } = await supabase
      .from("reservations")
      .select("status, time_slot_id, payment_id")
      .eq("id", reservation_id)
      .single();

    if (!existing) {
      logStep("Reservation not found", { reservation_id });
      return new Response(JSON.stringify({ error: "Reservation not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    if (!existing.payment_id) {
      logStep("Reservation has no payment yet", { reservation_id });
      return new Response(JSON.stringify({ verified: true, paid: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const payment = await asaasFetch(`/payments/${existing.payment_id}`);
    logStep("Payment retrieved", { status: payment.status });

    // ─── Proteção crítica ──────────────────────────────────────────────────
    // A cobrança precisa apontar de volta para ESTA reserva. A associação
    // reserva → payment_id já é feita no servidor (create-asaas-charge), mas
    // confirmar o vínculo pelos dois lados não custa.
    if (payment.externalReference && payment.externalReference !== reservation_id) {
      logStep("ERRO: externalReference não corresponde à reserva", {
        recebido: reservation_id,
        esperado: payment.externalReference,
      });
      return new Response(JSON.stringify({ error: "Reserva não corresponde à cobrança" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    if (isPaidStatus(payment.status)) {
      // Normalmente o webhook já marcou paid. Se o cliente voltou antes do
      // webhook chegar, marca aqui (com código e token, igual ao webhook) e
      // dispara os efeitos pós-pagamento em segundo plano, sem segurar a tela de
      // confirmação. A trava em runPostPaymentEffects impede rodar duas vezes
      // quando o webhook chegar depois.
      const { transitioned } = await markReservationPaid(supabase, reservation_id, payment);
      logStep(transitioned ? "Reservation updated to paid (antes do webhook)" : "Already paid", { reservation_id });
      EdgeRuntime.waitUntil(runPostPaymentEffects(supabase, reservation_id));

      const { data: reservation } = await supabase
        .from("reservations")
        .select("*")
        .eq("id", reservation_id)
        .single();

      const { data: timeSlot } = await supabase
        .from("time_slots")
        .select("date, start_time, end_time, track_id")
        .eq("id", existing.time_slot_id)
        .single();

      let trackName = "";
      if (timeSlot?.track_id) {
        const { data: track } = await supabase
          .from("tracks")
          .select("name")
          .eq("id", timeSlot.track_id)
          .single();
        trackName = track?.name ?? "";
      }

      // A resposta vai pro navegador — não devolve o CPF do cliente.
      const { customer_cpf: _cpf, ...publicReservation } = reservation ?? {};
      const fullReservation = {
        ...publicReservation,
        time_slots: timeSlot
          ? {
              date: timeSlot.date,
              start_time: timeSlot.start_time,
              end_time: timeSlot.end_time,
              tracks: { name: trackName },
            }
          : null,
      };

      logStep("Returning full reservation", { id: reservation_id, date: timeSlot?.date, trackName });

      return new Response(JSON.stringify({ verified: true, paid: true, reservation: fullReservation }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    logStep("Payment not completed", { payment_status: payment.status });
    return new Response(JSON.stringify({ verified: true, paid: false, payment_status: payment.status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
