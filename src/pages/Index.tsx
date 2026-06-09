import { useEffect } from 'react';
import { useBooking } from '@/hooks/useBooking';
import { useSearchParams } from 'react-router-dom';
import { BookingHeader } from '@/components/booking/BookingHeader';
import { StepIndicator } from '@/components/booking/StepIndicator';
import { DateStep } from '@/components/booking/DateStep';
import { DetailsStep } from '@/components/booking/DetailsStep';
import { CustomerStep } from '@/components/booking/CustomerStep';
import { PaymentStep } from '@/components/booking/PaymentStep';
import { ConfirmationStep } from '@/components/booking/ConfirmationStep';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const Index = () => {
  const [searchParams, setSearchParams] = useSearchParams();
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

  useEffect(() => {
    fetchTracks();
  }, [fetchTracks]);

  // Handle Stripe payment return
  useEffect(() => {
    const payment = searchParams.get('payment');
    const reservationId = searchParams.get('reservation_id');
    const sessionId = searchParams.get('session_id');

    if (payment === 'success' && reservationId && sessionId) {
      // Verify payment with backend before showing confirmation
      const verifyPayment = async () => {
        try {
          toast.info('Verificando pagamento...');
          
          const { data, error } = await supabase.functions.invoke('verify-checkout-session', {
            body: { session_id: sessionId, reservation_id: reservationId },
          });

          if (error) {
            console.error('Verify error:', error);
            toast.error('Erro ao verificar pagamento. Tente recarregar a página.');
            return;
          }

          if (data?.paid && data?.reservation) {
            setReservationFromPayment(data.reservation);
            goToStep('confirmation');
            toast.success('Pagamento confirmado com sucesso!');
          } else {
            // Payment not yet confirmed — show confirmation page with pending status
            const { data: resData } = await supabase
              .from('reservations')
              .select('*')
              .eq('id', reservationId)
              .single();
            
            if (resData) {
              setReservationFromPayment(resData);
              goToStep('confirmation');
            }
            toast.warning('Pagamento ainda sendo processado. Aguarde alguns instantes.');
          }
        } catch (err) {
          console.error('Verify error:', err);
          toast.error('Erro ao verificar pagamento.');
        }
      };

      verifyPayment();
      // Clean URL params
      setSearchParams({});
    } else if (payment === 'cancelled') {
      toast.error('Pagamento cancelado. Você pode tentar novamente.');
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, goToStep, setReservationFromPayment]);

  const handleConfirm = async (): Promise<boolean> => {
    await createReservation();
    // Don't navigate to confirmation here — the Stripe redirect will bring the user back
    // with ?payment=success, which is handled by the useEffect above
    return false;
  };

  return (
    <div className="min-h-screen bg-background">
      <BookingHeader />
      
      <StepIndicator currentStep={step} />

      <main className="container max-w-6xl mx-auto px-4 py-8">
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
            onNext={() => goToStep('customer')}
            onBack={() => goToStep('date')}
          />
        )}

        {step === 'customer' && (
          <CustomerStep
            bookingData={bookingData}
            onUpdate={updateBookingData}
            onNext={() => goToStep('payment')}
            onBack={() => goToStep('details')}
          />
        )}

        {step === 'payment' && (
          <PaymentStep
            bookingData={bookingData}
            onUpdate={updateBookingData}
            calculateTotal={calculateTotal}
            onConfirm={handleConfirm}
            onBack={() => goToStep('customer')}
            loading={loading}
          />
        )}

        {step === 'confirmation' && (
          <ConfirmationStep
            bookingData={bookingData}
            reservation={reservation}
            onReset={reset}
          />
        )}
      </main>

      <footer className="py-6 text-center text-sm text-muted-foreground border-t border-border">
        <p>© 2024 Nacional Kart. Todos os direitos reservados.</p>
      </footer>
    </div>
  );
};

export default Index;
