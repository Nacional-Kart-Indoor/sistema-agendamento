import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SUBMIT-RESERVATION-PILOTS] ${step}${detailsStr}`);
};

interface PilotInput {
  nome: string;
  cpf: string;
}

// Mesma regra do checkout (CustomerStep.tsx): dígitos verificadores, rejeita 111.111.111-11 etc.
function isValidCpf(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i], 10) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(cpf[9], 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i], 10) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(cpf[10], 10);
}

function validatePilots(pilots: unknown): { valid: boolean; data?: PilotInput[]; error?: string } {
  if (!Array.isArray(pilots) || pilots.length === 0) {
    return { valid: false, error: "Lista de pilotos inválida" };
  }

  const cleaned: PilotInput[] = [];
  for (const p of pilots) {
    const nome = typeof p?.nome === "string" ? p.nome.trim() : "";
    const cpfDigits = typeof p?.cpf === "string" ? p.cpf.replace(/\D/g, "") : "";

    if (nome.length < 2 || nome.length > 100) {
      return { valid: false, error: "Nome de piloto inválido" };
    }
    if (!isValidCpf(cpfDigits)) {
      return { valid: false, error: `CPF inválido: ${nome}` };
    }
    cleaned.push({ nome, cpf: cpfDigits });
  }

  return { valid: true, data: cleaned };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { token, pilots } = body;

    if (!token || typeof token !== "string") {
      return new Response(JSON.stringify({ error: "Link inválido" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: reservation, error: fetchError } = await supabase
      .from("reservations")
      .select("id, num_pilots, pilotos_completos, status")
      .eq("pilotos_token", token)
      .eq("status", "paid")
      .single();

    if (fetchError || !reservation) {
      logStep("Token não encontrado", { error: fetchError?.message });
      return new Response(JSON.stringify({ error: "Link inválido ou expirado" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    if (reservation.pilotos_completos) {
      logStep("Já completo — rejeitando reenvio", { reservationId: reservation.id });
      return new Response(JSON.stringify({ error: "Os dados dos pilotos já foram enviados." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 409,
      });
    }

    const expected = Math.max(0, reservation.num_pilots - 1);
    const validation = validatePilots(pilots);
    if (!validation.valid) {
      return new Response(JSON.stringify({ error: validation.error }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    if (validation.data!.length !== expected) {
      return new Response(
        JSON.stringify({ error: `Envie os dados de exatamente ${expected} piloto(s).` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    // "Reserva" o envio antes de inserir: o UPDATE condicional é atômico, então
    // de dois envios simultâneos (duplo clique, link aberto em 2 celulares) só
    // um passa daqui — o outro recebe 409 em vez de duplicar os pilotos.
    const { data: claimed, error: claimError } = await supabase
      .from("reservations")
      .update({ pilotos_completos: true })
      .eq("id", reservation.id)
      .eq("pilotos_completos", false)
      .select("id");

    if (claimError) {
      logStep("Erro ao marcar pilotos_completos", { error: claimError.message });
      throw claimError;
    }
    if (!claimed || claimed.length === 0) {
      logStep("Envio concorrente já em andamento — rejeitando", { reservationId: reservation.id });
      return new Response(JSON.stringify({ error: "Os dados dos pilotos já foram enviados." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 409,
      });
    }

    const { error: insertError } = await supabase.from("reservation_pilots").insert(
      validation.data!.map((p) => ({
        reservation_id: reservation.id,
        nome: p.nome,
        cpf: p.cpf,
      })),
    );

    if (insertError) {
      logStep("Erro ao inserir pilotos — liberando pra reenvio", { error: insertError.message });
      // Desfaz a marcação pra que o cliente consiga tentar de novo.
      await supabase.from("reservations").update({ pilotos_completos: false }).eq("id", reservation.id);
      throw insertError;
    }

    logStep("Pilotos cadastrados", { reservationId: reservation.id, count: validation.data!.length });

    return new Response(JSON.stringify({ ok: true }), {
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
