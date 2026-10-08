// supabase/functions/_shared/meta-capi.ts
//
// Envia eventos para o Meta via Conversions API (server-side).
// Usado pelo asaas-webhook para o evento Purchase — a fonte de verdade do
// pagamento é o webhook, então esse envio acontece mesmo que o cliente feche
// a aba antes de voltar ao site ou tenha bloqueador de anúncios.
//
// Requer o secret no projeto Supabase:
//   META_CAPI_ACCESS_TOKEN
// Opcional:
//   META_PIXEL_ID — sobrescreve o padrão (DEFAULT_PIXEL_ID)
// Opcional (só para validar no "Testar eventos" do Gerenciador):
//   META_CAPI_TEST_EVENT_CODE
//   SITE_URL — fallback do event_source_url quando a reserva não gravou um
//
// Nunca lança exceção — o webhook da Asaas não pode falhar por causa do Meta.

const GRAPH_API_VERSION = "v21.0";
// O webhook da Asaas espera este envio terminar; o Meta não pode segurá-lo.
const REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_PIXEL_ID = "28257199233881770";

interface UserData {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  externalId?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
}

interface CapiEventInput {
  eventName: "Purchase" | "Schedule" | "Lead" | "InitiateCheckout" | string;
  eventId: string;
  eventTime?: number; // unix seconds
  eventSourceUrl?: string;
  user: UserData;
  customData?: Record<string, unknown>;
}

const log = (step: string, details?: unknown) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[META-CAPI] ${step}${d}`);
};

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Normaliza conforme exigido pelo Meta antes do hash. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Telefone: só dígitos, com DDI 55 se vier sem. */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("55") ? digits : `55${digits}`;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

async function buildUserData(user: UserData): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};

  if (user.email) out.em = [await sha256(normalizeEmail(user.email))];
  if (user.phone) out.ph = [await sha256(normalizePhone(user.phone))];
  if (user.firstName) out.fn = [await sha256(normalizeName(user.firstName))];
  if (user.lastName) out.ln = [await sha256(normalizeName(user.lastName))];
  if (user.externalId) out.external_id = [await sha256(user.externalId)];
  if (user.fbp) out.fbp = user.fbp;
  if (user.fbc) out.fbc = user.fbc;
  if (user.clientIp) out.client_ip_address = user.clientIp;
  if (user.userAgent) out.client_user_agent = user.userAgent;
  out.country = [await sha256("br")];

  return out;
}

/** Separa "Nome Sobrenome Composto" em first/last para o Advanced Matching. */
export function splitName(fullName: string | null | undefined): { firstName?: string; lastName?: string } {
  if (!fullName) return {};
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  // último token como sobrenome — mesmo critério do identify() no navegador
  return { firstName: parts[0], lastName: parts[parts.length - 1] };
}

export async function sendMetaCapiEvent(input: CapiEventInput): Promise<{ ok: boolean; error?: string }> {
  const pixelId = Deno.env.get("META_PIXEL_ID") || DEFAULT_PIXEL_ID;
  const accessToken = Deno.env.get("META_CAPI_ACCESS_TOKEN");
  const testEventCode = Deno.env.get("META_CAPI_TEST_EVENT_CODE") || Deno.env.get("META_TEST_EVENT_CODE");

  if (!pixelId || !accessToken) {
    log("Skipped: META_CAPI_ACCESS_TOKEN not configured");
    return { ok: false, error: "not_configured" };
  }

  try {
    const payload: Record<string, unknown> = {
      data: [
        {
          event_name: input.eventName,
          event_time: input.eventTime ?? Math.floor(Date.now() / 1000),
          event_id: input.eventId,
          action_source: "website",
          event_source_url: input.eventSourceUrl,
          user_data: await buildUserData(input.user),
          custom_data: input.customData,
        },
      ],
    };
    if (testEventCode) payload.test_event_code = testEventCode;

    // Token vai no corpo, não na URL: mensagens de erro do fetch incluem a URL
    // e acabariam no log do catch abaixo.
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, access_token: accessToken }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    const body = await res.text();
    if (!res.ok) {
      log("Meta API error", { status: res.status, body });
      return { ok: false, error: body };
    }

    log("Event sent", { event: input.eventName, eventId: input.eventId, response: body });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("Exception", { message });
    return { ok: false, error: message };
  }
}
