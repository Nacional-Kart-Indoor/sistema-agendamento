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
import { identify, trackMetaEvent, trackMetaCustomEvent, trackOnce } from '@/lib/meta-pixel';
import { bookingEventParams, purchaseEventId, reservationPurchaseParams } from '@/lib/meta-booking';

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

  // Purchase (browser). Dispara uma única vez por reserva (sessionStorage, então
  // sobrevive a reload). O mesmo event_id sai pela Conversions API no
  // stripe-webhook, e o Meta deduplica os dois envios.
  const trackPurchase = (res: Reservation) => {
    if (!res?.id || res.status !== 'paid') return;
    trackOnce(`nki_purchase_${res.id}`, () => {
      identify({ email: res.customer_email, phone: res.customer_phone, name: res.customer_name });
      trackMetaEvent('Purchase', reservationPurchaseParams(res), purchaseEventId(res.id));
    });
  };

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
      trackMetaCustomEvent('CheckoutCancelled', { reservation_id: reservationId ?? undefined });
    }
  }, []);

  const verifyPayment = async (reservationId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('verify-asaas-payment', {
        body: { reservation_id: reservationId },
      });

      if (!error && data?.reservation) {
        const res = fixTrackName(data.reservation);
        setReservationFromPayment(res as Reservation);
        setPaymentStatus('success');
        goToStep('confirmation');
        trackPurchase(res as Reservation);
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
      setReservationFromPayment(res as unknown as Reservation);
      setPaymentStatus('success');
      goToStep('confirmation');
      trackPurchase(res as unknown as Reservation);
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

  // ViewContent: cliente selecionou um horário (equivale à página de produto).
  useEffect(() => {
    if (bookingData.timeSlot && bookingData.track) {
      trackMetaEvent('ViewContent', bookingEventParams(bookingData, total));
    }
    // Dispara apenas quando o horário muda, não a cada alteração de pilotos/bateria.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingData.timeSlot?.id]);

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
              onNext={() => {
                trackMetaEvent('AddToCart', bookingEventParams(bookingData, total));
                goToStep('customer');
              }}
            />
          )}
          {step === 'customer' && (
            <CustomerStep
              bookingData={bookingData}
              onUpdate={updateBookingData}
              onBack={() => goToStep('details')}
              onNext={() => {
                identify({
                  email: bookingData.customerEmail,
                  phone: bookingData.customerPhone,
                  name: bookingData.customerName,
                });
                trackMetaEvent('InitiateCheckout', bookingEventParams(bookingData, total));
                goToStep('payment');
              }}
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
              onReset={reset}
            />
          )}
        </div>
      </main>
    </div>
  );
}
