import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { isSandbox, mapAsaasEventToReservation } from "../_shared/asaas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, asaas-access-token",
};

// ─── Configurações SellFlux ───────────────────────────────────────────────────
const SELLFLUX_TOKEN = Deno.env.get("SELLFLUX_API_TOKEN")!;
const SELLFLUX_ACTING_USER_ID = Deno.env.get("SELLFLUX_ACTING_USER_ID") || "71234";
const SELLFLUX_BASE = "https://apis.sellflux.app/api/v1";

// ─── Configurações Evolution API (WhatsApp) ───────────────────────────────────
const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");
const EVOLUTION_INSTANCE = Deno.env.get("EVOLUTION_INSTANCE");

const PUBLIC_SITE_URL =
  Deno.env.get("PUBLIC_SITE_URL")?.replace(/\/+$/, "") || "https://nacionalkartindoor.com.br";

// ─── Logger ───────────────────────────────────────────────────────────────────
const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[ASAAS-WEBHOOK] ${step}${detailsStr}`);
};

// ─── Gera código de reserva único ─────────────────────────────────────────────
function generateReservationCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "NKI-";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ─── Token aleatório (256 bits) pra página pública de dados dos pilotos ──────
// Diferente do reservation_code (curto, pra mostrar na tela): esse precisa
// ser inadivinhável, então usa o gerador criptográfico, não Math.random().
function generatePilotsToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year}`;
}

