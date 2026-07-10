import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BookingData, Track, BatteryType } from '@/types/booking';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowLeft, CreditCard, Loader2, ShieldCheck } from 'lucide-react';

interface PaymentStepProps {
  bookingData: BookingData;
  onUpdate: (data: Partial<BookingData>) => void;
  calculateTotal: (track: Track | null, numPilots: number, batteryType: BatteryType) => number;
  onConfirm: () => Promise<boolean>;
  onBack: () => void;
  loading: boolean;
}

export function PaymentStep({
  bookingData,
  calculateTotal,
  onConfirm,
  onBack,
  loading,
}: PaymentStepProps) {
  const total = calculateTotal(bookingData.track, bookingData.numPilots, bookingData.batteryType);

  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <div className="animate-slide-up max-w-lg mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
          <CreditCard className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-racing font-bold mb-2">Resumo e Pagamento</h2>
        <p className="text-muted-foreground">Revise sua reserva antes de prosseguir ao pagamento</p>
      </div>

      <Card className="card-racing p-6">
        <h3 className="text-lg font-semibold mb-4">Resumo da Reserva</h3>
        
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Data</span>
            <span className="font-medium">
              {bookingData.date && format(bookingData.date, "dd/MM/yyyy", { locale: ptBR })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Horário</span>
            <span className="font-medium">
              {bookingData.timeSlot?.start_time.slice(0, 5)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Pista</span>
            <span className="font-medium">{bookingData.track?.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Pilotos</span>
            <span className="font-medium">{bookingData.numPilots}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tipo de Bateria</span>
            <span className="font-medium">
              {bookingData.batteryType === 'kids' ? 'Kids' : 'Individual'}
            </span>
          </div>
          
          <div className="border-t border-border my-4" />
          
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cliente</span>
            <span className="font-medium">{bookingData.customerName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">E-mail</span>
            <span className="font-medium text-xs">{bookingData.customerEmail}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Telefone</span>
            <span className="font-medium">{bookingData.customerPhone}</span>
          </div>
        </div>

        <div className="mt-6 p-4 rounded-lg bg-primary/10 border border-primary/20">
          <div className="flex justify-between items-center">
            <span className="text-lg font-semibold">Total</span>
            <span className="text-2xl font-racing font-bold text-primary">
              R$ {total.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="w-4 h-4 text-primary" />
          <span>Você será redirecionado para o ambiente seguro do Stripe para concluir o pagamento.</span>
        </div>
      </Card>

      <div className="flex justify-between mt-8">
        <Button variant="outline" size="lg" onClick={onBack} disabled={loading}>
          <ArrowLeft className="w-5 h-5 mr-2" />
          Voltar
        </Button>
        <Button
          variant="racing"
          size="lg"
          onClick={handleConfirm}
          disabled={loading}
          className="min-w-[200px]"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Processando...
            </>
          ) : (
            <>
              Pagar com Stripe
              <CreditCard className="w-5 h-5 ml-2" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
