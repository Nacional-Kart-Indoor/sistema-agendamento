import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAtendenteAuth } from '@/hooks/useAtendenteAuth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { LogOut, CalendarDays, Loader2, Phone, Users, Printer, Check, X, ShieldCheck, Flag, Trash2, CreditCard, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type AttendanceStatus = 'present' | 'absent' | null;
type Tab = 'presenca' | 'feriados';

interface Entry {
  id: string;
  customer_name: string;
  customer_phone: string;
  num_pilots: number;
  start_time: string;
  attendance_status: AttendanceStatus;
  pilotos_completos: boolean;
  pilotosCadastrados: number;
  payment_method: string | null;
}

// billingType cru da Asaas → rótulo pra atendente. A Asaas não diferencia
// crédito de débito (ambos vêm como CREDIT_CARD), então é só "Cartão".
function paymentLabel(method: string | null): string {
  switch (method) {
    case 'PIX':
      return 'PIX';
    case 'CREDIT_CARD':
    case 'DEBIT_CARD':
      return 'Cartão';
    case 'BOLETO':
      return 'Boleto';
    default:
      return '—';
  }
}

interface Holiday {
  data: string;
  descricao: string;
  origem: 'nacional' | 'municipal' | 'manual';
}

interface WhatsAppHealth {
  ok: boolean;
  detail: string | null;
  checked_at: string;
  down_since: string | null;
}

// O reconciliation-check grava o status a cada 30 min. Sem checagem há mais
// que isso, o próprio monitor parou e o "ok" gravado não vale mais.
const HEALTH_STALE_MINUTES = 90;
const HEALTH_POLL_MS = 5 * 60 * 1000;

