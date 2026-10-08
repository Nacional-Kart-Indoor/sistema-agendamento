// supabase/functions/_shared/post-payment.ts
//
// Tudo o que acontece quando uma reserva vira "paid": código da reserva,
// SellFlux, WhatsApp e Purchase no Meta. Usado pelo asaas-webhook, pelo
// verify-asaas-payment e pelo reconciliation-check — quem confirmar o pagamento
// primeiro não importa: os efeitos rodam uma vez só, decididos pela trava
// atômica em reservations.post_payment_claimed_at.
import { isSandbox } from "./asaas.ts";
import { sendMetaCapiEvent, splitName } from "./meta-capi.ts";
import { sendAdminAlert } from "./whatsapp.ts";

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
  console.log(`[POST-PAYMENT] ${step}${detailsStr}`);
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

// ─── Marca a reserva como paga ────────────────────────────────────────────────
// Único caminho para virar "paid", usado pelo webhook e pelo verify. A função
// mark_reservation_paid só preenche reservation_code / pilotos_token se ainda
// estiverem vazios, então chamar duas vezes não troca o código nem o link de
// pilotos que já pode ter ido por WhatsApp.
export async function markReservationPaid(
  supabase: any,
  reservationId: string,
  payment: { id?: string | null; billingType?: string | null },
): Promise<{ transitioned: boolean; reservationCode: string }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await supabase.rpc("mark_reservation_paid", {
      p_reservation_id: reservationId,
      p_payment_id: payment.id ?? null,
      p_payment_method: payment.billingType ?? null,
      p_reservation_code: generateReservationCode(),
      p_pilotos_token: generatePilotsToken(),
    });

    // Colisão no índice único de reservation_code: sorteia outro código.
    if (error?.code === "23505" && /reservation_code/.test(error.message || "") && attempt < 3) {
      logStep("Código de reserva colidiu, gerando outro", { reservationId, attempt });
      continue;
    }
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error(`Reserva ${reservationId} não encontrada ao marcar como paga`);
    return { transitioned: row.transitioned, reservationCode: row.reservation_code };
  }
  throw new Error("unreachable");
}

// ─── Alerta visível (reconciliation_alerts + WhatsApp da equipe) ─────────────
// O reconciliation-check reenvia ao staff qualquer alerta que fique sem
// notified_at, então uma falha aqui no WhatsApp não some.
async function raiseAlert(supabase: any, reservationId: string, alertType: string, detail: string) {
  logStep("ALERTA", { reservationId, alertType, detail });
  try {
    const { data: inserted, error } = await supabase
      .from("reconciliation_alerts")
      .insert({ reservation_id: reservationId, alert_type: alertType, detail })
      .select("id")
      .single();
    if (error) {
      logStep("ERRO CRÍTICO: alerta não gravado", { reservationId, alertType, error: error.message });
      return;
    }
    const result = await sendAdminAlert(detail);
    if (result.ok) {
      await supabase
        .from("reconciliation_alerts")
        .update({ notified_at: new Date().toISOString() })
        .eq("id", inserted.id);
    }
  } catch (err) {
    logStep("ERRO CRÍTICO: exceção ao gerar alerta", { reservationId, alertType, err: String(err) });
  }
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
async function sendWhatsAppToClient(phone: string, message: string, supabase: any): Promise<boolean> {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE) {
    logStep("Evolution API não configurada — WhatsApp não enviado");
    return false;
  }
  if (!phone) {
    logStep("Número de telefone vazio — envio ignorado");
    return false;
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
      return true;
    }
  } catch (err) {
    logStep("Exceção ao enviar WhatsApp ao cliente", { err });
  }
  return false;
}

// ─── Monta a confirmação, envia ao cliente na hora, enfileira a recepção ─────
async function sendWhatsApp(reservation: any, slot: any, reservationCode: string, supabase: any): Promise<boolean> {
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
  const clientSent = await sendWhatsAppToClient(reservation.customer_phone, message, supabase);

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

  return clientSent;
}

