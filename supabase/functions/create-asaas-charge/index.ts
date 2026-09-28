import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  asaasFetch,
  dueDateInDays,
  endOfDayISO,
  findOrCreateCustomer,
  isPaidStatus,
} from "../_shared/asaas.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Dias até o vencimento da cobrança (também vira a validade do link de
// recuperação de carrinho abandonado — ver notify-abandoned-cart).
const DUE_IN_DAYS = 3;

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CREATE-ASAAS-CHARGE] ${step}${detailsStr}`);
};

const validateInput = (body: any): { valid: boolean; error?: string; data?: any } => {
  const { reservation_id, customer_name, customer_email, customer_phone, track_id, num_pilots, battery_type } = body;

  if (!reservation_id || typeof reservation_id !== "string") return { valid: false, error: "Invalid or missing reservation_id" };
  if (!track_id || typeof track_id !== "string") return { valid: false, error: "Invalid or missing track_id" };
  if (!customer_name || typeof customer_name !== "string" || customer_name.trim().length < 2 || customer_name.length > 100) return { valid: false, error: "Customer name must be 2-100 characters" };

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!customer_email || typeof customer_email !== "string" || !emailRegex.test(customer_email) || customer_email.length > 255) return { valid: false, error: "Invalid email address" };

  const phoneDigits = customer_phone?.replace(/\D/g, "") || "";
  if (phoneDigits.length < 10 || phoneDigits.length > 15) return { valid: false, error: "Invalid phone number" };

  // [A1] CPF (11 dígitos) ou CNPJ (14 dígitos) — obrigatório para a Asaas.
  const cpfCnpjDigits = body.cpf_cnpj?.replace(/\D/g, "") || "";
  if (cpfCnpjDigits.length !== 11 && cpfCnpjDigits.length !== 14) return { valid: false, error: "CPF/CNPJ inválido" };

  const pilots = Number(num_pilots);
  if (!Number.isInteger(pilots) || pilots < 1 || pilots > 12) return { valid: false, error: "Number of pilots must be between 1 and 12" };

  if (!["individual", "kids"].includes(battery_type)) return { valid: false, error: "Invalid battery type" };

  return {
    valid: true,
    data: {
      reservation_id,
      customer_name: customer_name.trim(),
      customer_email: customer_email.trim().toLowerCase(),
      customer_phone: phoneDigits,
      cpf_cnpj: cpfCnpjDigits,
      track_id,
      num_pilots: pilots,
      battery_type,
      track_name: body.track_name || "",
      date: body.date || "",
      time_slot: body.time_slot || "",
    },
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Supabase environment variables not set");

    const body = await req.json();
    logStep("Request body received");

    const validation = validateInput(body);
    if (!validation.valid) {
      logStep("Validation failed", { error: validation.error });
      return new Response(JSON.stringify({ error: validation.error }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const { reservation_id, customer_name, customer_email, customer_phone, cpf_cnpj, track_id, track_name, date, time_slot, num_pilots, battery_type } = validation.data;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Preço calculado SEMPRE no servidor a partir da tabela `tracks` ────────
    const { data: track, error: trackError } = await supabase
      .from("tracks")
      .select("price_per_pilot, price_kids, name")
      .eq("id", track_id)
      .single();

    if (trackError || !track) {
      logStep("Track not found", { track_id, error: trackError?.message });
      return new Response(JSON.stringify({ error: "Track not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const pricePerPilot = battery_type === "kids" ? Number(track.price_kids) : Number(track.price_per_pilot);
    // Reais decimais, no máximo 2 casas (evita 149.99999 por erro de ponto flutuante).
    const valorTotal = Math.round(pricePerPilot * num_pilots * 100) / 100;

    logStep("Price calculated server-side", { pricePerPilot, num_pilots, valorTotal });

    const { error: updateError } = await supabase
      .from("reservations")
      .update({ valor_total: valorTotal })
      .eq("id", reservation_id);

    if (updateError) {
      logStep("Failed to update reservation price", { error: updateError.message });
    }

    // ── Reuso de cobrança: evita cobrança duplicada quando o cliente clica em
    //    "Ir para o pagamento" mais de uma vez na mesma reserva ───────────────
    const { data: reservation } = await supabase
      .from("reservations")
      .select("status, payment_id")
      .eq("id", reservation_id)
      .single();

    if (reservation?.status === "paid") {
      logStep("Reservation already paid", { reservation_id });
      return new Response(JSON.stringify({ error: "Esta reserva já foi paga." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 409,
      });
    }

    if (reservation?.payment_id) {
      try {
        const existing = await asaasFetch(`/payments/${reservation.payment_id}`);
        if (isPaidStatus(existing.status)) {
          logStep("Existing charge already paid", { payment_id: reservation.payment_id, status: existing.status });
          return new Response(JSON.stringify({ error: "Esta reserva já foi paga." }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 409,
          });
        }
        if (existing.status === "PENDING" && existing.invoiceUrl) {
          logStep("Reusing existing pending charge", { payment_id: reservation.payment_id });
          return new Response(JSON.stringify({ url: existing.invoiceUrl }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        }
        logStep("Existing charge not reusable, creating a new one", { status: existing.status });
      } catch (err) {
        // Se não der pra consultar a cobrança antiga, segue criando uma nova.
        logStep("Failed to fetch existing charge, creating a new one", { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ── Cliente Asaas (por CPF/CNPJ) ─────────────────────────────────────────
    const customerId = await findOrCreateCustomer({
      name: customer_name,
      email: customer_email,
      phone: customer_phone,
      cpfCnpj: cpf_cnpj,
    });
    logStep("Asaas customer resolved", { customerId });

    // ── Cobrança hospedada (redirect) ───────────────────────────────────────
    // O autoRedirect da Asaas só funciona se o domínio do successUrl bater com
    // o cadastrado nos dados comerciais da conta (nacionalkartindoor.com.br, sem www —
    // www redireciona pro apex em produção). PUBLIC_SITE_URL força esse domínio
    // (útil em preview/sandbox, onde o header Origin seria o domínio da Vercel).
    // Sem o secret, usa o Origin da request.
    const origin =
      Deno.env.get("PUBLIC_SITE_URL")?.replace(/\/+$/, "") ||
      req.headers.get("origin") ||
      "https://nacionalkartindoor.com.br";
    const dueDate = dueDateInDays(DUE_IN_DAYS);
    const description =
      `Bateria ${battery_type === "kids" ? "Kids" : "Individual"} - ${track_name || track.name}` +
      ` | ${num_pilots} piloto(s)${date ? ` ${date}` : ""}${time_slot ? ` às ${time_slot}` : ""}`;

    const payment = await asaasFetch("/payments", {
      method: "POST",
      body: JSON.stringify({
        customer: customerId,
        billingType: "UNDEFINED", // a página hospedada oferece os métodos habilitados na conta (PIX + crédito + débito)
        value: valorTotal, // reais decimais — NÃO multiplicar por 100 (diferente do Stripe)
        dueDate,
        description,
        externalReference: reservation_id,
        callback: {
          successUrl: `${origin}/?payment=success&reservation_id=${reservation_id}`,
          autoRedirect: true,
        },
      }),
    });

    logStep("Asaas payment created", { paymentId: payment.id, status: payment.status, invoiceUrl: payment.invoiceUrl });

    // ── Persiste na reserva (payment_id + link p/ recuperação de carrinho) ───
    const { error: chargeUpdateError } = await supabase
      .from("reservations")
      .update({
        payment_id: payment.id,
        payment_method: "asaas",
        asaas_customer_id: customerId,
        checkout_url: payment.invoiceUrl,
        checkout_url_expires_at: endOfDayISO(payment.dueDate || dueDate),
        customer_cpf: cpf_cnpj,
      })
      .eq("id", reservation_id);

    if (chargeUpdateError) {
      // Não bloqueia o fluxo — a cobrança já existe. A recuperação de carrinho
      // apenas cai no fallback (link da home) se checkout_url não gravar.
      logStep("Failed to persist charge on reservation", { error: chargeUpdateError.message });
    }

    return new Response(JSON.stringify({ url: payment.invoiceUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: "An error occurred processing your request" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
