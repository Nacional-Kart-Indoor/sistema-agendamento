import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BookingData, Track, TimeSlot, BatteryType } from '@/types/booking';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowLeft, ArrowRight, Clock, MapPin, Users, Zap, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DetailsStepProps {
  bookingData: BookingData;
  tracks: Track[];
  timeSlots: TimeSlot[];
  onUpdate: (data: Partial<BookingData>) => void;
  onFetchTimeSlots: (date: Date, trackId?: string) => void;
  calculateTotal: (track: Track | null, numPilots: number, batteryType: BatteryType) => number;
  checkCapacity: (timeSlot: TimeSlot | null, numPilots: number) => boolean;
  onNext: () => void;
  onBack: () => void;
}

export function DetailsStep({
  bookingData,
  tracks,
  timeSlots,
  onUpdate,
  onFetchTimeSlots,
  calculateTotal,
  checkCapacity,
  onNext,
  onBack,
}: DetailsStepProps) {
  useEffect(() => {
    if (bookingData.date) {
      onFetchTimeSlots(bookingData.date, bookingData.track?.id);
    }
  }, [bookingData.date, bookingData.track?.id]);

  const handleTrackSelect = (trackId: string) => {
    const track = tracks.find((t) => t.id === trackId);
    onUpdate({ track, timeSlot: null });
  };

  const handleTimeSlotSelect = (slotId: string) => {
    const slot = timeSlots.find((s) => s.id === slotId);
    onUpdate({ timeSlot: slot });
  };

  const handleNumPilotsChange = (value: string) => {
    onUpdate({ numPilots: parseInt(value) });
  };

  const handleBatteryTypeChange = (value: BatteryType) => {
    onUpdate({ batteryType: value });
  };

  const total = calculateTotal(bookingData.track, bookingData.numPilots, bookingData.batteryType);

  const getAvailableSpots = (slot: TimeSlot): number => {
    return Math.max(0, slot.max_capacity - slot.ocupados_atualmente);
  };

  const availableSpots = bookingData.timeSlot ? getAvailableSpots(bookingData.timeSlot) : 12;
  const capacityExceeded = !!bookingData.timeSlot && bookingData.numPilots > availableSpots;

  const canProceed = !!bookingData.track && !!bookingData.timeSlot && !capacityExceeded;

  return (
    <div className="animate-slide-up max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-racing font-bold mb-2">Configure sua Bateria</h2>
        <p className="text-muted-foreground">
          {bookingData.date && format(bookingData.date, "EEEE, d 'de' MMMM", { locale: ptBR })}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Left column - Track and Time */}
        <div className="space-y-6">
          {/* Track Selection */}
          <Card className="card-racing p-6">
            <Label className="flex items-center gap-2 text-lg font-semibold mb-4">
              <MapPin className="w-5 h-5 text-primary" />
              Escolha a Pista
            </Label>
            <RadioGroup
              value={bookingData.track?.id || ''}
              onValueChange={handleTrackSelect}
              className="space-y-3"
            >
              {tracks.map((track) => (
                <label
                  key={track.id}
                  className={cn(
                    "flex items-center p-4 rounded-lg border-2 cursor-pointer transition-all",
                    bookingData.track?.id === track.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <RadioGroupItem value={track.id} className="sr-only" />
                  <div className="flex-1">
                    <p className="font-semibold">{track.name}</p>
                    <p className="text-sm text-muted-foreground">{track.description}</p>
                    <p className="text-sm mt-1">
                      <span className="text-primary font-semibold">R$ {track.price_per_pilot.toFixed(2)}</span>
                      <span className="text-muted-foreground"> / piloto</span>
                    </p>
                  </div>
                  <div className={cn(
                    "w-6 h-6 rounded-full border-2 flex items-center justify-center",
                    bookingData.track?.id === track.id ? "border-primary bg-primary" : "border-muted"
                  )}>
                    {bookingData.track?.id === track.id && (
                      <div className="w-2 h-2 rounded-full bg-primary-foreground" />
                    )}
                  </div>
                </label>
              ))}
            </RadioGroup>
          </Card>

          {/* Time Slot Selection */}
          <Card className="card-racing p-6">
            <Label className="flex items-center gap-2 text-lg font-semibold mb-4">
              <Clock className="w-5 h-5 text-primary" />
              Escolha o Horário
            </Label>
            {timeSlots.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 max-h-[240px] overflow-y-auto">
                {timeSlots.map((slot) => {
                  const spotsAvailable = getAvailableSpots(slot);
                  const isSelected = bookingData.timeSlot?.id === slot.id;
                  const isFull = spotsAvailable === 0;

                  return (
                    <button
                      key={slot.id}
                      onClick={() => handleTimeSlotSelect(slot.id)}
                      disabled={isFull}
                      className={cn(
                        'p-3 rounded-lg border-2 text-center transition-all',
                        isSelected
                          ? 'border-primary bg-primary/10'
                          : isFull
                          ? 'border-muted bg-muted/30 opacity-50 cursor-not-allowed'
                          : 'border-border hover:border-primary/50'
                      )}
                    >
                      <p className="font-semibold">{slot.start_time.slice(0, 5)}</p>
                      <p
                        className={cn(
                          'text-xs',
                          isFull
                            ? 'text-destructive'
                            : spotsAvailable <= 3
                            ? 'text-yellow-600'
                            : 'text-muted-foreground'
                        )}
                      >
                        {`${spotsAvailable} vagas`}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground text-center py-8">
                {bookingData.track
                  ? 'Nenhum horário disponível para esta data e pista'
                  : 'Selecione uma pista primeiro'}
              </p>
            )}
          </Card>
        </div>

        {/* Right column - Pilots and Battery */}
        <div className="space-y-6">
          {/* Number of Pilots */}
          <Card className="card-racing p-6">
            <Label className="flex items-center gap-2 text-lg font-semibold mb-4">
              <Users className="w-5 h-5 text-primary" />
              Número de Pilotos
            </Label>
            <Select
              value={bookingData.numPilots.toString()}
              onValueChange={handleNumPilotsChange}
            >
              <SelectTrigger className="h-12">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((num) => (
                  <SelectItem key={num} value={num.toString()}>
                    {num} {num === 1 ? 'piloto' : 'pilotos'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {capacityExceeded && (
              <div className="mt-3 flex items-center gap-2 text-destructive text-sm animate-pulse">
                <AlertCircle className="w-4 h-4" />
                <span>
                  Apenas {availableSpots} vaga{availableSpots !== 1 ? 's' : ''} disponível
                  {availableSpots !== 1 ? 'eis' : ''} neste horário. Reduza o número de pilotos ou escolha outro horário.
                </span>
              </div>
            )}
          </Card>

          {/* Battery Type */}
          <Card className="card-racing p-6">
            <Label className="flex items-center gap-2 text-lg font-semibold mb-4">
              <Zap className="w-5 h-5 text-primary" />
              Tipo de Bateria
            </Label>
            <RadioGroup
              value={bookingData.batteryType}
              onValueChange={(value) => handleBatteryTypeChange(value as BatteryType)}
              className="space-y-3"
            >
              <label
                className={cn(
                  "flex items-center p-4 rounded-lg border-2 cursor-pointer transition-all",
                  bookingData.batteryType === 'individual'
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                )}
              >
                <RadioGroupItem value="individual" className="sr-only" />
                <div className="flex-1">
                  <p className="font-semibold">Individual</p>
                  <p className="text-sm text-muted-foreground">Bateria padrão para adultos</p>
                </div>
                <div className={cn(
                  "w-6 h-6 rounded-full border-2 flex items-center justify-center",
                  bookingData.batteryType === 'individual' ? "border-primary bg-primary" : "border-muted"
                )}>
                  {bookingData.batteryType === 'individual' && (
                    <div className="w-2 h-2 rounded-full bg-primary-foreground" />
                  )}
                </div>
              </label>
              
              <label
                className={cn(
                  "flex items-center p-4 rounded-lg border-2 cursor-pointer transition-all",
                  bookingData.batteryType === 'kids'
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                )}
              >
                <RadioGroupItem value="kids" className="sr-only" />
                <div className="flex-1">
                  <p className="font-semibold">Kids</p>
                  <p className="text-sm text-muted-foreground">Bateria especial para crianças</p>
                </div>
                <div className={cn(
                  "w-6 h-6 rounded-full border-2 flex items-center justify-center",
                  bookingData.batteryType === 'kids' ? "border-primary bg-primary" : "border-muted"
                )}>
                  {bookingData.batteryType === 'kids' && (
                    <div className="w-2 h-2 rounded-full bg-primary-foreground" />
                  )}
                </div>
              </label>
            </RadioGroup>
          </Card>

          {/* Price Summary */}
          <Card className="card-racing p-6 racing-stripe">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-muted-foreground text-sm">Valor Total</p>
                <p className="text-3xl font-racing font-bold racing-text-gradient">
                  R$ {total.toFixed(2)}
                </p>
              </div>
              <div className="text-right text-sm text-muted-foreground">
                <p>{bookingData.numPilots} {bookingData.numPilots === 1 ? 'piloto' : 'pilotos'}</p>
                <p>{bookingData.batteryType === 'kids' ? 'Bateria Kids' : 'Bateria Individual'}</p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <div className="flex justify-between mt-8">
        <Button variant="outline" size="lg" onClick={onBack}>
          <ArrowLeft className="w-5 h-5 mr-2" />
          Voltar
        </Button>
        <Button
          variant="racing"
          size="lg"
          onClick={onNext}
          disabled={!canProceed}
        >
          Continuar
          <ArrowRight className="w-5 h-5 ml-2" />
        </Button>
      </div>
    </div>
  );
}
