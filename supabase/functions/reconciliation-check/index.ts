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

// 5) Saúde do WhatsApp, mostrada como aviso no painel da atendente.
//    O manager da Evolution pode exibir "Connected" com a sessão caída, então
//    a fonte é o connectionState ao vivo. Também conta como falha a última
//    mensagem da recepção (número fixo, não depende do telefone do cliente)
//    ter falhado. Nunca lança: um problema aqui não pode parar o resto do job.
const RECEPTION_FAILURE_WINDOW_HOURS = 6;

async function checkWhatsAppHealth(supabase: any): Promise<{ ok: boolean; detail: string }> {
  let ok = true;
  let detail = 'Conectado';

  try {
    const apiUrl = (Deno.env.get('EVOLUTION_API_URL') ?? '').replace(/\/+$/, '');
    const apiKey = Deno.env.get('EVOLUTION_API_KEY') ?? '';
    const instance = Deno.env.get('EVOLUTION_INSTANCE') ?? '';

    if (!apiUrl || !apiKey || !instance) {
      ok = false;
      detail = 'Evolution API não configurada no Supabase.';
    } else {
      try {
        const res = await fetch(`${apiUrl}/instance/connectionState/${encodeURIComponent(instance)}`, {
          headers: { apikey: apiKey },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          ok = false;
          detail = `Evolution API respondeu ${res.status} ao consultar a conexão.`;
        } else {
          const body = await res.json();
          const state = body?.instance?.state;
          if (state !== 'open') {
            ok = false;
            detail = `WhatsApp desconectado (estado: ${state ?? 'desconhecido'}).`;
          }
        }
      } catch (err) {
        ok = false;
        detail = `Servidor da Evolution API não respondeu (${String(err).slice(0, 120)}).`;
      }
    }

    if (ok) {
      const since = new Date(Date.now() - RECEPTION_FAILURE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
      const { data: last } = await supabase
        .from('whatsapp_message_queue')
        .select('status')
        .eq('message_type', 'reception_confirmation')
        .in('status', ['sent', 'failed'])
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1);
      if (last?.[0]?.status === 'failed') {
        ok = false;
        detail = 'Conectado, mas a última mensagem para a recepção falhou.';
      }
    }

    const now = new Date().toISOString();
    const { data: prev } = await supabase
      .from('system_health')
      .select('down_since')
      .eq('component', 'whatsapp')
      .maybeSingle();

    const { error } = await supabase.from('system_health').upsert({
      component: 'whatsapp',
      ok,
      detail,
      checked_at: now,
      down_since: ok ? null : (prev?.down_since ?? now),
      ...(ok ? { last_ok_at: now } : {}),
    });
    if (error) logStep("Erro ao gravar system_health", { error: error.message });
  } catch (err) {
    logStep("Exceção na checagem do WhatsApp", { err: String(err) });
  }

  return { ok, detail };
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

    // Primeiro: não depende do resto e precisa rodar mesmo se algo abaixo lançar.
    const whatsapp = await checkWhatsAppHealth(supabase);

    const retried = await retryUnclaimedPostPayment(supabase);
    const withoutCode = await checkPaidWithoutCode(supabase);
    const sellflux = await checkSellfluxNotOk(supabase);
    const notified = await notifyPendingAlerts(supabase);

    const summary = { whatsapp, retried, new_paid_without_code: withoutCode, new_sellflux_alerts: sellflux, notified };
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
