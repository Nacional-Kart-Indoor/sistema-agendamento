import { useEffect, useRef, useState } from 'react';
import { useBooking } from '@/hooks/useBooking';
import { BookingHeader } from '@/components/booking/BookingHeader';
import { DateStep } from '@/components/booking/DateStep';
import { DetailsStep } from '@/components/booking/DetailsStep';
import { CustomerStep } from '@/components/booking/CustomerStep';
import { PaymentStep } from '@/components/booking/PaymentStep';
import { ConfirmationStep } from '@/components/booking/ConfirmationStep';
import { StepIndicator } from '@/components/booking/StepIndicator';
import { supabase } from '@/integrations/supabase/client';
import { Reservation } from '@/types/booking';
import { identify, track, trackOnce } from '@/lib/meta-pixel';
import { format } from 'date-fns';

// Corrige nome da pista com segurança total
function fixTrackName(res: any): any {
  if (!res) return res;
  try {
    if (res?.time_slots?.tracks?.name) {
      const name = String(res.time_slots.tracks.name).toLowerCase();
      if ((name.includes('kids') || name.includes('infantil')) && res.battery_type !== 'kids') {
        res.time_slots.tracks.name = 'Kartódromo Principal';
      }
    }
  } catch (e) {
    // silently ignore
  }
  return res;
}

// ─── Meta Pixel: Purchase ────────────────────────────────────────────────────
// Dispara uma única vez por reserva. O mesmo event_id sai pela Conversions API
// no stripe-webhook, então o Meta deduplica os dois envios.
function trackPurchase(reservation: any) {
  if (!reservation?.id || reservation.status !== 'paid') return;

  trackOnce(`nki_purchase_${reservation.id}`, () => {
    identify({
      email: reservation.customer_email,
      phone: reservation.customer_phone,
      name: reservation.customer_name,
    });

    track(
      'Purchase',
      {
        value: Number(reservation.valor_total || 0),
        currency: 'BRL',
        content_type: 'product',
        content_ids: [`bateria-${reservation.battery_type}`],
        content_name: `Bateria ${reservation.battery_type === 'kids' ? 'Kids' : 'Individual'}`,
        content_category: 'Agendamento de Kart',
        contents: [
          {
            id: `bateria-${reservation.battery_type}`,
            quantity: reservation.num_pilots,
            item_price:
              reservation.num_pilots > 0
                ? Number(reservation.valor_total || 0) / reservation.num_pilots
                : Number(reservation.valor_total || 0),
          },
        ],
        num_items: reservation.num_pilots,
        order_id: reservation.id,
      },
      `purchase-${reservation.id}`
    );
  });
}

