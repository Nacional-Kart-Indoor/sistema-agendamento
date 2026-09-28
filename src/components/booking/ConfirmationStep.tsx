import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Reservation } from '@/types/booking';
import { CheckCircle, Calendar, Clock, MapPin, Users, Zap, Mail, Phone, Home, Loader2, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConfirmationStepProps {
  reservation: Reservation | null;
  onReset: () => void;
}

export function ConfirmationStep({ reservation, onReset }: ConfirmationStepProps) {
  // Proteção total — não renderiza nada se não tiver reserva
  if (!reservation) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const isPaid = reservation?.status === 'paid';

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return '';
    try {
      const parts = dateStr.split('-').map(Number);
      if (parts.length < 3 || parts.some(isNaN)) return '';
      const [year, month, day] = parts;
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  };

  const formatTime = (start?: string | null, end?: string | null) => {
    if (!start || !end) return '';
    try {
      return `${start.slice(0, 5)} às ${end.slice(0, 5)}`;
    } catch {
      return '';
    }
  };

  const formatPhone = (phone?: string | null) => {
    if (!phone) return '';
    try {
      const digits = phone.replace(/\D/g, '');
      if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
      if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
      return phone;
    } catch {
      return phone || '';
    }
  };

  const timeSlot = (reservation as any)?.time_slots ?? null;
  const track = timeSlot?.tracks ?? (reservation as any)?.track ?? null;
  const dateStr = timeSlot?.date ?? null;
  const startTime = timeSlot?.start_time ?? null;
  const endTime = timeSlot?.end_time ?? null;

  // Nome da pista com fallback
  const rawTrackName = track?.name ?? (reservation as any)?.track_name ?? '';
  const isKidsTrack = rawTrackName.toLowerCase().includes('kids') || rawTrackName.toLowerCase().includes('infantil');
  const trackName = (isKidsTrack && reservation.battery_type !== 'kids') 
    ? 'Kartódromo Principal' 
    : (rawTrackName || 'Kartódromo Principal');

  // Código de reserva
  const reservationCode = (reservation as any)?.reservation_code 
    || (reservation?.id ? `#${reservation.id.slice(0, 8).toUpperCase()}` : '');

  // Valor
  const valorTotal = (reservation as any)?.valor_total ?? 0;

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
            : 'Seu pagamento está sendo processado.'
          }
        </p>
        {!isPaid && (
          <Button variant="outline" size="sm" className="mt-4" onClick={() => window.location.reload()}>
            Verificar pagamento novamente
          </Button>
        )}
      </div>

      <Card className="card-racing p-6 racing-stripe">
        <div className="text-center mb-6">
          <p className="text-sm text-muted-foreground">Código da Reserva</p>
          <p className="text-2xl font-racing font-bold text-primary">{reservationCode}</p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
            <Calendar className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Data</p>
              <p className="font-medium">{formatDate(dateStr)}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
            <Clock className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Horário</p>
              <p className="font-medium">{formatTime(startTime, endTime)}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
            <MapPin className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Pista</p>
              <p className="font-medium">{trackName}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Users className="w-5 h-5 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Pilotos</p>
                <p className="font-medium">{reservation?.num_pilots ?? '-'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Zap className="w-5 h-5 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Bateria</p>
                <p className="font-medium">
                  {reservation?.battery_type === 'kids' ? 'Kids' : 'Individual'}
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-border my-4" />

          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
            <Mail className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">E-mail</p>
              <p className="font-medium">{reservation?.customer_email ?? ''}</p>
            </div>
          </div>

          <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
            <Phone className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Telefone</p>
              <p className="font-medium">{formatPhone(reservation?.customer_phone)}</p>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-primary/10 border border-primary/20 text-center">
            <p className="text-sm text-muted-foreground">Valor Total Pago</p>
            <p className="text-3xl font-racing font-bold racing-text-gradient">
              R$ {Number(valorTotal).toFixed(2)}
            </p>
          </div>
        </div>
      </Card>

      {isPaid && reservation.num_pilots > 1 && reservation.pilotos_token && (
        <Card className="p-5 mt-6 border-secondary/40 bg-secondary/5">
          <div className="flex items-start gap-3">
            <UserPlus className="w-5 h-5 text-secondary shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-sm mb-1">
                {reservation.pilotos_completos ? 'Dados dos pilotos completos ✅' : 'Falta cadastrar os outros pilotos'}
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                {reservation.pilotos_completos
                  ? 'Nome e CPF dos pilotos extras já foram enviados.'
                  : `Precisamos do nome e CPF dos outros ${reservation.num_pilots - 1} piloto(s) — esse link também foi enviado por WhatsApp.`}
              </p>
              {!reservation.pilotos_completos && (
                <Button variant="secondary" size="sm" asChild>
                  <a href={`/reserva/${reservation.pilotos_token}/pilotos`}>
                    Cadastrar pilotos
                  </a>
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3 mt-8">
        <Button variant="outline" size="lg" onClick={onReset} className="w-full">
          <Home className="w-5 h-5 mr-2" />
          Nova Reserva
        </Button>
      </div>

      <p className="text-xs text-muted-foreground text-center mt-6">
        Chegue com 20 minutos de antecedência para o briefing de segurança.
        <br />
        Em caso de dúvidas, entre em contato: (62) 99287-6718
      </p>
    </div>
  );
}
