// supabase/functions/_shared/asaas.ts
//
// Helper compartilhado para a integração com a Asaas.
// Usado por create-asaas-charge, asaas-webhook e verify-asaas-payment.
//
// Sandbox e produção usam a MESMA interface — só mudam os secrets:
//   ASAAS_BASE_URL   -> https://sandbox.asaas.com/api/v3  |  https://api.asaas.com/v3
//   ASAAS_API_KEY    -> chave de sandbox | produção
//   SANDBOX_MODE     -> "true" em sandbox (pula SellFlux/WhatsApp no webhook)
//   ASAAS_WEBHOOK_TOKEN -> validado no header asaas-access-token (só o webhook usa)

const ASAAS_BASE_URL =
  Deno.env.get("ASAAS_BASE_URL")?.replace(/\/+$/, "") || "https://api.asaas.com/v3";
const ASAAS_API_KEY = Deno.env.get("ASAAS_API_KEY");

/** true quando rodando contra o sandbox da Asaas (secret SANDBOX_MODE = "true"). */
export function isSandbox(): boolean {
  return Deno.env.get("SANDBOX_MODE") === "true";
}

export interface AsaasHttpError extends Error {
  status?: number;
  body?: unknown;
}

/**
 * fetch com a base URL e o header de autenticação da Asaas já injetados.
 * Lança AsaasHttpError em respostas != 2xx; devolve o JSON já parseado no sucesso.
 */
export async function asaasFetch(path: string, init: RequestInit = {}): Promise<any> {
  if (!ASAAS_API_KEY) throw new Error("ASAAS_API_KEY is not set");

  const url = path.startsWith("http") ? path : `${ASAAS_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      access_token: ASAAS_API_KEY,
      "User-Agent": "nacional-kart-indoor",
      ...(init.headers || {}),
    },
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* resposta não-JSON — mantém json = null e usa o text cru no erro */
  }

  if (!res.ok) {
    const description = json?.errors?.[0]?.description || text || res.statusText;
    const err = new Error(`Asaas ${res.status}: ${description}`) as AsaasHttpError;
    err.status = res.status;
    err.body = json ?? text;
    throw err;
  }

  return json;
}

/**
 * Procura um cliente Asaas pelo CPF/CNPJ (identificador único do cliente na
 * Asaas — diferente do Stripe, que agrupa por e-mail). Cria se não existir.
 * Retorna o id do cliente (`cus_...`).
 */
export async function findOrCreateCustomer(params: {
  name: string;
  email: string;
  phone: string;
  cpfCnpj: string;
}): Promise<string> {
  const cpfCnpj = params.cpfCnpj.replace(/\D/g, "");
  const phone = params.phone.replace(/\D/g, "");

  const found = await asaasFetch(`/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}`);
  if (found?.data?.length > 0) {
    return found.data[0].id;
  }

  const created = await asaasFetch("/customers", {
    method: "POST",
    body: JSON.stringify({
      name: params.name,
      email: params.email,
      mobilePhone: phone,
      cpfCnpj,
      notificationDisabled: true, // a Nacional Kart cuida das notificações (WhatsApp/SellFlux)
    }),
  });
  return created.id;
}

/**
 * Pago = RECEIVED (liquidado) ou CONFIRMED (cartão aprovado, ainda não liquidado).
 * Baseado no `status` DA COBRANÇA, nunca no `billingType`.
 */
export function isPaidStatus(status: string): boolean {
  return status === "RECEIVED" || status === "CONFIRMED" || status === "RECEIVED_IN_CASH";
}

/**
 * Mapeia o `status` de uma cobrança Asaas (GET /v3/payments/{id}) para o status
 * da reserva. Independe de PIX / crédito / débito.
 */
export function mapAsaasStatusToReservation(
  status: string,
): "paid" | "expired" | "cancelled" | "pending" {
  switch (status) {
    case "RECEIVED":
    case "CONFIRMED":
    case "RECEIVED_IN_CASH":
      return "paid";
    case "OVERDUE":
      return "expired";
    case "REFUNDED":
    case "REFUND_REQUESTED":
    case "CHARGEBACK_REQUESTED":
    case "CHARGEBACK_DISPUTE":
    case "AWAITING_CHARGEBACK_REVERSAL":
    case "DELETED":
      return "cancelled";
    default:
      return "pending";
  }
}

/**
 * Mapeia o `event` de um webhook Asaas para o status da reserva.
 * Retorna null para eventos que devem ser ignorados (responder 200 e seguir).
 */
export function mapAsaasEventToReservation(
  event: string,
): "paid" | "expired" | "cancelled" | null {
  switch (event) {
    case "PAYMENT_CONFIRMED":
    case "PAYMENT_RECEIVED":
      return "paid";
    case "PAYMENT_OVERDUE":
      return "expired";
    case "PAYMENT_REFUNDED":
    case "PAYMENT_CHARGEBACK_REQUESTED":
    case "PAYMENT_CHARGEBACK_DISPUTE":
    case "PAYMENT_DELETED":
      return "cancelled";
    default:
      return null;
  }
}

/**
 * Data de vencimento no formato YYYY-MM-DD, `days` dias à frente, no fuso
 * America/Sao_Paulo (UTC-3 fixo — o Brasil não tem mais horário de verão).
 */
export function dueDateInDays(days: number): string {
  const saoPaulo = new Date(Date.now() - 3 * 60 * 60 * 1000);
  saoPaulo.setUTCDate(saoPaulo.getUTCDate() + days);
  return saoPaulo.toISOString().slice(0, 10);
}

/** Fim do dia (23:59:59 -03:00) de uma data YYYY-MM-DD, em ISO 8601 UTC. */
export function endOfDayISO(dateYMD: string): string {
  return new Date(`${dateYMD}T23:59:59-03:00`).toISOString();
}
