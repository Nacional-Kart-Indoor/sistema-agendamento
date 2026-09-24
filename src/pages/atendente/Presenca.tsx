import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAtendenteAuth } from '@/hooks/useAtendenteAuth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowLeft, CalendarDays, Loader2, Phone, Users, Printer, Check, X } from 'lucide-react';
import { toast } from 'sonner';

type AttendanceStatus = 'present' | 'absent' | null;

interface Entry {
  id: string;
  customer_name: string;
  customer_phone: string;
  num_pilots: number;
  start_time: string;
  attendance_status: AttendanceStatus;
}

export default function Presenca() {
  const navigate = useNavigate();
  const { user, isStaff, loading: authLoading } = useAtendenteAuth();
  const [date, setDate] = useState<Date>(new Date());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate('/atendente/login', { replace: true });
    if (!authLoading && user && !isStaff) {
      toast.error('Sua conta nao tem permissao de atendente.');
      navigate('/atendente/login', { replace: true });
    }
  }, [authLoading, user, isStaff, navigate]);

  const loadDay = useCallback(async (d: Date) => {
    setLoading(true);
    const dateStr = format(d, 'yyyy-MM-dd');
    const { data } = await supabase
      .from('reservations')
      .select('id, customer_name, customer_phone, num_pilots, attendance_status, time_slot:time_slots!inner(date, start_time)')
      .eq('status', 'paid')
      .eq('time_slot.date', dateStr);

    const rows: Entry[] = (data || [])
      .map((r: any) => ({
        id: r.id,
        customer_name: r.customer_name,
        customer_phone: r.customer_phone,
        num_pilots: r.num_pilots,
        start_time: r.time_slot?.start_time ?? '',
        attendance_status: r.attendance_status,
      }))
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

    setEntries(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user && isStaff) loadDay(date);
  }, [date, user, isStaff, loadDay]);

  const setAttendance = async (entry: Entry, status: AttendanceStatus) => {
    const next = entry.attendance_status === status ? null : status;
    setSavingId(entry.id);
    const { error } = await supabase.rpc('set_attendance', {
      p_id: entry.id,
      p_status: next,
    });
    setSavingId(null);
    if (error) {
      toast.error('Erro ao registrar presenca');
      return;
    }
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, attendance_status: next } : e)));
  };

  const counts = useMemo(() => {
    const present = entries.filter((e) => e.attendance_status === 'present').length;
    const absent = entries.filter((e) => e.attendance_status === 'absent').length;
    return { total: entries.length, present, absent, pending: entries.length - present - absent };
  }, [entries]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card print:hidden">
        <div className="container max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/atendente')}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="font-racing text-lg font-bold leading-tight">Conferência de Presença</h1>
          </div>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="w-4 h-4 mr-2" />
            Baixar PDF
          </Button>
        </div>
      </header>

      {/* Cabeçalho só na impressão */}
      <div className="hidden print:block px-4 pt-4">
        <h1 className="font-bold text-xl">Conferência de Presença — Nacional Kart Indoor</h1>
        <p className="text-sm text-muted-foreground">
          {format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })} · Gerado em{' '}
          {format(new Date(), "dd/MM/yyyy HH:mm")}
        </p>
      </div>

      <main className="container max-w-4xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <CalendarDays className="w-4 h-4 mr-2" />
                {format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)} locale={ptBR} className="pointer-events-auto" />
            </PopoverContent>
          </Popover>
          {loading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          <Card className="p-3">
            <p className="text-2xl font-bold">{counts.total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </Card>
          <Card className="p-3">
            <p className="text-2xl font-bold text-racing-green">{counts.present}</p>
            <p className="text-xs text-muted-foreground">Presentes</p>
          </Card>
          <Card className="p-3">
            <p className="text-2xl font-bold text-destructive">{counts.absent}</p>
            <p className="text-xs text-muted-foreground">Faltaram</p>
          </Card>
          <Card className="p-3">
            <p className="text-2xl font-bold text-muted-foreground">{counts.pending}</p>
            <p className="text-xs text-muted-foreground">Pendentes</p>
          </Card>
        </div>

        {entries.length === 0 && !loading && (
          <Card className="p-6 text-center text-muted-foreground">
            Nenhuma reserva paga para essa data.
          </Card>
        )}

        <div className="space-y-2 print:space-y-1">
          {entries.map((entry) => {
            const statusLabel =
              entry.attendance_status === 'present' ? 'Presente' : entry.attendance_status === 'absent' ? 'Faltou' : 'Pendente';
            return (
              <Card key={entry.id} className="p-3 flex items-center justify-between gap-3 flex-wrap print:break-inside-avoid">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-racing font-bold text-lg w-14">{entry.start_time.slice(0, 5)}</span>
                  <div>
                    <p className="font-medium leading-tight">{entry.customer_name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-3">
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{entry.customer_phone}</span>
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" />{entry.num_pilots}</span>
                    </p>
                  </div>
                </div>

                {/* Tela: botões */}
                <div className="flex items-center gap-2 print:hidden">
                  <Button
                    size="sm"
                    variant={entry.attendance_status === 'present' ? 'success' : 'outline'}
                    disabled={savingId === entry.id}
                    onClick={() => setAttendance(entry, 'present')}
                  >
                    <Check className="w-4 h-4 mr-1" />
                    Presente
                  </Button>
                  <Button
                    size="sm"
                    variant={entry.attendance_status === 'absent' ? 'destructive' : 'outline'}
                    disabled={savingId === entry.id}
                    onClick={() => setAttendance(entry, 'absent')}
                  >
                    <X className="w-4 h-4 mr-1" />
                    Faltou
                  </Button>
                </div>

                {/* Impressão: texto do status */}
                <span
                  className={`hidden print:inline font-bold text-sm ${
                    entry.attendance_status === 'present'
                      ? 'text-racing-green'
                      : entry.attendance_status === 'absent'
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                  }`}
                >
                  {statusLabel}
                </span>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