// ─── Meta CAPI: Purchase server-side ──────────────────────────────────────────
// event_id = `purchase-<reservation_id>`, o mesmo que o navegador envia no
// Purchase do pixel quando a pessoa volta da Asaas — o Meta deduplica e conta
// uma venda só. Quem pagou e fechou a aba sem voltar só é contabilizado por
// aqui. Nunca lança: falha no Meta não pode derrubar o webhook.
async function sendMetaPurchase(supabase: any, reservation: any): Promise<void> {
  try {
    const { firstName, lastName } = splitName(reservation.customer_name);

    const value = Number(reservation.valor_total) || 0;
    const numPilots = Number(reservation.num_pilots) || 1;
    const contentId = `bateria-${reservation.battery_type === "kids" ? "kids" : "individual"}`;

    const result = await sendMetaCapiEvent({
      eventName: "Purchase",
      eventId: `purchase-${reservation.id}`,
      eventSourceUrl: reservation.event_source_url || `${PUBLIC_SITE_URL}/`,
      user: {
        email: reservation.customer_email,
        phone: reservation.customer_phone,
        firstName,
        lastName,
        externalId: reservation.external_id,
        fbp: reservation.fbp,
        fbc: reservation.fbc,
        clientIp: reservation.client_ip_address,
        userAgent: reservation.client_user_agent,
      },
      customData: {
        value: Number(value.toFixed(2)),
        currency: "BRL",
        content_type: "product",
        content_ids: [contentId],
        content_name: `Bateria ${reservation.battery_type === "kids" ? "Kids" : "Individual"}`,
        content_category: "Agendamento de Kart",
        contents: [{ id: contentId, quantity: numPilots, item_price: Number((value / numPilots).toFixed(2)) }],
        num_items: numPilots,
        order_id: reservation.id,
      },
    });

    if (!result.ok) return;

    const { error } = await supabase
      .from("reservations")
      .update({ meta_purchase_sent_at: new Date().toISOString() })
      .eq("id", reservation.id);
    if (error) logStep("meta_purchase_sent_at não gravado (ignorado)", { error: error.message });
  } catch (err) {
    logStep("Purchase para o Meta falhou (ignorado)", { err: String(err) });
  }
}

async function updateReservation(supabase: any, reservationId: string, fields: Record<string, unknown>): Promise<boolean> {
  try {
    const { error } = await supabase.from("reservations").update(fields).eq("id", reservationId);
    if (error) {
      logStep("Erro ao gravar marcador na reserva", { reservationId, fields: Object.keys(fields), error: error.message });
      return false;
    }
    return true;
  } catch (err) {
    logStep("Exceção ao gravar marcador na reserva", { reservationId, fields: Object.keys(fields), err: String(err) });
    return false;
  }
}

function describeReservation(r: any): string {
  const slot = r.time_slots as any;
  const when = slot?.date && slot?.start_time ? `${formatDate(slot.date)} às ${formatTime(slot.start_time)}` : "sem horário vinculado";
  const total = `R$ ${(Number(r.valor_total) || 0).toFixed(2).replace(".", ",")}`;
  return `${r.reservation_code ?? "sem código"} — ${r.customer_name} (${r.customer_phone}) — ${r.num_pilots} piloto(s) — ${when} — ${total} — ID: ${r.id}`;
}

const RESERVATION_FIELDS = `
  id,
  customer_name,
  customer_email,
  customer_phone,
  num_pilots,
  battery_type,
  valor_total,
  reservation_code,
  pilotos_token,
  fbp,
  fbc,
  external_id,
  client_user_agent,
  client_ip_address,
  event_source_url,
  time_slots (
    date,
    start_time
  )
`;

