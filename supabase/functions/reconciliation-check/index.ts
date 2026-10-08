import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendAdminAlert } from "../_shared/whatsapp.ts";
import { runPostPaymentEffects } from "../_shared/post-payment.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RECONCILE_THRESHOLD_MINUTES = 30;
// Webhook/verify rodam os efeitos em segundos; passou disso sem trava ou com
// SellFlux 'pendente', algo morreu no meio.
const POST_PAYMENT_THRESHOLD_MINUTES = 10;
const MAX_ITEMS_IN_MESSAGE = 8;

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[RECONCILIATION-CHECK] ${step}${detailsStr}`);
};

const formatTotal = (v: unknown) => `R$ ${(Number(v) || 0).toFixed(2).replace('.', ',')}`;

async function hasOpenAlert(supabase: any, reservationId: string, alertTypes: string[]): Promise<boolean> {
  const { data } = await supabase
    .from('reconciliation_alerts')
    .select('id')
    .eq('reservation_id', reservationId)
    .in('alert_type', alertTypes)
    .is('resolved_at', null)
    .limit(1);
  return !!data && data.length > 0;
}

async function insertAlert(supabase: any, reservationId: string, alertType: string, detail: string) {
  const { error } = await supabase
    .from('reconciliation_alerts')
    .insert({ reservation_id: reservationId, alert_type: alertType, detail });
  if (error) logStep("Error inserting alert", { reservationId, alertType, error });
  return !error;
}

// 1) paid sem reservation_code (não deveria mais acontecer: o código é gerado
//    junto com o paid em mark_reservation_paid, por qualquer caminho).
async function checkPaidWithoutCode(supabase: any): Promise<number> {
  const cutoff = new Date(Date.now() - RECONCILE_THRESHOLD_MINUTES * 60 * 1000).toISOString();
  const { data: stuck, error } = await supabase
    .from('reservations')
    .select('id, customer_name, customer_phone, valor_total')
    .eq('status', 'paid')
    .is('reservation_code', null)
    .lt('created_at', cutoff);
  if (error) throw error;

  let created = 0;
  for (const r of stuck ?? []) {
    if (await hasOpenAlert(supabase, r.id, ['paid_without_code'])) continue;
    const detail =
      `Reserva ${r.id} esta com status "paid" mas sem reservation_code ` +
      `ha mais de ${RECONCILE_THRESHOLD_MINUTES} minutos. ` +
      `Cliente: ${r.customer_name ?? 'desconhecido'} / ${r.customer_phone ?? 'sem telefone'} / ${formatTotal(r.valor_total)}`;
    if (await insertAlert(supabase, r.id, 'paid_without_code', detail)) created++;
  }
  return created;
}

// 2) paid sem trava de efeitos: nem webhook nem verify conseguiram rodar.
//    Tenta de novo aqui — a trava continua garantindo uma execução só.
async function retryUnclaimedPostPayment(supabase: any): Promise<number> {
  const cutoff = new Date(Date.now() - POST_PAYMENT_THRESHOLD_MINUTES * 60 * 1000).toISOString();
  const { data: unclaimed, error } = await supabase
    .from('reservations')
    .select('id')
    .eq('status', 'paid')
    .is('post_payment_claimed_at', null)
    .lt('paid_at', cutoff); // paid_at NULL (pagas antes da trava) fica de fora
  if (error) throw error;

  for (const r of unclaimed ?? []) {
    logStep("Efeitos pós-pagamento não rodaram, executando agora", { reservationId: r.id });
    await runPostPaymentEffects(supabase, r.id);
  }
  return unclaimed?.length ?? 0;
}

// 3) SellFlux que ficou 'pendente' (execução morreu no meio) ou 'falhou' sem
//    alerta aberto (o alerta na hora não conseguiu ser gravado).
async function checkSellfluxNotOk(supabase: any): Promise<number> {
  const cutoff = new Date(Date.now() - POST_PAYMENT_THRESHOLD_MINUTES * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from('reservations')
    .select('id, reservation_code, customer_name, customer_phone, num_pilots, valor_total, sellflux_status')
    .eq('status', 'paid')
    .in('sellflux_status', ['pendente', 'falhou'])
    .lt('post_payment_claimed_at', cutoff);
  if (error) throw error;

  let created = 0;
  for (const r of rows ?? []) {
    if (await hasOpenAlert(supabase, r.id, ['sellflux_failed', 'sellflux_stuck', 'sellflux_marker_failed'])) continue;
    const detail =
      `Reserva PAGA com SellFlux "${r.sellflux_status}" ha mais de ${POST_PAYMENT_THRESHOLD_MINUTES} min — ` +
      `confira se o agendamento existe no SellFlux e agende manualmente se preciso.\n` +
      `${r.reservation_code ?? 'sem código'} — ${r.customer_name} (${r.customer_phone}) — ` +
      `${r.num_pilots} piloto(s) — ${formatTotal(r.valor_total)} — ID: ${r.id}`;
    if (await insertAlert(supabase, r.id, 'sellflux_stuck', detail)) created++;
  }
  return created;
}

// 4) Envia à equipe todo alerta aberto ainda não notificado (de qualquer origem:
//    deste job ou dos efeitos pós-pagamento cujo WhatsApp falhou na hora).
async function notifyPendingAlerts(supabase: any): Promise<{ pending: number; ok: boolean }> {
  const { data: pending, error } = await supabase
    .from('reconciliation_alerts')
    .select('id, alert_type, detail')
    .is('notified_at', null)
    .is('resolved_at', null)
    .order('detected_at', { ascending: true });
  if (error) throw error;
  if (!pending || pending.length === 0) return { pending: 0, ok: true };

  const shown = pending.slice(0, MAX_ITEMS_IN_MESSAGE);
  let message =
    `${pending.length} alerta(s) de reserva precisando de atenção:\n\n` +
    shown.map((a: any, i: number) => `${i + 1}. [${a.alert_type}] ${a.detail}`).join('\n\n');
  if (pending.length > shown.length) message += `\n\n...e mais ${pending.length - shown.length} alerta(s).`;
  message += `\n\nVerifique no Supabase Dashboard (tabelas reservations e reconciliation_alerts) e no SellFlux.`;

  const result = await sendAdminAlert(message);
  if (result.ok) {
    await supabase
      .from('reconciliation_alerts')
      .update({ notified_at: new Date().toISOString() })
      .in('id', pending.map((a: any) => a.id));
  }
  return { pending: pending.length, ok: result.ok };
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

    const retried = await retryUnclaimedPostPayment(supabase);
    const withoutCode = await checkPaidWithoutCode(supabase);
    const sellflux = await checkSellfluxNotOk(supabase);
    const notified = await notifyPendingAlerts(supabase);

    const summary = { retried, new_paid_without_code: withoutCode, new_sellflux_alerts: sellflux, notified };
    logStep("Batch processed", summary);

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
