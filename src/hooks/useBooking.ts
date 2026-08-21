import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { BookingData, BookingStep, Track, TimeSlot, BatteryType, Reservation } from '@/types/booking';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { getTrackingPayload } from '@/lib/meta-pixel';
import { ptBR } from 'date-fns/locale';

const initialBookingData: BookingData = {
  date: null,
  timeSlot: null,
  track: null,
  numPilots: 1,
  batteryType: 'individual',
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  customerCpf: '',
  paymentMethod: 'pix',
};

export function useBooking() {
  const [step, setStep] = useState<BookingStep>('date');
  const [bookingData, setBookingData] = useState<BookingData>(initialBookingData);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [reservation, setReservation] = useState<Reservation | null>(null);

  const fetchTracks = useCallback(async () => {
    const { data, error } = await supabase
      .from('tracks')
      .select('*')
      .eq('is_active', true);

    if (error) {
      toast.error('Erro ao carregar pistas');
      return;
    }
    setTracks(data || []);
  }, []);

  // ─── NOVA FUNÇÃO: busca disponibilidade no SellFlux ──────────────────────────
  const fetchTimeSlots = useCallback(async (date: Date, trackId?: string) => {
    const dateStr = date.toISOString().split('T')[0];

    // Pista Kids não usa SellFlux — retorna vazio por enquanto
    // (no futuro será integrada separadamente)
    const kartodromoTrackId = tracks.find(
      (t) => t.name.toLowerCase().includes('principal') || 
             t.name.toLowerCase().includes('adulto') ||
             (!t.name.toLowerCase().includes('kids') && !t.name.toLowerCase().includes('infantil'))
    )?.id;

    if (trackId && trackId !== kartodromoTrackId) {
      setTimeSlots([]);
      return;
    }

    try {
      // Chama a Edge Function que consulta o SellFlux
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(
        `${supabaseUrl}/functions/v1/get-sellflux-availability?date=${dateStr}`,
        {
          headers: {
            Authorization: `Bearer ${anonKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Erro ao consultar disponibilidade');
      }

      const availability = await response.json();

      // Converte o formato do SellFlux para o formato TimeSlot que o DetailsStep espera
      // Isso garante que o DetailsStep.tsx não precisa de nenhuma alteração
      const slots: TimeSlot[] = availability.slots
        .map((slot: any, index: number) => {
          // Calcula horário de fim (30 min depois)
          const [h, m] = slot.time.split(':').map(Number);
          const endMinutes = h * 60 + m + 30;
          const endH = Math.floor(endMinutes / 60).toString().padStart(2, '0');
          const endM = (endMinutes % 60).toString().padStart(2, '0');
          const endTime = `${endH}:${endM}:00`;

          return {
            id: `sellflux-${dateStr}-${slot.time}`, // ID único baseado na data e hora
            date: dateStr,
            start_time: `${slot.time}:00`,
            end_time: endTime,
            max_capacity: slot.capacity,
            ocupados_atualmente: slot.occupied,
            is_available: slot.is_available,
            track_id: trackId || kartodromoTrackId || '',
            track: tracks.find((t) => t.id === (trackId || kartodromoTrackId)) || null,
          } as TimeSlot;
        });

      setTimeSlots(slots);
    } catch (error) {
      console.error('Erro ao buscar disponibilidade SellFlux:', error);
      toast.error('Erro ao carregar horários disponíveis');
      setTimeSlots([]);
    }
  }, [tracks]);
  // ─────────────────────────────────────────────────────────────────────────────

  const calculateTotal = useCallback(
    (track: Track | null, numPilots: number, batteryType: BatteryType): number => {
      if (!track) return 0;
      const pricePerPilot =
        batteryType === 'kids' ? track.price_kids : track.price_per_pilot;
      return pricePerPilot * numPilots;
    },
    []
  );

  const updateBookingData = useCallback((data: Partial<BookingData>) => {
    setBookingData((prev) => ({ ...prev, ...data }));
  }, []);

  const checkCapacity = useCallback(
    (timeSlot: TimeSlot | null, numPilots: number): boolean => {
      if (!timeSlot) return false;
      const available = timeSlot.max_capacity - timeSlot.ocupados_atualmente;
      return numPilots <= available;
    },
    []
  );

  const createReservation = useCallback(async (): Promise<boolean> => {
    setLoading(true);

    try {
      const {
        date,
        timeSlot,
        track,
        numPilots,
        batteryType,
        customerName,
        customerEmail,
        customerPhone,
        customerCpf,
      } = bookingData;

      if (!timeSlot || !track || !date) {
        toast.error('Dados da reserva incompletos');
        return false;
      }

      // Cria a reserva via Edge Function (nunca acessa a tabela diretamente)
      const { data: reservationData, error: reservationError } =
        await supabase.functions.invoke('create-reservation', {
          body: {
            time_slot_id: timeSlot.id,
            customer_name: customerName,
            customer_email: customerEmail,
            customer_phone: customerPhone,
            num_pilots: numPilots,
            battery_type: batteryType,
            // cookies do Meta + external_id: usados no Purchase via Conversions API
            tracking: getTrackingPayload(),
          },
        });

      if (reservationError || !reservationData?.reservation) {
        const msg =
          reservationData?.error || 'Erro ao criar reserva. Tente novamente.';
        toast.error(msg);
        console.error('create-reservation error:', reservationError, reservationData);
        return false;
      }

      const createdReservation: Reservation = reservationData.reservation;
      setReservation(createdReservation);

      // Cria a cobrança na Asaas e obtém a URL da página de pagamento hospedada
      const dateStr = format(date, 'dd/MM/yyyy', { locale: ptBR });
      const timeStr = `${timeSlot.start_time.slice(0, 5)} - ${timeSlot.end_time.slice(0, 5)}`;

      const { data: checkoutData, error: checkoutError } =
        await supabase.functions.invoke('create-asaas-charge', {
          body: {
            reservation_id: createdReservation.id,
            customer_name: customerName,
            customer_email: customerEmail,
            customer_phone: customerPhone,
            cpf_cnpj: customerCpf,
            track_id: track.id,
            track_name: track.name,
            date: dateStr,
            time_slot: timeStr,
            num_pilots: numPilots,
            battery_type: batteryType,
          },
        });

      if (checkoutError || !checkoutData?.url) {
        console.error('Erro ao criar cobrança:', checkoutError, checkoutData);
        toast.error(checkoutData?.error || 'Erro ao iniciar pagamento. Tente novamente.');
        return false;
      }

      // Redireciona para a página de pagamento da Asaas
      window.location.href = checkoutData.url;
      return false;
    } catch (error) {
      toast.error('Erro inesperado');
      console.error(error);
      return false;
    } finally {
      setLoading(false);
    }
  }, [bookingData, calculateTotal]);

  const goToStep = useCallback((newStep: BookingStep) => {
    setStep(newStep);
  }, []);

  const setReservationFromPayment = useCallback((data: Reservation) => {
    setReservation(data);
  }, []);

  const reset = useCallback(() => {
    setStep('date');
    setBookingData(initialBookingData);
    setReservation(null);
  }, []);

  return {
    step,
    bookingData,
    tracks,
    timeSlots,
    loading,
    reservation,
    fetchTracks,
    fetchTimeSlots,
    calculateTotal,
    updateBookingData,
    checkCapacity,
    createReservation,
    goToStep,
    reset,
    setReservationFromPayment,
  };
}