// ─── Efeitos pós-pagamento (SellFlux + WhatsApp + Meta) ──────────────────────
// Pode ser chamada quantas vezes for, por qualquer caminho: só quem conseguir
// gravar post_payment_claimed_at (UPDATE ... WHERE ... IS NULL, atômico no
// Postgres) executa. Os demais saem sem fazer nada.
//
// - WhatsApp: no máximo uma vez (a trava vem antes do envio; se cair no meio,
//   não reenvia).
// - SellFlux: sellflux_status vai de 'pendente' para 'ok' ou 'falhou'. Falha
//   gera alerta visível na hora; se a execução morrer no meio e ficar
//   'pendente', o reconciliation-check alerta.
// - Meta: pode repetir sem problema, o event_id deduplica.
//
// Nunca lança.
export async function runPostPaymentEffects(supabase: any, reservationId: string): Promise<void> {
  let r: any = null;
  try {
    const { data: claimed, error: claimError } = await supabase
      .from("reservations")
      .update({ post_payment_claimed_at: new Date().toISOString() })
      .eq("id", reservationId)
      .eq("status", "paid")
      // paid_at só existe em reservas pagas depois da trava existir: as antigas
      // (já processadas pelo webhook antigo) nunca reexecutam.
      .not("paid_at", "is", null)
      .is("post_payment_claimed_at", null)
      .select(RESERVATION_FIELDS);

    if (claimError) {
      // Sem trava não executa nada; o reconciliation-check tenta de novo.
      logStep("Erro ao reservar a execução dos efeitos", { reservationId, error: claimError.message });
      return;
    }
    if (!claimed || claimed.length === 0) {
      logStep("Efeitos pós-pagamento já executados (ou reserva paga antes da trava) — nada a fazer", { reservationId });
      return;
    }

    r = claimed[0];
    const reservationCode: string = r.reservation_code;
    logStep("Efeitos pós-pagamento reservados para esta execução", { reservationId, reservationCode });

    if (isSandbox()) {
      logStep("SANDBOX_MODE — SellFlux, WhatsApp e Meta pulados", { reservationId, reservationCode });
      return;
    }

    // Purchase no Meta: a venda já é real aqui, independe de ter time_slot vinculado.
    await sendMetaPurchase(supabase, r);

    const slot = r.time_slots as any;
    if (!slot?.date || !slot?.start_time) {
      // Reserva sem slot vinculado (modo SellFlux sem match no Supabase): não dá pra
      // montar agendamento nem mensagem com data e hora.
      await updateReservation(supabase, reservationId, { sellflux_status: "falhou" });
      await raiseAlert(
        supabase,
        reservationId,
        "sellflux_failed",
        `Reserva PAGA sem horário vinculado — não foi agendada no SellFlux nem recebeu WhatsApp. ` +
          `Agende manualmente e avise o cliente.\n${describeReservation(r)}`,
      );
      return;
    }

    // ── SellFlux ──
    await updateReservation(supabase, reservationId, { sellflux_status: "pendente" });
    const leadId = await createSellFluxLead(r);
    if (leadId) await updateReservation(supabase, reservationId, { sellflux_lead_id: String(leadId) });

    const scheduleId = await createSellFluxSchedule(r, slot, leadId, reservationCode);
    if (scheduleId) {
      const saved = await updateReservation(supabase, reservationId, {
        sellflux_schedule_id: String(scheduleId),
        sellflux_status: "ok",
      });
      if (!saved) {
        await raiseAlert(
          supabase,
          reservationId,
          "sellflux_marker_failed",
          `Agendamento ${scheduleId} criado no SellFlux, mas não foi registrado no banco. ` +
            `Confira no SellFlux e marque sellflux_status='ok' na reserva.\n${describeReservation(r)}`,
        );
      }
    } else {
      await updateReservation(supabase, reservationId, { sellflux_status: "falhou" });
      await raiseAlert(
        supabase,
        reservationId,
        "sellflux_failed",
        `Reserva PAGA sem agendamento no SellFlux (a API recusou ou falhou). ` +
          `Agende manualmente — o cliente pode chegar sem vaga.\n${describeReservation(r)}`,
      );
    }

    // ── WhatsApp ──
    const clientSent = await sendWhatsApp(r, slot, reservationCode, supabase);
    if (clientSent) await updateReservation(supabase, reservationId, { whatsapp_client_sent_at: new Date().toISOString() });
  } catch (err) {
    logStep("Exceção nos efeitos pós-pagamento", { reservationId, err: String(err) });
    await raiseAlert(
      supabase,
      reservationId,
      "post_payment_exception",
      `Erro inesperado nos efeitos pós-pagamento (SellFlux/WhatsApp podem não ter rodado). ` +
        `Confira a reserva.\n${r ? describeReservation(r) : `ID: ${reservationId}`}`,
    );
  }
}
