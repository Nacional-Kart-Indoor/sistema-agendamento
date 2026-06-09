
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAtendenteAuth } from '@/hooks/useAtendenteAuth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  LogOut, ShieldCheck, Loader2, TrendingUp, CalendarDays,
  Users, DollarSign, Download, Search, BarChart3, UserCog,
} from 'lucide-react';
import { toast } from 'sonner';

// ── tipos ──────────────────────────────────────────────────
interface ReservationRow {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  num_pilots: number;
  battery_type: string;
  valor_total: number;
  status: string;
  created_at: string;
  time_slots: { date: string; start_time: string; end_time: string; tracks: { name: string } } | null;
}

interface StaffRow {
  user_id: string;
  role: string;
  email?: string;
  total_agendamentos: number;
  total_pilotos: number;
}

type Aba = 'dashboard' | 'reservas' | 'atendentes';
type Periodo = 'hoje' | 'semana' | 'mes' | 'mes_anterior';

// ── helpers ────────────────────────────────────────────────
const periodoRange = (p: Periodo): { inicio: string; fim: string } => {
  const hoje = new Date();
  if (p === 'hoje') {
    const d = format(hoje, 'yyyy-MM-dd');
    return { inicio: d, fim: d };
  }
  if (p === 'semana') {
    return {
      inicio: format(startOfWeek(hoje, { weekStartsOn: 0 }), 'yyyy-MM-dd'),
      fim: format(endOfWeek(hoje, { weekStartsOn: 0 }), 'yyyy-MM-dd'),
    };
  }
  if (p === 'mes_anterior') {
    const ant = subMonths(hoje, 1);
    return {
      inicio: format(startOfMonth(ant), 'yyyy-MM-dd'),
      fim: format(endOfMonth(ant), 'yyyy-MM-dd'),
    };
  }
  return {
    inicio: format(startOfMonth(hoje), 'yyyy-MM-dd'),
    fim: format(endOfMonth(hoje), 'yyyy-MM-dd'),
  };
};

const formatCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatPhone = (p: string) => {
  const d = p.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return p;
};

