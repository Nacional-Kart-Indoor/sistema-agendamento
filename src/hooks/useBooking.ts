import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { BookingData, BookingStep, Track, TimeSlot, BatteryType, Reservation } from '@/types/booking';
import { toast } from 'sonner';
import { format } from 'date-fns';
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

  const fetchTimeSlots = useCallback(async (date: Date, trackId?: string) => {
    const dateStr = date.toISOString().split('T')[0];

    let query = supabase
      .from('time_slots')
      .select('*, track:tracks(*)')
      .eq('date', dateStr)
      .eq('is_available', true);

    if (trackId) {
      query = query.eq('track_id', trackId);
    }

    const { data, error } = await query.order('start_time');

    if (error) {
      toast.error('Erro ao carregar horários');
      return;
    }

    setTimeSlots(data || []);
  }, []);

  const calculateTotal = useCallback(
    (track: Track | null, numPilots: number, batteryType: BatteryType): number => {
      if (!track) return 0;
      const pricePerPilot = batteryType === 'kids' ? track.price_kids : track.price_per_pilot;
      return pricePerPilot * numPilots;
    },
    []
  );

  const updateBookingData = useCallback((data: Partial<BookingData>) => {
    setBookingData((prev) => ({ ...prev, ...data }));
  }, []);

  const checkCapacity = useCallback((timeSlot: TimeSlot | null, numPilots: number): boolean => {
    if (!timeSlot) return false;
    const available = timeSlot.max_capacity - timeSlot.ocupados_atualmente;
    return numPilots <= available;
  }, []);

  const createReservation = useCallback(async (): Promise<boolean> => {
    setLoading(true);

    try {
      const { date, timeSlot, track, numPilots, batteryType, customerName, customerEmail, customerPhone } =
        bookingData;

      if (!timeSlot || !track || !date) {
        toast.error('Dados da reserva incompletos');
        return false;
      }

      // Re-check capacity directly from the DB (source of truth)
      const { data: currentSlot } = await supabase
        .from('time_slots')
        .select('ocupados_atualmente, max_capacity')
        .eq('id', timeSlot.id)
        .single();

      if (!currentSlot || currentSlot.ocupados_atualmente + numPilots > currentSlot.max_capacity) {
        toast.error('Capacidade excedida. Por favor, escolha outro horário.');
        return false;
      }

      const valorTotal = calculateTotal(track, numPilots, batteryType);

      const { data: reservationData, error } = await supabase
        .from('reservations')
        .insert({
          time_slot_id: timeSlot.id,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
          num_pilots: numPilots,
          battery_type: batteryType,
          valor_total: valorTotal,
          status: 'pending',
        })
        .select('*')
        .single();

      if (error) {
        toast.error('Erro ao criar reserva');
        console.error(error);
        return false;
      }

      setReservation(reservationData);

      const dateStr = format(date, 'dd/MM/yyyy', { locale: ptBR });
      const timeStr = `${timeSlot.start_time.slice(0, 5)} - ${timeSlot.end_time.slice(0, 5)}`;

      const { data: checkoutData, error: checkoutError } = await supabase.functions.invoke(
        'create-checkout',
        {
          body: {
            reservation_id: reservationData.id,
            customer_name: customerName,
            customer_email: customerEmail,
            customer_phone: customerPhone,
            track_id: track.id,
            track_name: track.name,
            date: dateStr,
            time_slot: timeStr,
            num_pilots: numPilots,
            battery_type: batteryType,
          },
        }
      );

      if (checkoutError || !checkoutData?.url) {
        console.error('Checkout error:', checkoutError);
        toast.error('Erro ao iniciar pagamento. Tente novamente.');
        return false;
      }

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