function WhatsAppHealthBanner({ health }: { health: WhatsAppHealth | null }) {
  if (!health) return null;

  const stale = Date.now() - new Date(health.checked_at).getTime() > HEALTH_STALE_MINUTES * 60 * 1000;

  if (!health.ok) {
    return (
      <div className="border-b border-destructive bg-destructive/10 print:hidden">
        <div className="container max-w-4xl mx-auto px-4 py-3 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <p className="font-bold text-destructive">
              WhatsApp fora do ar: clientes e recepção não estão recebendo as confirmações
              {health.down_since && <> desde {format(new Date(health.down_since), "dd/MM 'às' HH:mm")}</>}.
            </p>
            {health.detail && <p className="text-muted-foreground">{health.detail}</p>}
            <p>
              Para resolver: no painel da Evolution, clique em <strong>Disconnect</strong> e conecte de novo
              escaneando o QR code com o celular da loja (WhatsApp → Aparelhos conectados → Conectar um aparelho).
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (stale) {
    return (
      <div className="border-b border-secondary bg-secondary/10 print:hidden">
        <div className="container max-w-4xl mx-auto px-4 py-2 flex items-center gap-3 text-sm">
          <AlertTriangle className="w-4 h-4 text-secondary shrink-0" />
          <p>
            Não foi possível confirmar o status do WhatsApp (última checagem em{' '}
            {format(new Date(health.checked_at), "dd/MM 'às' HH:mm")}). Avise o responsável pelo sistema.
          </p>
        </div>
      </div>
    );
  }

  return null;
}

export default function Presenca() {
  const navigate = useNavigate();
  const { user, isStaff, loading: authLoading, signOut } = useAtendenteAuth();
  const [tab, setTab] = useState<Tab>('presenca');

  const [date, setDate] = useState<Date>(new Date());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidaysLoading, setHolidaysLoading] = useState(false);
  const [newHolidayDate, setNewHolidayDate] = useState<Date | undefined>();
  const [newHolidayDesc, setNewHolidayDesc] = useState('');
  const [savingHoliday, setSavingHoliday] = useState(false);

  const [whatsappHealth, setWhatsappHealth] = useState<WhatsAppHealth | null>(null);

  useEffect(() => {
    if (!user || !isStaff) return;
    const loadHealth = async () => {
      const { data } = await supabase
        .from('system_health')
        .select('ok, detail, checked_at, down_since')
        .eq('component', 'whatsapp')
        .maybeSingle();
      setWhatsappHealth(data ?? null);
    };
    loadHealth();
    const timer = setInterval(loadHealth, HEALTH_POLL_MS);
    return () => clearInterval(timer);
  }, [user, isStaff]);

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
      .select('id, customer_name, customer_phone, num_pilots, attendance_status, pilotos_completos, payment_method, time_slot:time_slots!inner(date, start_time)')
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
        pilotos_completos: r.pilotos_completos,
        pilotosCadastrados: 0,
        payment_method: r.payment_method,
      }))
      .sort((a, b) => a.start_time.localeCompare(b.start_time));

    // Conta quantos pilotos extras já foram cadastrados, só pras reservas de grupo.
    const groupIds = rows.filter((r) => r.num_pilots > 1).map((r) => r.id);
    if (groupIds.length > 0) {
      const { data: pilotsData } = await supabase
        .from('reservation_pilots')
        .select('reservation_id')
        .in('reservation_id', groupIds);
      const countByReservation = new Map<string, number>();
      (pilotsData || []).forEach((p: any) => {
        countByReservation.set(p.reservation_id, (countByReservation.get(p.reservation_id) || 0) + 1);
      });
      rows.forEach((r) => {
        r.pilotosCadastrados = countByReservation.get(r.id) || 0;
      });
    }

    setEntries(rows);
    setLoading(false);
  }, []);

  const loadHolidays = useCallback(async () => {
    setHolidaysLoading(true);
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const { data } = await supabase
      .from('feriados')
      .select('data, descricao, origem')
      .gte('data', todayStr)
      .order('data');
    setHolidays((data || []) as Holiday[]);
    setHolidaysLoading(false);
  }, []);

  useEffect(() => {
    if (!user || !isStaff) return;
    if (tab === 'presenca') loadDay(date);
    if (tab === 'feriados') loadHolidays();
  }, [tab, date, user, isStaff, loadDay, loadHolidays]);

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

  const handleMarkHoliday = async () => {
    if (!newHolidayDate) return;
    setSavingHoliday(true);
    const { error } = await supabase.rpc('set_manual_holiday', {
      p_data: format(newHolidayDate, 'yyyy-MM-dd'),
      p_descricao: newHolidayDesc,
    });
    setSavingHoliday(false);
    if (error) {
      toast.error('Erro ao sinalizar feriado');
      return;
    }
    toast.success('Feriado sinalizado — horários passam a ser 10h-22h nesse dia.');
    setNewHolidayDate(undefined);
    setNewHolidayDesc('');
    loadHolidays();
  };

  const handleUnmarkHoliday = async (data: string) => {
    const { error } = await supabase.rpc('unset_manual_holiday', { p_data: data });
    if (error) {
      toast.error('Erro ao remover feriado');
      return;
    }
    toast.success('Feriado removido');
    loadHolidays();
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
            <ShieldCheck className="w-6 h-6 text-primary" />
            <div>
              <h1 className="font-racing text-lg font-bold leading-tight">Painel da Atendente</h1>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {tab === 'presenca' && (
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="w-4 h-4 mr-2" />
                Baixar PDF
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="w-4 h-4 mr-2" />
              Sair
            </Button>
          </div>
        </div>
        <div className="container max-w-4xl mx-auto px-4 flex gap-1">
          {([
            { id: 'presenca' as const, label: 'Presença' },
            { id: 'feriados' as const, label: 'Feriados' },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <WhatsAppHealthBanner health={whatsappHealth} />

      {/* Cabeçalho só na impressão */}
      <div className="hidden print:block px-4 pt-4">
        <h1 className="font-bold text-xl">Conferência de Presença — Nacional Kart Indoor</h1>
        <p className="text-sm text-muted-foreground">
          {format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })} · Gerado em{' '}
          {format(new Date(), "dd/MM/yyyy HH:mm")}
        </p>
      </div>

      {tab === 'presenca' && (
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
                      <p className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{entry.customer_phone}</span>
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{entry.num_pilots}</span>
                        <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" />{paymentLabel(entry.payment_method)}</span>
                        {entry.num_pilots > 1 && (
                          <span
                            className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded-full border font-medium',
                              entry.pilotos_completos
                                ? 'border-racing-green text-racing-green'
                                : 'border-secondary text-secondary',
                            )}
                          >
                            Pilotos: {entry.pilotosCadastrados}/{entry.num_pilots - 1}
                            {entry.pilotos_completos ? ' ✓' : ''}
                          </span>
                        )}
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
      )}

      {tab === 'feriados' && (
        <main className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
          <Card className="p-4">
            <h2 className="font-semibold text-sm mb-3 flex items-center gap-2">
              <Flag className="w-4 h-4 text-primary" />
              Sinalizar feriado
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              No dia marcado como feriado, os horários passam a abrir das 10h às 22h (em vez de 14h às 22h).
              Feriados nacionais e municipais já ficam marcados automaticamente — use isto só pra pontos
              facultativos ou datas extras.
            </p>
            <div className="flex gap-2 flex-wrap">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="min-w-[180px] justify-start">
                    <CalendarDays className="w-4 h-4 mr-2" />
                    {newHolidayDate ? format(newHolidayDate, "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : 'Escolher data'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={newHolidayDate}
                    onSelect={setNewHolidayDate}
                    locale={ptBR}
                    disabled={{ before: new Date() }}
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <Input
                placeholder="Descrição (opcional)"
                value={newHolidayDesc}
                onChange={(e) => setNewHolidayDesc(e.target.value)}
                className="flex-1 min-w-[160px]"
              />
              <Button variant="racing" onClick={handleMarkHoliday} disabled={!newHolidayDate || savingHoliday}>
                {savingHoliday ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Flag className="w-4 h-4 mr-2" />}
                Sinalizar feriado
              </Button>
            </div>
          </Card>

          <div>
            <h2 className="font-semibold text-sm mb-2 px-1">Próximos feriados</h2>
            {holidaysLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto my-4" />}
            {!holidaysLoading && holidays.length === 0 && (
              <Card className="p-6 text-center text-muted-foreground">Nenhum feriado cadastrado a partir de hoje.</Card>
            )}
            <div className="space-y-1.5">
              {holidays.map((h) => (
                <Card key={h.data} className="p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="font-racing font-bold text-sm w-24">
                      {format(new Date(`${h.data}T12:00:00`), 'dd/MM/yyyy', { locale: ptBR })}
                    </span>
                    <span className="text-sm">{h.descricao}</span>
                    <span className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full border',
                      h.origem === 'nacional' && 'border-primary text-primary',
                      h.origem === 'municipal' && 'border-secondary text-secondary',
                      h.origem === 'manual' && 'border-muted-foreground text-muted-foreground',
                    )}>
                      {h.origem}
                    </span>
                  </div>
                  {h.origem === 'manual' && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleUnmarkHoliday(h.data)}>
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
