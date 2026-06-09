import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BookingData, Reservation } from '@/types/booking';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CheckCircle, Calendar, Clock, MapPin, Users, Zap, Mail, Phone, Download, Home, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConfirmationStepProps {
  bookingData: BookingData;
  reservation: Reservation | null;
  onReset: () => void;
}

export function ConfirmationStep({ bookingData, reservation, onReset }: ConfirmationStepProps) {
  const isPaid = reservation?.status === 'paid';

  return (
    <div className="animate-slide-up max-w-lg mx-auto">
      <div className="text-center mb-8">
        <div className={cn(
          "inline-flex items-center justify-center w-20 h-20 rounded-full mb-4 transition-all",
          isPaid ? "bg-racing-success/20" : "bg-secondary/20"
        )}>
          {isPaid ? (
            <CheckCircle className="w-10 h-10 text-racing-success" />
          ) : (
            <Loader2 className="w-10 h-10 text-secondary animate-spin" />
          )}
        </div>
        <h2 className="text-3xl font-racing font-bold mb-2">
          {isPaid ? 'Reserva Confirmada!' : 'Aguardando Pagamento'}
        </h2>
        <p className="text-muted-foreground">
          {isPaid
            ? 'Sua bateria está garantida. Prepare-se para acelerar!'
            : 'Seu pagamento está sendo processado. A confirmação pode levar alguns segundos.'
          }
        </p>
        {!isPaid && (
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Verificar pagamento novamente
          </Button>
        )}
      </div>

      <Card className="card-racing p-6 racing-stripe">
        <div className="text-center mb-6">
          <p className="text-sm text-muted-foreground">Código da Reserva</p>
          <p className="text-2xl font-racing font-bold text-primary">
            #{reservation?.id.slice(0, 8).toUpperCase()}
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
            <Calendar className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Data</p>
              <p className="font-medium">
                {bookingData.date && format(bookingData.date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
            <Clock className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Horário</p>
              <p className="font-medium">
                {bookingData.timeSlot?.start_time.slice(0, 5)} às {bookingData.timeSlot?.end_time.slice(0, 5)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
            <MapPin className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Pista</p>
              <p className="font-medium">{bookingData.track?.name}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Users className="w-5 h-5 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Pilotos</p>
                <p className="font-medium">{bookingData.numPilots}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Zap className="w-5 h-5 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Bateria</p>
                <p className="font-medium">
                  {bookingData.batteryType === 'kids' ? 'Kids' : 'Individual'}
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-border my-4" />

          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
            <Mail className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">E-mail de confirmação enviado para</p>
              <p className="font-medium">{bookingData.customerEmail}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
            <Phone className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Telefone</p>
              <p className="font-medium">{bookingData.customerPhone}</p>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-primary/10 border border-primary/20 text-center">
            <p className="text-sm text-muted-foreground">Valor Total Pago</p>
            <p className="text-3xl font-racing font-bold racing-text-gradient">
              R$ {reservation?.valor_total?.toFixed(2)}
            </p>
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-3 mt-8">
        <Button variant="racing" size="lg" className="w-full">
          <Download className="w-5 h-5 mr-2" />
          Baixar Comprovante
        </Button>
        <Button variant="outline" size="lg" onClick={onReset} className="w-full">
          <Home className="w-5 h-5 mr-2" />
          Nova Reserva
        </Button>
      </div>

      <p className="text-xs text-muted-foreground text-center mt-6">
        Chegue com 15 minutos de antecedência para o briefing de segurança.
        <br />
        Em caso de dúvidas, entre em contato: (11) 9999-9999
      </p>
    </div>
  );
}
