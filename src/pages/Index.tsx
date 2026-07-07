import { useEffect, useState, useCallback } from 'react';
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

  // Verifica se voltou do Stripe com pagamento
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const sessionId = params.get('session_id');
    const reservationId = params.get('reservation_id');

    if (payment === 'success' && sessionId && reservationId) {
      setPaymentStatus('loading');
      verifyPayment(sessionId, reservationId);
      // Limpa a URL
      window.history.replaceState({}, '', '/');
    } else if (payment === 'cancelled') {
      setPaymentStatus('cancelled');
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const verifyPayment = async (sessionId: string, reservationId: string) => {
    try {
      // Tenta verificar via Edge Function
      const { data, error } = await supabase.functions.invoke('verify-checkout-session', {
        body: { session_id: sessionId, reservation_id: reservationId },
      });

      if (error || !data?.reservation) {
        // Fallback: busca direto no banco
        await fetchReservationDirect(reservationId);
        return;
      }

      const res = data.reservation;

      // Corrige nome da pista — se vier Pista Kids mas bateria não é kids, usa Kartódromo Principal
      if (res?.time_slots?.tracks?.name) {
        const trackName = res.time_slots.tracks.name.toLowerCase();
        if ((trackName.includes('kids') || trackName.includes('infantil')) && res.battery_type !== 'kids') {
          res.time_slots.tracks.name = 'Kartódromo Principal';
        }
      }

      setReservationFromPayment(res as Reservation);
      setPaymentStatus('success');
      goToStep('confirmation');
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

      // Corrige nome da pista
      if (data?.time_slots?.tracks?.name) {
        const trackName = (data.time_slots.tracks.name as string).toLowerCase();
        if ((trackName.includes('kids') || trackName.includes('infantil')) && data.battery_type !== 'kids') {
          (data.time_slots.tracks as any).name = 'Kartódromo Principal';
        }
      }

      setReservationFromPayment(data as unknown as Reservation);
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
              selectedDate={bookingData.date}
              onDateSelect={(date) => {
                updateBookingData({ date, timeSlot: null });
                goToStep('details');
              }}
            />
          )}

          {step === 'details' && (
            <DetailsStep
              bookingData={bookingData}
              tracks={tracks}
              timeSlots={timeSlots}
              total={total}
              onUpdate={updateBookingData}
              onBack={() => goToStep('date')}
              onContinue={() => goToStep('customer')}
              checkCapacity={checkCapacity}
            />
          )}

          {step === 'customer' && (
            <CustomerStep
              bookingData={bookingData}
              onUpdate={updateBookingData}
              onBack={() => goToStep('details')}
              onContinue={() => goToStep('payment')}
            />
          )}

          {step === 'payment' && (
            <PaymentStep
              bookingData={bookingData}
              total={total}
              loading={loading}
              onBack={() => goToStep('customer')}
              onPay={createReservation}
            />
          )}

          {step === 'confirmation' && (
            <ConfirmationStep
              reservation={reservation}
              onReset={reset}
            />
          )}
        </div>
      </main>
    </div>
  );
}
