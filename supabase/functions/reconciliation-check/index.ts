import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendAdminAlert } from "../_shared/whatsapp.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RECONCILE_THRESHOLD_MINUTES = 30;
const MAX_ITEMS_IN_MESSAGE = 8;

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[RECONCILIATION-CHECK] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Job started");

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const cutoff = new Date(Date.now() - RECONCILE_THRESHOLD_MINUTES * 60 * 1000).toISOString();

    const { data: stuck, error } = await supabase
      .from('reservations')
      .select('id, customer_name, customer_phone, num_pilots, valor_total, created_at')
      .eq('status', 'paid')
      .is('reservation_code', null)
      .lt('created_at', cutoff);

    if (error) {
      logStep("Error fetching stuck reservations", { error });
      throw error;
    }

    if (!stuck || stuck.length === 0) {
      logStep("No stuck reservations found");
      return new Response(JSON.stringify({ checked: 0, new_alerts: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    logStep("Stuck reservations found", { count: stuck.length });

    const newCases: typeof stuck = [];
    for (const reservation of stuck) {
      const { data: existing } = await supabase
        .from('reconciliation_alerts')
        .select('id')
        .eq('reservation_id', reservation.id)
        .is('resolved_at', null)
        .maybeSingle();

      if (!existing) newCases.push(reservation);
    }

    if (newCases.length === 0) {
      logStep("Todos ja alertados, nada novo");
      return new Response(JSON.stringify({ checked: stuck.length, new_alerts: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const insertedIds: string[] = [];
    for (const reservation of newCases) {
      const totalFormatted = `R$ ${(reservation.valor_total || 0).toFixed(2).replace('.', ',')}`;
      const detail =
        `Reserva ${reservation.id} esta com status "paid" mas sem reservation_code ` +
        `ha mais de ${RECONCILE_THRESHOLD_MINUTES} minutos. ` +
        `Cliente: ${reservation.customer_name ?? 'desconhecido'} / ` +
        `${reservation.customer_phone ?? 'sem telefone'} / ${totalFormatted}`;

      const { data: inserted, error: insertError } = await supabase
        .from('reconciliation_alerts')
        .insert({ reservation_id: reservation.id, alert_type: 'paid_without_code', detail })
        .select('id')
        .single();

      if (insertError) {
        logStep("Error inserting alert", { reservationId: reservation.id, error: insertError });
        continue;
      }
      if (inserted) insertedIds.push(inserted.id);
    }

    const itemsToShow = newCases.slice(0, MAX_ITEMS_IN_MESSAGE);
    const remainingCount = newCases.length - itemsToShow.length;

    const itemLines = itemsToShow.map((r, i) => {
      const totalFormatted = `R$ ${(r.valor_total || 0).toFixed(2).replace('.', ',')}`;
      return `${i + 1}. ${r.customer_name ?? 'desconhecido'} (${r.customer_phone ?? 'sem tel'}) - ${totalFormatted} - ID: ${r.id}`;
    });

    let summaryMessage =
      `Encontradas ${newCases.length} reserva(s) com pagamento confirmado mas sem codigo gerado ` +
      `(mais de ${RECONCILE_THRESHOLD_MINUTES} min):\n\n` +
      itemLines.join('\n');

    if (remainingCount > 0) {
      summaryMessage += `\n\n...e mais ${remainingCount} caso(s).`;
    }
    summaryMessage += `\n\nVerifique manualmente no Supabase Dashboard (tabela reservations) e no SellFlux.`;

    const result = await sendAdminAlert(summaryMessage);

    if (result.ok && insertedIds.length > 0) {
      await supabase
        .from('reconciliation_alerts')
        .update({ notified_at: new Date().toISOString() })
        .in('id', insertedIds);
    }

    logStep("Batch processed", { newCases: newCases.length, ok: result.ok });

    return new Response(
      JSON.stringify({ checked: stuck.length, new_alerts: newCases.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});