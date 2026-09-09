import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendWhatsAppText, formatDate, formatTime } from "../_shared/whatsapp.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[WHATSAPP-QUEUE-PROCESSOR] ${step}${detailsStr}`);
};

interface QueueRow {
  id: string;
  priority: number;
  message_type: 'abandoned_cart' | 'reception_confirmation';
  recipient_phone: string | null;
  reservation_id: string | null;
  message_text: string | null;
  payload: any;
  status: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Tick started");

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Reserva com segurança o próximo item (ou lote, se for recepção agrupável).
    const { data: batch, error: claimError } = await supabase.rpc('claim_whatsapp_batch');

    if (claimError) {
      logStep("Error claiming batch", { error: claimError });
      throw claimError;
    }

    const rows = (batch ?? []) as QueueRow[];

    if (rows.length === 0) {
      logStep("Nothing pending");
      return new Response(JSON.stringify({ sent: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const messageType = rows[0].message_type;
    logStep("Batch claimed", { count: rows.length, messageType });

    let result;

    if (messageType === 'abandoned_cart') {
      const row = rows[0];
      result = await sendWhatsAppText(row.recipient_phone!, row.message_text!);

      await supabase
        .from('whatsapp_message_queue')
        .update({
          status: result.ok ? 'sent' : 'failed',
          sent_at: new Date().toISOString(),
        })
        .eq('id', row.id);

    } else {
      // reception_confirmation — monta UMA mensagem agrupando todas as reservas do lote.
      const receptionPhone = Deno.env.get('RECEPTION_WHATSAPP_NUMBER');

      if (!receptionPhone) {
        logStep("RECEPTION_WHATSAPP_NUMBER não configurado — marcando lote como failed");
        await supabase
          .from('whatsapp_message_queue')
          .update({ status: 'failed', sent_at: new Date().toISOString() })
          .in('id', rows.map(r => r.id));

        return new Response(JSON.stringify({ sent: 0, error: 'missing_reception_phone' }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const header = rows.length > 1
        ? `🆕 *Novas reservas confirmadas (${rows.length})*\n\n`
        : `🆕 *Nova reserva confirmada*\n\n`;

      const items = rows.map((row, i) => {
        const p = row.payload ?? {};
        const totalFormatted = `R$ ${(p.valor_total || 0).toFixed(2).replace('.', ',')}`;
        const dateStr = p.date ? formatDate(p.date) : '';
        const timeStr = p.time ? formatTime(p.time) : '';
        const prefix = rows.length > 1 ? `${i + 1}) ` : '';
        return (
          `${prefix}${p.customer_name ?? 'Cliente'} — ${p.num_pilots ?? '?'} pilotos — ${totalFormatted}\n` +
          `   📅 ${dateStr} às ${timeStr} | 🎫 ${p.reservation_code ?? '?'} | 📱 ${p.customer_phone ?? '?'}`
        );
      });

      const message = header + items.join('\n\n') + '\n\nVerifique na recepção.';

      result = await sendWhatsAppText(receptionPhone, message);

      await supabase
        .from('whatsapp_message_queue')
        .update({
          status: result.ok ? 'sent' : 'failed',
          sent_at: new Date().toISOString(),
        })
        .in('id', rows.map(r => r.id));
    }

    logStep("Batch processed", { messageType, count: rows.length, ok: result.ok });

    return new Response(
      JSON.stringify({ sent: result.ok ? rows.length : 0, messageType }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
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