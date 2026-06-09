import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BookingData } from '@/types/booking';
import { addDays, isBefore, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';

interface DateStepProps {
  bookingData: BookingData;
  onUpdate: (data: Partial<BookingData>) => void;
  onNext: () => void;
}

export function DateStep({ bookingData, onUpdate, onNext }: DateStepProps) {
  const today = startOfDay(new Date());
  const maxDate = addDays(today, 30);

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      onUpdate({ date, timeSlot: null });
    }
  };

  return (
    <div className="animate-slide-up">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
          <CalendarDays className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-racing font-bold mb-2">Escolha a Data</h2>
        <p className="text-muted-foreground">Selecione o dia em que deseja acelerar</p>
      </div>

      <Card className="card-racing p-6 max-w-md mx-auto">
        <Calendar
          mode="single"
          selected={bookingData.date || undefined}
          onSelect={handleDateSelect}
          disabled={(date) => isBefore(date, today) || isBefore(maxDate, date)}
          locale={ptBR}
          className="rounded-lg pointer-events-auto"
        />

        {bookingData.date && (
          <div className="mt-4 p-4 rounded-lg bg-primary/10 border border-primary/20">
            <p className="text-sm text-muted-foreground">Data selecionada</p>
            <p className="text-lg font-semibold text-primary">
              {format(bookingData.date, "EEEE, d 'de' MMMM", { locale: ptBR })}
            </p>
          </div>
        )}
      </Card>

      <div className="flex justify-center mt-8">
        <Button
          variant="racing"
          size="lg"
          onClick={onNext}
          disabled={!bookingData.date}
          className="min-w-[200px]"
        >
          Continuar
          <ArrowRight className="w-5 h-5 ml-2" />
        </Button>
      </div>
    </div>
  );
}
