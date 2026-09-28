import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[GET-RESERVATION-PILOTS] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();

    if (!token || typeof token !== "string") {
      return new Response(JSON.stringify({ error: "Link inválido" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Só busca reservas pagas — token de reserva não paga/cancelada não deve
    // funcionar (não existiria de qualquer forma, mas por clareza).
    const { data: reservation, error } = await supabase
      .from("reservations")
      .select("id, customer_name, num_pilots, pilotos_completos, status")
      .eq("pilotos_token", token)
      .eq("status", "paid")
      .single();

    if (error || !reservation) {
      logStep("Token não encontrado", { error: error?.message });
      return new Response(JSON.stringify({ error: "Link inválido ou expirado" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    let pilots: { nome: string }[] = [];
    if (reservation.pilotos_completos) {
      const { data } = await supabase
        .from("reservation_pilots")
        .select("nome")
        .eq("reservation_id", reservation.id)
        .order("created_at");
      pilots = data || [];
    }

    return new Response(
      JSON.stringify({
        customer_name: reservation.customer_name,
        num_pilots: reservation.num_pilots,
        missing: Math.max(0, reservation.num_pilots - 1),
        pilotos_completos: reservation.pilotos_completos,
        pilots,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: "An error occurred processing your request" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
