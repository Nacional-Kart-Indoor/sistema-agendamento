// supabase/functions/_shared/whatsapp.ts
//
// Helper compartilhado para enviar mensagens de WhatsApp via Evolution API.
// Usado por notify-abandoned-cart, reconciliation-check e whatsapp-queue-processor.
// (O asaas-webhook tem sua própria função inline pro envio ao CLIENTE, que
// continua instantânea/direta — só o envio à recepção passa pela fila agora.)
//
// Requer os secrets no projeto Supabase:
//   EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE, STAFF_WHATSAPP_NUMBER

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

interface SendResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Formata telefone BR: só dígitos, com DDI 55 na frente. */
export function formatBrazilianPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, "");
  return digits.startsWith("55") ? digits : `55${digits}`;
}

/**
 * Passa pelo filtro de espaçamento (mínimo 2s entre QUALQUER envio no sistema
 * inteiro, não só desta function). Chama a function no banco que trava,
 * espera o necessário, e libera. Nunca lança exceção — se o filtro falhar
 * por algum motivo, segue em frente sem bloquear o envio (falha aberta,
 * não fechada: preferimos um envio sem espera perfeita a um envio perdido).
 */
async function passThroughSendGate(): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) return;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error } = await supabase.rpc("acquire_whatsapp_send_slot");
    if (error) {
      console.log("[whatsapp] Filtro de espaçamento falhou, seguindo sem ele:", error.message);
    }
  } catch (err) {
    console.log("[whatsapp] Exceção no filtro de espaçamento, seguindo sem ele:", err);
  }
}

/**
 * Envia texto via Evolution API, passando antes pelo filtro de espaçamento.
 * Nunca lança exceção — sempre retorna { ok, error }.
 */
export async function sendWhatsAppText(
  toPhone: string,
  message: string,
): Promise<SendResult> {
  const apiUrl = Deno.env.get("EVOLUTION_API_URL");
  const apiKey = Deno.env.get("EVOLUTION_API_KEY");
  const instance = Deno.env.get("EVOLUTION_INSTANCE");

  if (!apiUrl || !apiKey || !instance) {
    console.log("[whatsapp] Evolution API não configurada — envio ignorado.");
    return { ok: false, error: "missing_evolution_secrets" };
  }

  if (!toPhone) {
    console.log("[whatsapp] Número de telefone vazio — envio ignorado.");
    return { ok: false, error: "missing_phone" };
  }

  const number = formatBrazilianPhone(toPhone);

  // Filtro de espaçamento — SEMPRE antes de qualquer chamada real à Evolution API.
  await passThroughSendGate();

  try {
    const res = await fetch(`${apiUrl}/message/sendText/${instance}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: apiKey,
      },
      body: JSON.stringify({ number, text: message }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.log(`[whatsapp] Evolution API retornou ${res.status}: ${body}`);
      return { ok: false, status: res.status, error: body };
    }

    return { ok: true, status: res.status };
  } catch (err) {
    console.log(`[whatsapp] Falha de rede ao enviar para ${number}:`, err);
    return { ok: false, error: String(err) };
  }
}

/** Atalho para mandar alerta ao número do admin/staff. */
export async function sendAdminAlert(message: string): Promise<SendResult> {
  const staffPhone = Deno.env.get("STAFF_WHATSAPP_NUMBER");
  if (!staffPhone) {
    console.log("[whatsapp] STAFF_WHATSAPP_NUMBER ausente — alerta ignorado.");
    return { ok: false, error: "missing_staff_phone" };
  }
  return sendWhatsAppText(staffPhone, `🚨 *ALERTA SISTEMA* 🚨\n\n${message}`);
}

/** Formata data "2026-07-10" -> "10/07/2026". */
export function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year}`;
}

/** Formata hora "14:00:00" -> "14:00". */
export function formatTime(timeStr: string): string {
  return timeStr.substring(0, 5);
}