function formatTime(timeStr: string): string {
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
  reservationCode: string,
) {
  try {
    const slotDate = slot.date;
    const slotTime = slot.start_time;
    const slotTimeShort = formatTime(slotTime);

    const startISO = `${slotDate}T${slotTimeShort}:00-03:00`;
    const [h, m] = slotTimeShort.split(":").map(Number);
    const endMinutes = h * 60 + m + 30;
    const endH = Math.floor(endMinutes / 60).toString().padStart(2, "0");
    const endM = (endMinutes % 60).toString().padStart(2, "0");
    const endISO = `${slotDate}T${endH}:${endM}:00-03:00`;

    const numPilots = reservation.num_pilots;
    const subject = `${reservation.customer_name} ${numPilots}p (SITE)`;
    const totalFormatted = `R$ ${(reservation.valor_total || 0).toFixed(2).replace(".", ",")}`;

    const description = [
      `Reserva de bateria de kart para ${numPilots} pessoa${numPilots > 1 ? "s" : ""} na modalidade adulto.`,
      `Agendado pelo site.`,
      `Data: ${formatDate(slotDate)} às ${slotTimeShort}`,
      `Valor: ${totalFormatted}`,
      `Tel: ${reservation.customer_phone}`,
      `Email: ${reservation.customer_email}`,
      `Código da reserva: ${reservationCode}`,
    ].join("\n");

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

// ─── Evolution API: envia mensagem direta ao CLIENTE (prioridade 1) ──────────
async function sendWhatsAppToClient(phone: string, message: string, supabase: any) {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE) {
    logStep("Evolution API não configurada — WhatsApp não enviado");
    return;
  }
  if (!phone) {
    logStep("Número de telefone vazio — envio ignorado");
    return;
  }

  // Filtro de espaçamento — sempre antes de qualquer chamada real à Evolution API.
  try {
    const { error } = await supabase.rpc("acquire_whatsapp_send_slot");
    if (error) {
      logStep("Filtro de espaçamento falhou, seguindo sem ele", { error: error.message });
    }
  } catch (err) {
    logStep("Exceção no filtro de espaçamento, seguindo sem ele", { err });
  }

  const phoneClean = phone.replace(/\D/g, "");
  const phoneWithDDI = phoneClean.startsWith("55") ? phoneClean : `55${phoneClean}`;

  try {
    const response = await fetch(
      `${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: EVOLUTION_API_KEY,
        },
        body: JSON.stringify({
          number: phoneWithDDI,
          text: message,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      logStep("Erro ao enviar WhatsApp ao cliente", { error });
    } else {
      logStep("WhatsApp enviado ao cliente com sucesso", { phone: phoneWithDDI });
    }
  } catch (err) {
    logStep("Exceção ao enviar WhatsApp ao cliente", { err });
  }
}

// ─── Monta a confirmação, envia ao cliente na hora, enfileira a recepção ─────
async function sendWhatsApp(reservation: any, slot: any, reservationCode: string, supabase: any) {
  const slotDate = slot.date;
  const slotTime = formatTime(slot.start_time);
  const numPilots = reservation.num_pilots;
  const totalFormatted = `R$ ${(reservation.valor_total || 0).toFixed(2).replace(".", ",")}`;

  const message = [
    `🎉 Reserva confirmada, ${reservation.customer_name}!`,
    ``,
    `🏁 Nacional Kart Indoor – Shopping Cerrado`,
    `🔖 Código: ${reservationCode}`,
    `🗓️ ${formatDate(slotDate)} às ${slotTime}`,
    `🏎️ Pista: Kartódromo Principal`,
    `👥 Pilotos: ${numPilots}`,
    `💰 Valor: ${totalFormatted}`,
    ``,
    `📍 Estacionamento coberto, ao lado do acesso 1.`,
    ``,
    `⚠️ Antes de vir:`,
    `👟 Sapato fechado obrigatório`,
    `🪪 Documento com foto obrigatório`,
    `📏 Idade mínima de 12 anos e altura mínima de 1,50m`,
    `⏰ Chegue com 20 minutos de antecedência`,
    `👨‍👩‍👧 Menor de idade? Um responsável precisa estar presente pra assinar o termo.`,
    ...(numPilots > 1 && reservation.pilotos_token
      ? [``, `👥 Falta completar os dados dos outros pilotos: ${PUBLIC_SITE_URL}/reserva/${reservation.pilotos_token}/pilotos`]
      : []),
    ``,
    `Te esperamos! 🏁`,
  ].join("\n");

  // 1) Cliente — prioridade 1, envio direto e imediato (só passa pelo filtro de 2s)
  await sendWhatsAppToClient(reservation.customer_phone, message, supabase);

  // 2) Recepção — prioridade 3, cai na fila unificada em vez de enviar direto.
  const { error: enqueueError } = await supabase
    .from("whatsapp_message_queue")
    .insert({
      priority: 3,
      message_type: "reception_confirmation",
      reservation_id: reservation.id,
      payload: {
        customer_name: reservation.customer_name,
        customer_phone: reservation.customer_phone,
        date: slotDate,
        time: slot.start_time,
        num_pilots: numPilots,
        valor_total: reservation.valor_total,
        reservation_code: reservationCode,
      },
    });

  if (enqueueError) {
    logStep("Erro ao enfileirar notificação para recepção", { error: enqueueError.message });
  } else {
    logStep("Notificação de recepção enfileirada", { reservationId: reservation.id });
  }
}

// ─── Efeitos pós-pagamento (código de reserva + SellFlux + WhatsApp) ─────────
async function runPostPaymentEffects(
  supabase: any,
  reservationId: string,
  reservationCode: string,
) {
  const { data: fullReservation, error: fullFetchError } = await supabase
    .from("reservations")
    .select(`
      id,
      customer_name,
      customer_email,
      customer_phone,
      num_pilots,
      valor_total,
      reservation_code,
      pilotos_token,
      time_slots (
        date,
        start_time
      )
    `)
    .eq("id", reservationId)
    .single();

  if (fullFetchError || !fullReservation) {
    logStep("Erro ao buscar reserva completa", { fullFetchError });
    return;
  }

  const slot = fullReservation.time_slots as any;
  if (!slot?.date || !slot?.start_time) {
    // Reserva sem slot vinculado (modo SellFlux sem match no Supabase). A reserva
    // já está paga; só não dá pra montar o agendamento/mensagem com data e hora.
    logStep("Reserva sem time_slot — SellFlux/WhatsApp pulados", { reservationId });
    return;
  }

  if (isSandbox()) {
    logStep("SANDBOX_MODE — SellFlux e WhatsApp pulados", { reservationId, reservationCode });
    return;
  }

  const leadId = await createSellFluxLead(fullReservation);
  await createSellFluxSchedule(fullReservation, slot, leadId, reservationCode);
  await sendWhatsApp(fullReservation, slot, reservationCode, supabase);
}

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
      .select("id, status, reservation_code, num_pilots, pilotos_token")
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
      if (reservation.status === "paid") {
        logStep("Reserva já paga, ignorando (idempotente)", { reservationId });
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const reservationCode = reservation.reservation_code || generateReservationCode();
      // Só gera quando há pilotos extras a cadastrar (num_pilots > 1) e ainda
      // não existe um token (idempotência do webhook: retry não troca o link
      // que já pode ter sido mandado por WhatsApp).
      const pilotsToken =
        reservation.num_pilots > 1 ? reservation.pilotos_token || generatePilotsToken() : null;

      const { error: updateError } = await supabase
        .from("reservations")
        .update({
          status: "paid",
          payment_id: payment.id,
          // Valor CRU do billingType retornado pela Asaas: "PIX" ou "CREDIT_CARD".
          // Decisão (sessão 6): a Asaas não expõe se um pagamento com cartão foi
          // crédito ou débito em nenhum campo documentado (nem billingType, nem
          // GET /payments/{id}/billingInfo) — tratar cartão como categoria única,
          // sem tentar diferenciar. Não ramificar por essa distinção em nenhum lugar.
          payment_method: payment.billingType || "asaas",
          reservation_code: reservationCode,
          ...(pilotsToken ? { pilotos_token: pilotsToken } : {}),
        })
        .eq("id", reservationId);

      if (updateError) {
        logStep("Erro ao atualizar reserva para paid", { error: updateError });
        throw updateError;
      }

      logStep("Reserva atualizada para paid", { reservationId, reservationCode });

      await runPostPaymentEffects(supabase, reservationId, reservationCode);

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