export default function Index() {
  const {
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
  } = useBooking();

  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'success' | 'cancelled' | 'loading'>('idle');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const reservationId = params.get('reservation_id');

    if (payment === 'success' && reservationId) {
      setPaymentStatus('loading');
      window.history.replaceState({}, '', '/');
      verifyPayment(reservationId);
    } else if (payment === 'cancelled') {
      setPaymentStatus('cancelled');
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const verifyPayment = async (reservationId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-asaas-payment', {
        body: { reservation_id: reservationId },
      });

      if (!error && data?.reservation) {
        const res = fixTrackName(data.reservation);
        trackPurchase(res);
        setReservationFromPayment(res as Reservation);
        setPaymentStatus('success');
        goToStep('confirmation');
        return;
      }

      // Fallback direto no banco
      await fetchReservationDirect(reservationId);
    } catch (err) {
      console.error('Erro ao verificar pagamento:', err);
      await fetchReservationDirect(reservationId);
    }
  };

  const fetchReservationDirect = async (reservationId: string) => {
    try {
      const { data, error } = await supabase
        .from('reservations')
        .select('*, time_slots(date, start_time, end_time, track_id, tracks(id, name))')
        .eq('id', reservationId)
        .single();

      if (error || !data) {
        setPaymentStatus('cancelled');
        return;
      }

      const res = fixTrackName(data);
      trackPurchase(res);
      setReservationFromPayment(res as unknown as Reservation);
      setPaymentStatus('success');
      goToStep('confirmation');
    } catch (err) {
      console.error('Erro ao buscar reserva:', err);
      setPaymentStatus('cancelled');
    }
  };

  useEffect(() => {
    fetchTracks();
  }, [fetchTracks]);

  useEffect(() => {
    if (bookingData.date && bookingData.track) {
      fetchTimeSlots(bookingData.date, bookingData.track.id);
    }
  }, [bookingData.date, bookingData.track, fetchTimeSlots]);

  const total = calculateTotal(bookingData.track, bookingData.numPilots, bookingData.batteryType);

  // ─── Meta Pixel: etapas do funil ──────────────────────────────────────────
  const firedEvents = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Etapa 2 — escolheu a data e entrou em "Configure sua Bateria"
    if (step === 'details' && !firedEvents.current.has('AddToCart')) {
      firedEvents.current.add('AddToCart');
      track('AddToCart', {
        content_type: 'product',
        content_ids: ['bateria-kart'],
        content_name: 'Bateria de Kart',
        content_category: 'Agendamento de Kart',
        booking_date: bookingData.date ? format(bookingData.date, 'yyyy-MM-dd') : undefined,
      });
    }

    // Etapa 3 — chegou no "Resumo e Pagamento", já com valor fechado
    if (step === 'payment' && !firedEvents.current.has('InitiateCheckout')) {
      firedEvents.current.add('InitiateCheckout');

      identify({
        email: bookingData.customerEmail,
        phone: bookingData.customerPhone,
        name: bookingData.customerName,
      });

      const pricePerPilot =
        bookingData.numPilots > 0 ? total / bookingData.numPilots : total;

      track('InitiateCheckout', {
        value: Number(total.toFixed(2)),
        currency: 'BRL',
        content_type: 'product',
        content_ids: [`bateria-${bookingData.batteryType}`],
        content_name: `Bateria ${bookingData.batteryType === 'kids' ? 'Kids' : 'Individual'}`,
        content_category: 'Agendamento de Kart',
        contents: [
          {
            id: `bateria-${bookingData.batteryType}`,
            quantity: bookingData.numPilots,
            item_price: Number(pricePerPilot.toFixed(2)),
          },
        ],
        num_items: bookingData.numPilots,
        booking_date: bookingData.date ? format(bookingData.date, 'yyyy-MM-dd') : undefined,
        booking_time: bookingData.timeSlot?.start_time?.slice(0, 5),
        track_name: bookingData.track?.name,
      });
    }
  }, [step, total, bookingData]);

  const handleReset = () => {
    firedEvents.current.clear();
    reset();
  };

  const steps = ['date', 'details', 'customer', 'payment', 'confirmation'];
  const currentStepIndex = steps.indexOf(step);

  if (paymentStatus === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground">Confirmando seu pagamento...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <BookingHeader />
      <main className="container max-w-4xl mx-auto px-4 py-8">
        {step !== 'confirmation' && (
          <StepIndicator currentStep={currentStepIndex} totalSteps={4} />
        )}
        <div className="mt-8">
          {step === 'date' && (
            <DateStep
              bookingData={bookingData}
              onUpdate={updateBookingData}
              onNext={() => goToStep('details')}
            />
          )}
          {step === 'details' && (
            <DetailsStep
              bookingData={bookingData}
              tracks={tracks}
              timeSlots={timeSlots}
              onUpdate={updateBookingData}
              onFetchTimeSlots={fetchTimeSlots}
              calculateTotal={calculateTotal}
              checkCapacity={checkCapacity}
              onBack={() => goToStep('date')}
              onNext={() => goToStep('customer')}
            />
          )}
          {step === 'customer' && (
            <CustomerStep
              bookingData={bookingData}
              onUpdate={updateBookingData}
              onBack={() => goToStep('details')}
              onNext={() => goToStep('payment')}
            />
          )}
          {step === 'payment' && (
            <PaymentStep
              bookingData={bookingData}
              onUpdate={updateBookingData}
              calculateTotal={calculateTotal}
              loading={loading}
              onBack={() => goToStep('customer')}
              onConfirm={createReservation}
            />
          )}
          {step === 'confirmation' && (
            <ConfirmationStep
              reservation={reservation}
              onReset={handleReset}
            />
          )}
        </div>
      </main>
    </div>
  );
}
