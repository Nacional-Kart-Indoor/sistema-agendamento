import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-CHECKOUT] ${step}${detailsStr}`);
};

const validateInput = (body: any): { valid: boolean; error?: string; data?: any } => {
  const { reservation_id, customer_name, customer_email, customer_phone, track_id, num_pilots, battery_type } = body;

  if (!reservation_id || typeof reservation_id !== 'string') return { valid: false, error: "Invalid or missing reservation_id" };
  if (!track_id || typeof track_id !== 'string') return { valid: false, error: "Invalid or missing track_id" };
  if (!customer_name || typeof customer_name !== 'string' || customer_name.trim().length < 2 || customer_name.length > 100) return { valid: false, error: "Customer name must be 2-100 characters" };

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!customer_email || typeof customer_email !== 'string' || !emailRegex.test(customer_email) || customer_email.length > 255) return { valid: false, error: "Invalid email address" };

  const phoneDigits = customer_phone?.replace(/\D/g, '') || '';
  if (phoneDigits.length < 10 || phoneDigits.length > 15) return { valid: false, error: "Invalid phone number" };

  const pilots = Number(num_pilots);
  if (!Number.isInteger(pilots) || pilots < 1 || pilots > 12) return { valid: false, error: "Number of pilots must be between 1 and 12" };

  if (!['individual', 'kids'].includes(battery_type)) return { valid: false, error: "Invalid battery type" };

  return {
    valid: true,
    data: {
      reservation_id,
      customer_name: customer_name.trim(),
      customer_email: customer_email.trim().toLowerCase(),
      customer_phone: phoneDigits,
      track_id,
      num_pilots: pilots,
      battery_type,
      track_name: body.track_name || '',
      date: body.date || '',
      time_slot: body.time_slot || '',
    }
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

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

    const { reservation_id, customer_name, customer_email, customer_phone, track_id, track_name, date, time_slot, num_pilots, battery_type } = validation.data;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: track, error: trackError } = await supabase
      .from('tracks')
      .select('price_per_pilot, price_kids, name')
      .eq('id', track_id)
      .single();

    if (trackError || !track) {
      logStep("Track not found", { track_id, error: trackError?.message });
      return new Response(JSON.stringify({ error: "Track not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const pricePerPilot = battery_type === 'kids' ? Number(track.price_kids) : Number(track.price_per_pilot);
    const valorTotal = pricePerPilot * num_pilots;

    logStep("Price calculated server-side", { pricePerPilot, num_pilots, valorTotal });

    const { error: updateError } = await supabase
      .from('reservations')
      .update({ valor_total: valorTotal })
      .eq('id', reservation_id);

    if (updateError) {
      logStep("Failed to update reservation price", { error: updateError.message });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const customers = await stripe.customers.list({ email: customer_email, limit: 1 });
    let customerId: string | undefined;

    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Found existing customer", { customerId });
    } else {
      const newCustomer = await stripe.customers.create({
        email: customer_email,
        name: customer_name,
        phone: customer_phone,
      });
      customerId = newCustomer.id;
      logStep("Created new customer", { customerId });
    }

    const origin = req.headers.get("origin") || "https://nacionalkartindoor.com.br";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'brl',
            product_data: {
              name: `Bateria ${battery_type === 'kids' ? 'Kids' : 'Individual'} - ${track_name || track.name}`,
              description: `${num_pilots} piloto(s) | ${date} às ${time_slot}`,
            },
            unit_amount: Math.round(valorTotal * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}&reservation_id=${reservation_id}`,
      cancel_url: `${origin}/?payment=cancelled&reservation_id=${reservation_id}`,
      metadata: {
        reservation_id,
        customer_name,
        customer_email,
        customer_phone,
        num_pilots: String(num_pilots),
        battery_type,
      },
    });

    logStep("Checkout session created", { sessionId: session.id, url: session.url });

    // Salva a URL de checkout e sua validade na reserva, para reaproveitar depois
    // na mensagem de recuperação de carrinho abandonado (notify-abandoned-cart).
    // session.expires_at vem em segundos (unix timestamp); o Stripe define isso
    // automaticamente para 24h à frente por padrão.
    if (session.url) {
      const expiresAtISO = session.expires_at
        ? new Date(session.expires_at * 1000).toISOString()
        : null;

      const { error: checkoutUrlUpdateError } = await supabase
        .from('reservations')
        .update({
          checkout_url: session.url,
          checkout_url_expires_at: expiresAtISO,
        })
        .eq('id', reservation_id);

      if (checkoutUrlUpdateError) {
        // Não bloqueia o fluxo — se isso falhar, a mensagem de recuperação
        // simplesmente cai no fallback (link da home) mais tarde.
        logStep("Failed to save checkout_url", { error: checkoutUrlUpdateError.message });
      } else {
        logStep("checkout_url saved", { reservation_id, expiresAtISO });
      }
    }

    return new Response(JSON.stringify({ url: session.url, session_id: session.id }), {
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