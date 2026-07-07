import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SELLFLUX_TOKEN = Deno.env.get("SELLFLUX_API_TOKEN")!;
const SELLFLUX_ACTING_USER_ID = Deno.env.get("SELLFLUX_ACTING_USER_ID")!;
const SELLFLUX_BASE = "https://apis.sellflux.app/api/v1";

const TRACK_CAPACITY = 12;
const OPERATING_HOURS = generateTimeSlots("10:00", "22:00", 30);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function generateTimeSlots(start: string, end: string, intervalMinutes: number): string[] {
  const slots: string[] = [];
  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  let currentMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  while (currentMinutes < endMinutes) {
    const h = Math.floor(currentMinutes / 60).toString().padStart(2, "0");
    const m = (currentMinutes % 60).toString().padStart(2, "0");
    slots.push(`${h}:${m}`);
    currentMinutes += intervalMinutes;
  }
  return slots;
}

function extractPilots(subject: string, description: string): number {
  const patterns = [
    /(\d+)\s*p\b/i,
    /(\d+)\s*pessoas/i,
    /(\d+)\s*pilotos/i,
    /e\s+(\d+)\s+pessoas/i,
    /para\s+(\d+)\s+pessoa/i,
    /grupo\s+de\s+(\d+)/i,
    /mais\s+(\d+)\s+pessoa/i,
  ];

  for (const pattern of patterns) {
    const match = subject.match(pattern);
    if (match) return parseInt(match[1]);
  }
  for (const pattern of patterns) {
    const match = description?.match(pattern);
    if (match) return parseInt(match[1]);
  }
  return 1;
}

// Converte data ISO para data no fuso de Brasília (YYYY-MM-DD)
function toBrasiliaDate(isoDate: string): string {
  const date = new Date(isoDate);
  // UTC-3
  const brasilia = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const y = brasilia.getUTCFullYear();
  const m = String(brasilia.getUTCMonth() + 1).padStart(2, "0");
  const d = String(brasilia.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Converte data ISO para hora no fuso de Brasília (HH:MM)
function toBrasiliaTime(isoDate: string): string {
  const date = new Date(isoDate);
  const brasilia = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  const h = String(brasilia.getUTCHours()).padStart(2, "0");
  const min = String(brasilia.getUTCMinutes()).padStart(2, "0");
  return `${h}:${min}`;
}

async function fetchSellFluxSchedules(date: string) {
  // Busca com only_my_participation=true para filtrar só Goiânia
  // Sem filtro de data pois o SellFlux ignora o filtro quando only_my_participation=true
  // Filtramos por data no código abaixo
  const url = new URL(`${SELLFLUX_BASE}/crm/schedules`);
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", "100");
  url.searchParams.set("only_my_participation", "true");
  url.searchParams.set("acting_user_id", SELLFLUX_ACTING_USER_ID);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${SELLFLUX_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`SellFlux API error: ${error}`);
  }

  const data = await response.json();
  const all = data.data || [];

  // Filtra por data no fuso de Brasília
  return all.filter((s: any) => toBrasiliaDate(s.start_date) === date);
}

function calculateOccupancyBySlot(schedules: any[]): Record<string, number> {
  const occupancy: Record<string, number> = {};
  for (const schedule of schedules) {
    const slotKey = toBrasiliaTime(schedule.start_date);
    const pilots = extractPilots(schedule.subject || "", schedule.description || "");
    occupancy[slotKey] = (occupancy[slotKey] || 0) + pilots;
  }
  return occupancy;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(
        JSON.stringify({ error: "Parâmetro 'date' obrigatório no formato YYYY-MM-DD" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const schedules = await fetchSellFluxSchedules(date);
    const occupancy = calculateOccupancyBySlot(schedules);

    const slots = OPERATING_HOURS.map((time) => {
      const occupied = occupancy[time] || 0;
      const available = Math.max(0, TRACK_CAPACITY - occupied);
      return {
        time,
        occupied,
        available,
        capacity: TRACK_CAPACITY,
        is_available: available > 0,
      };
    });

    return new Response(
      JSON.stringify({
        date,
        track: "Kartódromo Principal",
        capacity: TRACK_CAPACITY,
        slots,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Erro em get-sellflux-availability:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});