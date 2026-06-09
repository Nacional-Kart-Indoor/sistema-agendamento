import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CREATE-RESERVATION] ${step}${d}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const {
      time_slot_id,
      customer_name,
      customer_email,
      customer_phone,
      num_pilots,
      battery_type,
    } = body;

    // Validação dos campos obrigatórios
    if (!time_slot_id || !customer_name || !customer_email || !customer_phone || !num_pilots || !battery_type) {
      return new Response(
        JSON.stringify({ error: "Campos obrigatórios faltando" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Validação de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customer_email)) {
      return new Response(
        JSON.stringify({ error: "E-mail inválido" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Validação de pilotos
    const pilots = Number(num_pilots);
    if (!Number.isInteger(pilots) || pilots < 1 || pilots > 12) {
      return new Response(
        JSON.stringify({ error: "Número de pilotos inválido (1–12)" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Validação de battery_type
    if (!["individual", "kids"].includes(battery_type)) {
      return new Response(
        JSON.stringify({ error: "Tipo de bateria inválido" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    logStep("Validação OK", { time_slot_id, pilots, battery_type });

    // Verificar capacidade disponível (com lock via service_role)
    const { data: slot, error: slotError } = await supabase
      .from("time_slots")
      .select("ocupados_atualmente, max_capacity, is_available")
      .eq("id", time_slot_id)
      .single();

    if (slotError || !slot) {
      logStep("Slot não encontrado", { time_slot_id, error: slotError });
      return new Response(
        JSON.stringify({ error: "Horário não encontrado" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    if (!slot.is_available) {
      return new Response(
        JSON.stringify({ error: "Horário indisponível" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 }
      );
    }

    const vagas = slot.max_capacity - slot.ocupados_atualmente;
    if (pilots > vagas) {
      logStep("Capacidade excedida", { vagas, pilots });
      return new Response(
        JSON.stringify({
          error: `Capacidade excedida. Vagas disponíveis: ${vagas}`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 }
      );
    }

    // Buscar preço da pista via time_slot → track
    const { data: slotWithTrack, error: trackError } = await supabase
      .from("time_slots")
      .select("track:tracks(price_per_pilot, price_kids)")
      .eq("id", time_slot_id)
      .single();

    if (trackError || !slotWithTrack?.track) {
      logStep("Pista não encontrada", { error: trackError });
      return new Response(
        JSON.stringify({ error: "Pista não encontrada" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 }
      );
    }

    // Calcular valor total server-side
    const track = slotWithTrack.track as any;
    const pricePerPilot =
      battery_type === "kids"
        ? Number(track.price_kids)
        : Number(track.price_per_pilot);
    const valor_total = pricePerPilot * pilots;

    logStep("Preço calculado", { pricePerPilot, pilots, valor_total });

    // Criar a reserva
    const { data: reservation, error: insertError } = await supabase
      .from("reservations")
      .insert({
        time_slot_id,
        customer_name: customer_name.trim(),
        customer_email: customer_email.trim().toLowerCase(),
        customer_phone: customer_phone.replace(/\D/g, ""),
        num_pilots: pilots,
        battery_type,
        valor_total,
        status: "pending",
      })
      .select("*")
      .single();

    if (insertError) {
      logStep("Erro ao criar reserva", { error: insertError });
      return new Response(
        JSON.stringify({ error: "Erro ao criar reserva" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    logStep("Reserva criada", { id: reservation.id, valor_total });

    return new Response(
      JSON.stringify({ reservation }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 201 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(
      JSON.stringify({ error: "Erro interno" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
