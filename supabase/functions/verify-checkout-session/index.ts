import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-CHECKOUT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { session_id, reservation_id } = await req.json();

    if (!session_id || !reservation_id) {
      return new Response(JSON.stringify({ error: "Missing session_id or reservation_id" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    logStep("Verifying session", { session_id, reservation_id });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const session = await stripe.checkout.sessions.retrieve(session_id);
    logStep("Session retrieved", { payment_status: session.payment_status });

    // ─── Proteção crítica ──────────────────────────────────────────────────
    // O reservation_id enviado pelo cliente PRECISA bater com o
    // reservation_id gravado no metadata da sessão Stripe no momento em
    // que ela foi criada (create-checkout). Sem essa checagem, um
    // pagamento legítimo de UMA reserva poderia ser reutilizado para
    // marcar QUALQUER OUTRA reserva como paga, bastando trocar o
    // reservation_id enviado nesta requisição — mesmo sem pagar por ela.
    const metadataReservationId = session.metadata?.reservation_id;
    if (metadataReservationId !== reservation_id) {
      logStep("ERRO: reservation_id não corresponde ao metadata da sessão", {
        recebido: reservation_id,
        esperado: metadataReservationId,
      });
      return new Response(JSON.stringify({ error: "Reserva não corresponde à sessão de pagamento" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    if (session.payment_status === "paid") {
      const paymentIntentId = session.payment_intent as string;

      // Busca reserva simples
      const { data: existing } = await supabase
        .from('reservations')
        .select('status, time_slot_id')
        .eq('id', reservation_id)
        .single();

      if (!existing) {
        logStep("Reservation not found", { reservation_id });
        return new Response(JSON.stringify({ error: "Reservation not found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        });
      }

      if (existing.status !== 'paid') {
        const { error: updateError } = await supabase
          .from('reservations')
          .update({ status: 'paid', payment_id: paymentIntentId })
          .eq('id', reservation_id);

        if (updateError) {
          logStep("Error updating reservation", { error: updateError });
          throw updateError;
        }
        logStep("Reservation updated to paid", { reservation_id });
      } else {
        logStep("Already paid, skipping update", { reservation_id });
      }

      // Busca reserva completa
      const { data: reservation } = await supabase
        .from('reservations')
        .select('*')
        .eq('id', reservation_id)
        .single();

      // Busca time_slot separadamente
      const { data: timeSlot } = await supabase
        .from('time_slots')
        .select('date, start_time, end_time, track_id')
        .eq('id', existing.time_slot_id)
        .single();

      // Busca track separadamente
      let trackName = '';
      if (timeSlot?.track_id) {
        const { data: track } = await supabase
          .from('tracks')
          .select('name')
          .eq('id', timeSlot.track_id)
          .single();
        trackName = track?.name ?? '';
      }

      // Monta objeto completo para o frontend
      const fullReservation = {
        ...reservation,
        time_slots: timeSlot ? {
          date: timeSlot.date,
          start_time: timeSlot.start_time,
          end_time: timeSlot.end_time,
          tracks: { name: trackName },
        } : null,
      };

      logStep("Returning full reservation", { id: reservation_id, date: timeSlot?.date, trackName });

      return new Response(JSON.stringify({ verified: true, paid: true, reservation: fullReservation }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    logStep("Payment not completed", { payment_status: session.payment_status });
    return new Response(JSON.stringify({ verified: true, paid: false, payment_status: session.payment_status }), {
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