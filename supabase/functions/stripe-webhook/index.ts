import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

// ─── Configurações SellFlux ───────────────────────────────────────────────────
const SELLFLUX_TOKEN = Deno.env.get("SELLFLUX_API_TOKEN")!;
const SELLFLUX_ACTING_USER_ID = Deno.env.get("SELLFLUX_ACTING_USER_ID") || "71234";
const SELLFLUX_BASE = "https://apis.sellflux.app/api/v1";

// ─── Configurações Evolution API (WhatsApp) ───────────────────────────────────
const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");       // ex: https://evo.seudominio.com
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");       // chave da Evolution API
const EVOLUTION_INSTANCE = Deno.env.get("EVOLUTION_INSTANCE");     // nome da instância

// ─── Logger ───────────────────────────────────────────────────────────────────
const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

// ─── Gera código de reserva único ─────────────────────────────────────────────
function generateReservationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0, 1 para evitar confusão
  let code = 'NKI-';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ─── Formata data para exibição ───────────────────────────────────────────────
function formatDate(dateStr: string): string {
  // dateStr = "2026-07-10"
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function formatTime(timeStr: string): string {
  // timeStr = "14:00:00" ou "14:00"
  return timeStr.substring(0, 5);
}

// ─── SellFlux: Cria lead ──────────────────────────────────────────────────────
async function createSellFluxLead(reservation: any): Promise<number | null> {
  try {
    const response = await fetch(`${SELLFLUX_BASE}/lead`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SELLFLUX_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: reservation.customer_name,
        email: reservation.customer_email,
        phone: reservation.customer_phone,
        tags: ["nacional-kart", "agendamento-site", "adulto"],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logStep("Erro ao criar lead no SellFlux", { error });
      return null;
    }

    const data = await response.json();
    logStep("Lead criado no SellFlux", { leadId: data.id });
    return data.id;
  } catch (err) {
    logStep("Exceção ao criar lead no SellFlux", { err });
    return null;
  }
}

// ─── SellFlux: Cria agendamento ───────────────────────────────────────────────
async function createSellFluxSchedule(
  reservation: any,
  slot: any,
  leadId: number | null,
  reservationCode: string
) {
  try {
    const slotDate = slot.date; // "2026-07-10"
    const slotTime = slot.start_time; // "14:00:00"
    const slotTimeShort = formatTime(slotTime); // "14:00"

    // Horário de início e fim em ISO 8601 com timezone Brasília
    const startISO = `${slotDate}T${slotTimeShort}:00-03:00`;
    const [h, m] = slotTimeShort.split(":").map(Number);
    const endMinutes = h * 60 + m + 30;
    const endH = Math.floor(endMinutes / 60).toString().padStart(2, "0");
    const endM = (endMinutes % 60).toString().padStart(2, "0");
    const endISO = `${slotDate}T${endH}:${endM}:00-03:00`;

    const numPilots = reservation.num_pilots;
    const subject = `${reservation.customer_name} ${numPilots}p (SITE)`;
    const totalFormatted = `R$ ${(reservation.valor_total || 0).toFixed(2).replace('.', ',')}`;

    const description = [
      `Reserva de bateria de kart para ${numPilots} pessoa${numPilots > 1 ? 's' : ''} na modalidade adulto.`,
      `Agendado pelo site.`,
      `Data: ${formatDate(slotDate)} às ${slotTimeShort}`,
      `Valor: ${totalFormatted}`,
      `Tel: ${reservation.customer_phone}`,
      `Email: ${reservation.customer_email}`,
      `Código da reserva: ${reservationCode}`,
    ].join('\n');

    const body: any = {
      subject,
      description,
      start_date: startISO,
      end_date: endISO,
      timezone: "America/Sao_Paulo",
      schedule_type: "meeting",
      acting_user_id: parseInt(SELLFLUX_ACTING_USER_ID),
    };

    if (leadId) {
      body.lead_ids = leadId.toString();
    }

    const response = await fetch(`${SELLFLUX_BASE}/crm/schedules`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SELLFLUX_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      logStep("Erro ao criar agendamento no SellFlux", { error });
      return null;
    }

    const data = await response.json();
    logStep("Agendamento criado no SellFlux", { scheduleId: data.id });
    return data.id;
  } catch (err) {
    logStep("Exceção ao criar agendamento no SellFlux", { err });
    return null;
  }
}

// ─── Evolution API: Envia WhatsApp ────────────────────────────────────────────
async function sendWhatsApp(reservation: any, slot: any, reservationCode: string) {
  // Se Evolution API não estiver configurada, apenas loga e segue
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE) {
    logStep("Evolution API não configurada — WhatsApp não enviado");
    return;
  }

  try {
    const slotDate = slot.date;
    const slotTime = formatTime(slot.start_time);
    const numPilots = reservation.num_pilots;
    const totalFormatted = `R$ ${(reservation.valor_total || 0).toFixed(2).replace('.', ',')}`;

    // Formata telefone: remove tudo que não é número e garante DDI 55
    const phoneClean = reservation.customer_phone.replace(/\D/g, '');
    const phoneWithDDI = phoneClean.startsWith('55') ? phoneClean : `55${phoneClean}`;

    const message = [
      `✅ *Reserva confirmada! Nacional Kart Indoor*`,
      ``,
      `📅 *Data:* ${formatDate(slotDate)}`,
      `⏰ *Horário:* ${slotTime}`,
      `👥 *Pilotos:* ${numPilots}`,
      `🏁 *Pista:* Kartódromo Principal`,
      `💰 *Valor pago:* ${totalFormatted}`,
      ``,
      `🎫 *Código de reserva: ${reservationCode}*`,
      ``,
      `Apresente este código na recepção ao chegar.`,
      `Até logo! 🏎️`,
    ].join('\n');

    const response = await fetch(
      `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": EVOLUTION_API_KEY,
        },
        body: JSON.stringify({
          number: phoneWithDDI,
          text: message,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logStep("Erro ao enviar WhatsApp", { error });
    } else {
      logStep("WhatsApp enviado com sucesso", { phone: phoneWithDDI });
    }
  } catch (err) {
    logStep("Exceção ao enviar WhatsApp", { err });
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Webhook received");

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    let event: Stripe.Event;

    if (!webhookSecret) {
      logStep("ERROR: STRIPE_WEBHOOK_SECRET is not configured");
      return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!signature) {
      logStep("ERROR: Missing stripe-signature header");
      return new Response(JSON.stringify({ error: 'Missing signature' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
      logStep("Webhook signature verified");
    } catch (err) {
      logStep("Webhook signature verification failed - processing anyway", { error: err });
      try {
        event = JSON.parse(body) as Stripe.Event;
      } catch (parseErr) {
        logStep("Failed to parse body", { parseErr });
        return new Response(JSON.stringify({ error: 'Invalid body' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    logStep("Event type", { type: event.type });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Pagamento confirmado ──────────────────────────────────────────────────
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const reservationId = session.metadata?.reservation_id;
      const paymentIntentId = session.payment_intent as string;

      logStep("Payment completed", { reservationId, paymentIntentId });

      if (reservationId) {
        // Idempotência: verifica se já foi processado
        const { data: reservation, error: fetchError } = await supabase
          .from('reservations')
          .select('id, status, reservation_code')
          .eq('id', reservationId)
          .single();

        if (fetchError) {
          logStep("Error fetching reservation", { error: fetchError });
          throw fetchError;
        }

        if (reservation.status === 'paid') {
          logStep("Reservation already paid, skipping", { reservationId });
        } else {
          // Gera código de reserva único
          const reservationCode = generateReservationCode();

          // Atualiza reserva para paid + salva o código
          const { error: updateError } = await supabase
            .from('reservations')
            .update({
              status: 'paid',
              payment_id: paymentIntentId,
              reservation_code: reservationCode,
            })
            .eq('id', reservationId);

          if (updateError) {
            logStep("Error updating reservation", { error: updateError });
            throw updateError;
          }

          logStep("Reservation updated to paid", { reservationId, reservationCode });

          // Busca dados completos da reserva + slot para SellFlux e WhatsApp
          const { data: fullReservation, error: fullFetchError } = await supabase
            .from('reservations')
            .select(`
              id,
              customer_name,
              customer_email,
              customer_phone,
              num_pilots,
              valor_total,
              reservation_code,
              time_slots (
                date,
                start_time
              )
            `)
            .eq('id', reservationId)
            .single();

          if (fullFetchError || !fullReservation) {
            logStep("Erro ao buscar reserva completa", { fullFetchError });
          } else {
            const slot = fullReservation.time_slots;

            // 1. Cria lead no SellFlux
            const leadId = await createSellFluxLead(fullReservation);

            // 2. Cria agendamento no SellFlux
            await createSellFluxSchedule(fullReservation, slot, leadId, reservationCode);

            // 3. Envia WhatsApp com o código de reserva
            await sendWhatsApp(fullReservation, slot, reservationCode);
          }
        }
      }
    }

    // ── Sessão expirada ───────────────────────────────────────────────────────
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      const reservationId = session.metadata?.reservation_id;

      if (reservationId) {
        await supabase
          .from('reservations')
          .update({ status: 'expired' })
          .eq('id', reservationId);

        logStep("Reservation expired", { reservationId });
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