const exportCSV = (rows: ReservationRow[]) => {
  const header = ['Data','Horário','Pista','Cliente','E-mail','Telefone','Pilotos','Bateria','Valor','Status'];
  const lines = rows.map(r => [
    r.time_slots?.date ?? '',
    r.time_slots ? `${r.time_slots.start_time.slice(0,5)}-${r.time_slots.end_time.slice(0,5)}` : '',
    r.time_slots?.tracks?.name ?? '',
    r.customer_name,
    r.customer_email,
    formatPhone(r.customer_phone),
    r.num_pilots,
    r.battery_type === 'kids' ? 'Kids' : 'Individual',
    r.valor_total.toFixed(2),
    r.status,
  ].join(';'));
  const csv = [header.join(';'), ...lines].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reservas_${format(new Date(), 'yyyy-MM-dd')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// ── componente principal ───────────────────────────────────
export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, roles, loading: authLoading, signOut } = useAtendenteAuth();
  const isAdmin = roles.includes('admin');

  const [aba, setAba] = useState<Aba>('dashboard');
  const [periodo, setPeriodo] = useState<Periodo>('hoje');
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [staffRows, setStaffRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('todos');
  const [periodoStaff, setPeriodoStaff] = useState<Periodo>('mes');

  // redireciona se não for admin
  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/atendente/login', { replace: true }); return; }
    if (!isAdmin) {
      toast.error('Acesso restrito a administradores.');
      navigate('/atendente', { replace: true });
    }
  }, [authLoading, user, isAdmin, navigate]);

  // carrega reservas
  const loadReservations = useCallback(async (p: Periodo) => {
    setLoading(true);
    const { inicio, fim } = periodoRange(p);
    const { data, error } = await supabase
      .from('reservations')
      .select('id, customer_name, customer_email, customer_phone, num_pilots, battery_type, valor_total, status, created_at, time_slots(date, start_time, end_time, tracks(name))')
      .gte('time_slots.date', inicio)
      .lte('time_slots.date', fim)
      .order('created_at', { ascending: false });
    if (error) { toast.error('Erro ao carregar reservas'); }
    else { setReservations((data ?? []) as unknown as ReservationRow[]); }
    setLoading(false);
  }, []);

  // carrega relatório de atendentes
  const loadStaff = useCallback(async (p: Periodo) => {
    setLoading(true);
    const { inicio, fim } = periodoRange(p);

    const [rolesRes, manuaisRes] = await Promise.all([
      supabase.from('user_roles').select('user_id, role'),
      supabase
        .from('manual_bookings')
        .select('created_by, num_pilots, time_slots!inner(date)')
        .gte('time_slots.date', inicio)
        .lte('time_slots.date', fim),
    ]);

    const roleMap: Record<string, string> = {};
    (rolesRes.data ?? []).forEach((r: any) => { roleMap[r.user_id] = r.role; });

    const agMap: Record<string, { total: number; pilotos: number }> = {};
    (manuaisRes.data ?? []).forEach((m: any) => {
      const uid = m.created_by;
      if (!uid) return;
      if (!agMap[uid]) agMap[uid] = { total: 0, pilotos: 0 };
      agMap[uid].total += 1;
      agMap[uid].pilotos += m.num_pilots;
    });

    const rows: StaffRow[] = Object.keys(roleMap).map(uid => ({
      user_id: uid,
      role: roleMap[uid],
      total_agendamentos: agMap[uid]?.total ?? 0,
      total_pilotos: agMap[uid]?.pilotos ?? 0,
    }));

    setStaffRows(rows.sort((a, b) => b.total_agendamentos - a.total_agendamentos));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user || !isAdmin) return;
    if (aba === 'dashboard' || aba === 'reservas') loadReservations(periodo);
    if (aba === 'atendentes') loadStaff(periodoStaff);
  }, [aba, periodo, periodoStaff, user, isAdmin, loadReservations, loadStaff]);

  if (authLoading || !user) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  // ── métricas do dashboard ──
  const paid = reservations.filter(r => r.status === 'paid');
  const receita = paid.reduce((s, r) => s + (r.valor_total ?? 0), 0);
  const totalPilotos = paid.reduce((s, r) => s + r.num_pilots, 0);
  const totalReservas = paid.length;

  // ── filtro da tabela ──
  const filtered = reservations.filter(r => {
    const matchSearch = search === '' ||
      r.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      r.customer_phone.includes(search) ||
      r.customer_email.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFiltro === 'todos' || r.status === statusFiltro;
    return matchSearch && matchStatus;
  });

  const periodoLabel: Record<Periodo, string> = {
    hoje: 'Hoje',
    semana: 'Esta semana',
    mes: 'Este mês',
    mes_anterior: 'Mês anterior',
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <div>
              <h1 className="font-racing text-lg font-bold leading-tight">Painel Administrativo</h1>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="w-4 h-4 mr-2" />Sair
          </Button>
        </div>
      </header>

      {/* Abas */}
      <div className="border-b border-border bg-card">
        <div className="container max-w-7xl mx-auto px-4">
          <div className="flex gap-1">
            {([
              { id: 'dashboard', label: 'Dashboard', icon: TrendingUp },
              { id: 'reservas',  label: 'Reservas',  icon: CalendarDays },
              { id: 'atendentes', label: 'Atendentes', icon: UserCog },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setAba(id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  aba === id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-4 h-4" />{label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="container max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* Filtro de período (dashboard + reservas) */}
        {(aba === 'dashboard' || aba === 'reservas') && (
          <div className="flex items-center gap-3 flex-wrap">
            {(['hoje','semana','mes','mes_anterior'] as Periodo[]).map(p => (
              <Button
                key={p}
                size="sm"
                variant={periodo === p ? 'default' : 'outline'}
                onClick={() => setPeriodo(p)}
              >
                {periodoLabel[p]}
              </Button>
            ))}
            {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
        )}

        {/* ABA: DASHBOARD */}
        {aba === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-green-500" />
                  </div>
                  <p className="text-xs text-muted-foreground">Receita</p>
                </div>
                <p className="text-2xl font-racing font-bold">{formatCurrency(receita)}</p>
                <p className="text-xs text-muted-foreground mt-1">{periodoLabel[periodo]}</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <CalendarDays className="w-4 h-4 text-blue-500" />
                  </div>
                  <p className="text-xs text-muted-foreground">Reservas pagas</p>
                </div>
                <p className="text-2xl font-racing font-bold">{totalReservas}</p>
                <p className="text-xs text-muted-foreground mt-1">{periodoLabel[periodo]}</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                    <Users className="w-4 h-4 text-yellow-500" />
                  </div>
                  <p className="text-xs text-muted-foreground">Pilotos</p>
                </div>
                <p className="text-2xl font-racing font-bold">{totalPilotos}</p>
                <p className="text-xs text-muted-foreground mt-1">{periodoLabel[periodo]}</p>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                    <BarChart3 className="w-4 h-4 text-purple-500" />
                  </div>
                  <p className="text-xs text-muted-foreground">Ticket médio</p>
                </div>
                <p className="text-2xl font-racing font-bold">
                  {totalReservas > 0 ? formatCurrency(receita / totalReservas) : 'R$ 0,00'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">por reserva</p>
              </Card>
            </div>

            {/* Últimas 5 reservas */}
            <Card className="p-4">
              <h3 className="font-medium mb-3 flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" />
                Últimas reservas pagas
              </h3>
              {paid.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhuma reserva paga no período.</p>
              ) : (
                <div className="space-y-2">
                  {paid.slice(0, 5).map(r => (
                    <div key={r.id} className="flex items-center justify-between text-sm py-2 px-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-medium">{r.customer_name}</span>
                        <span className="text-muted-foreground text-xs">
                          {r.time_slots?.date ? format(new Date(r.time_slots.date + 'T12:00:00'), "dd/MM", { locale: ptBR }) : ''}{' '}
                          {r.time_slots?.start_time?.slice(0,5)}
                        </span>
                        <span className="text-muted-foreground text-xs">{r.time_slots?.tracks?.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{r.num_pilots} pilotos</span>
                        <span className="font-medium text-green-500">{formatCurrency(r.valor_total)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ABA: RESERVAS */}
        {aba === 'reservas' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome, e-mail ou telefone..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={statusFiltro} onValueChange={setStatusFiltro}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="paid">Pago</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="cancelled">Cancelado</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => exportCSV(filtered)}>
                <Download className="w-4 h-4 mr-2" />Exportar CSV
              </Button>
            </div>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      {['Data','Horário','Pista','Cliente','Telefone','Pilotos','Bateria','Valor','Status'].map(h => (
                        <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">Nenhuma reserva encontrada.</td></tr>
                    ) : filtered.map((r, i) => (
                      <tr key={r.id} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.time_slots?.date ? format(new Date(r.time_slots.date + 'T12:00:00'), 'dd/MM/yyyy') : '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.time_slots ? `${r.time_slots.start_time.slice(0,5)}–${r.time_slots.end_time.slice(0,5)}` : '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.time_slots?.tracks?.name ?? '—'}</td>
                        <td className="px-3 py-2 font-medium whitespace-nowrap">{r.customer_name}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatPhone(r.customer_phone)}</td>
                        <td className="px-3 py-2 text-center">{r.num_pilots}</td>
                        <td className="px-3 py-2">{r.battery_type === 'kids' ? 'Kids' : 'Individual'}</td>
                        <td className="px-3 py-2 whitespace-nowrap font-medium">{formatCurrency(r.valor_total)}</td>
                        <td className="px-3 py-2">
                          <Badge variant={r.status === 'paid' ? 'default' : r.status === 'pending' ? 'secondary' : 'destructive'} className="text-[10px]">
                            {r.status === 'paid' ? 'Pago' : r.status === 'pending' ? 'Pendente' : 'Cancelado'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* ABA: ATENDENTES */}
        {aba === 'atendentes' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm text-muted-foreground">Período:</p>
              {(['hoje','semana','mes','mes_anterior'] as Periodo[]).map(p => (
                <Button
                  key={p}
                  size="sm"
                  variant={periodoStaff === p ? 'default' : 'outline'}
                  onClick={() => setPeriodoStaff(p)}
                >
                  {periodoLabel[p]}
                </Button>
              ))}
              {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      {['Usuário','Role','Agendamentos manuais','Total de pilotos'].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {staffRows.length === 0 ? (
                      <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">Nenhum dado encontrado.</td></tr>
                    ) : staffRows.map((s, i) => (
                      <tr key={s.user_id} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                        <td className="px-4 py-3 font-medium text-xs text-muted-foreground">{s.user_id.slice(0,8)}...</td>
                        <td className="px-4 py-3">
                          <Badge variant={s.role === 'admin' ? 'default' : 'secondary'} className="text-[10px]">
                            {s.role}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-medium">{s.total_agendamentos}</td>
                        <td className="px-4 py-3 font-medium">{s.total_pilotos}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <p className="text-xs text-muted-foreground">
              * A tabela mostra agendamentos manuais criados pelas atendentes no período selecionado. Reservas feitas pelo site não são contabilizadas aqui.
            </p>
          </div>
        )}

      </main>
    </div>
  );
}
