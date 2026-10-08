import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CREATE-RESERVATION] ${step}${d}`);
};

function isSellFluxId(id: string): boolean {
  return id.startsWith("sellflux-");
}

function parseSellFluxId(id: string): { date: string; time: string } | null {
  const match = id.match(/^sellflux-(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})$/);
  if (!match) return null;
  return { date: match[1], time: match[2] };
}

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
    const { time_slot_id, customer_name, customer_email, customer_phone, num_pilots, battery_type, tracking } = body;

    if (!time_slot_id || !customer_name || !customer_email || !customer_phone || !num_pilots || !battery_type) {
      return new Response(JSON.stringify({ error: "Campos obrigatórios faltando" }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customer_email)) {
      return new Response(JSON.stringify({ error: "E-mail inválido" }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
    }

    const pilots = Number(num_pilots);
    if (!Number.isInteger(pilots) || pilots < 1 || pilots > 12) {
      return new Response(JSON.stringify({ error: "Número de pilotos inválido (1-12)" }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
    }

    if (!["individual", "kids"].includes(battery_type)) {
      return new Response(JSON.stringify({ error: "Tipo de bateria inválido" }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
    }

    logStep("Validação OK", { time_slot_id, pilots, battery_type });

    let realTimeSlotId: string | null = null;
    let valor_total: number = 0;

    if (isSellFluxId(time_slot_id)) {
      logStep("Modo SellFlux", { time_slot_id });

      const parsed = parseSellFluxId(time_slot_id);
      if (!parsed) {
        return new Response(JSON.stringify({ error: "ID de slot inválido" }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
      }

      const { date, time } = parsed;
      const startTime = `${time}:00`;

      // Busca slot real no Supabase pela data e hora
      const { data: slot } = await supabase
        .from("time_slots")
        .select("id, track:tracks(price_per_pilot, price_kids)")
        .eq("date", date)
        .eq("start_time", startTime)
        .limit(1)
        .single();

      if (slot) {
        realTimeSlotId = slot.id;
        const track = slot.track as any;
        const pricePerPilot = battery_type === "kids" ? Number(track?.price_kids) : Number(track?.price_per_pilot);
        valor_total = pricePerPilot * pilots;
        logStep("Slot Supabase encontrado", { realTimeSlotId, valor_total });
      } else {
        // Slot não existe no Supabase — calcula preço pela pista principal
        const { data: track } = await supabase
          .from("tracks")
          .select("price_per_pilot, price_kids")
          .eq("is_active", true)
          .not("name", "ilike", "%kids%")
          .limit(1)
          .single();

        const pricePerPilot = battery_type === "kids" ? Number(track?.price_kids || 8000) : Number(track?.price_per_pilot || 10000);
        valor_total = pricePerPilot * pilots;
        realTimeSlotId = null;
        logStep("Slot Supabase não encontrado, reserva sem slot", { valor_total });
      }

    } else {
      // Fluxo original UUID Supabase
      logStep("Modo Supabase UUID", { time_slot_id });

      const { data: slot, error: slotError } = await supabase
        .from("time_slots")
        .select("ocupados_atualmente, max_capacity, is_available")
        .eq("id", time_slot_id)
        .single();

      if (slotError || !slot) {
        return new Response(JSON.stringify({ error: "Horário não encontrado" }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 });
      }

      if (!slot.is_available) {
        return new Response(JSON.stringify({ error: "Horário indisponível" }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
      }

      const vagas = slot.max_capacity - slot.ocupados_atualmente;
      if (pilots > vagas) {
        return new Response(JSON.stringify({ error: `Capacidade excedida. Vagas disponíveis: ${vagas}` }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
      }

      const { data: slotWithTrack } = await supabase
        .from("time_slots")
        .select("track:tracks(price_per_pilot, price_kids)")
        .eq("id", time_slot_id)
        .single();

      const track = (slotWithTrack?.track) as any;
      const pricePerPilot = battery_type === "kids" ? Number(track?.price_kids) : Number(track?.price_per_pilot);
      valor_total = pricePerPilot * pilots;
      realTimeSlotId = time_slot_id;
    }

    // Dados de rastreamento do Meta (usados no Purchase via Conversions API)
    const forwardedFor = req.headers.get("x-forwarded-for") || "";
    const clientIp = forwardedFor.split(",")[0].trim() || null;
    const userAgent = req.headers.get("user-agent")?.slice(0, 500) || null;
    // Vem do navegador sem validação: aceita só string e limita o tamanho, pra um
    // valor estranho não derrubar o insert da reserva.
    const trackingField = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 500) : null);

    // Cria a reserva
    const baseReservation = {
      time_slot_id: realTimeSlotId,
      customer_name: customer_name.trim(),
      customer_email: customer_email.trim().toLowerCase(),
      customer_phone: customer_phone.replace(/\D/g, ""),
      num_pilots: pilots,
      battery_type,
      valor_total,
      status: "pending",
    };

    let { data: reservation, error: insertError } = await supabase
      .from("reservations")
      .insert({
        ...baseReservation,
        fbp: trackingField(tracking?.fbp),
        fbc: trackingField(tracking?.fbc),
        external_id: trackingField(tracking?.external_id),
        event_source_url: trackingField(tracking?.event_source_url),
        client_user_agent: userAgent,
        client_ip_address: clientIp,
      })
      .select("*")
      .single();

    // Se a migration das colunas de rastreamento ainda não rodou, a reserva não pode
    // deixar de ser criada: repete o insert sem esses campos e segue o fluxo.
    if (insertError && /column|schema cache/i.test(insertError.message || "")) {
      logStep("Colunas de rastreamento ausentes, criando reserva sem elas", { error: insertError.message });
      ({ data: reservation, error: insertError } = await supabase
        .from("reservations")
        .insert(baseReservation)
        .select("*")
        .single());
    }

    if (insertError) {
      logStep("Erro ao criar reserva", { error: insertError });
      return new Response(JSON.stringify({ error: "Erro ao criar reserva" }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
    }

    logStep("Reserva criada", { id: reservation.id, valor_total });

    return new Response(JSON.stringify({ reservation }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 201 });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: "Erro interno" }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});
