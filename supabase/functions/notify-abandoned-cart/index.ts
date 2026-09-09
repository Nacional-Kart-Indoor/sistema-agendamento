import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ABANDON_THRESHOLD_MINUTES = 15;
const FALLBACK_URL = "https://nacionalkartindoor.com.br";
const MAX_PER_RUN = 50; // circuit breaker de sanidade, não um limite operacional normal

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[NOTIFY-ABANDONED-CART] ${step}${detailsStr}`);
};

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function formatTime(timeStr: string): string {
  return timeStr.substring(0, 5);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Job started");

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const cutoff = new Date(Date.now() - ABANDON_THRESHOLD_MINUTES * 60 * 1000).toISOString();

    const { data: abandoned, error } = await supabase
      .from('reservations')
      .select(`
        id, customer_name, customer_phone, num_pilots, valor_total, created_at,
        checkout_url, checkout_url_expires_at,
        time_slots ( date, start_time )
      `)
      .eq('status', 'pending')
      .is('abandonment_notified_at', null)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(MAX_PER_RUN);

    if (error) {
      logStep("Error fetching abandoned reservations", { error });
      throw error;
    }

    if (!abandoned || abandoned.length === 0) {
      logStep("No abandoned reservations found");
      return new Response(JSON.stringify({ checked: 0, enqueued: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    logStep("Abandoned reservations found", { count: abandoned.length });

    let enqueued = 0;

    for (const reservation of abandoned) {
      const slot = reservation.time_slots as any;
      const firstName = reservation.customer_name?.split(' ')[0] ?? '';

      let recoveryUrl = FALLBACK_URL;
      if (reservation.checkout_url && reservation.checkout_url_expires_at) {
        const expiresAt = new Date(reservation.checkout_url_expires_at).getTime();
        if (expiresAt > Date.now()) recoveryUrl = reservation.checkout_url;
      }

      let message = `Oi${firstName ? ' ' + firstName : ''}! 👋\n\n`;
      message += `Vimos que você começou uma reserva na Nacional Kart Indoor`;
      if (slot?.date) {
        message += ` para ${formatDate(slot.date)}`;
        if (slot?.start_time) message += ` às ${formatTime(slot.start_time)}`;
      }
      message += ` mas não finalizou o pagamento.\n\n`;
      message += `Sua vaga ainda não foi confirmada — quer terminar agora antes que o horário fique indisponível?\n\n`;
      message += `${recoveryUrl}\n\n`;
      message += `Qualquer dúvida, é só responder aqui. 🏁`;

      const { error: enqueueError } = await supabase
        .from('whatsapp_message_queue')
        .insert({
          priority: 2,
          message_type: 'abandoned_cart',
          recipient_phone: reservation.customer_phone,
          reservation_id: reservation.id,
          message_text: message,
        });

      // Marca como notificado independentemente do resultado do enfileiramento,
      // pra nunca tentar de novo a mesma reserva a cada 15 minutos.
      await supabase
        .from('reservations')
        .update({ abandonment_notified_at: new Date().toISOString() })
        .eq('id', reservation.id);

      if (!enqueueError) {
        enqueued++;
        logStep("Enqueued", { reservationId: reservation.id });
      } else {
        logStep("Failed to enqueue", { reservationId: reservation.id, error: enqueueError.message });
      }
    }

    return new Response(JSON.stringify({ checked: abandoned.length, enqueued }), {
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