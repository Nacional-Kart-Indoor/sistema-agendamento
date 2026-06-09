import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAtendenteAuth } from '@/hooks/useAtendenteAuth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, LogOut, Plus, Trash2, Loader2, Phone, Users, ShieldCheck } from 'lucide-react';
import { NewBookingDialog } from '@/components/atendente/NewBookingDialog';
import { toast } from 'sonner';

interface SlotRow {
  id: string;
  start_time: string;
  end_time: string;
  max_capacity: number;
  ocupados_atualmente: number;
  track_id: string;
  track: { id: string; name: string } | null;
}

interface ReservationRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  num_pilots: number;
  battery_type: string;
  status: string;
  time_slot_id: string;
}

interface ManualBookingRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  num_pilots: number;
  battery_type: string;
  notes: string | null;
  time_slot_id: string;
  created_at: string;
}

export default function AtendenteDashboard() {
  const navigate = useNavigate();
  const { user, isStaff, loading: authLoading, signOut } = useAtendenteAuth();
  const [date, setDate] = useState<Date>(new Date());
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [manualBookings, setManualBookings] = useState<ManualBookingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [newBookingSlot, setNewBookingSlot] = useState<{ id: string; vagas: number } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate('/atendente/login', { replace: true });
    if (!authLoading && user && !isStaff) {
      toast.error('Sua conta não tem permissão de atendente.');
      signOut();
    }
  }, [authLoading, user, isStaff, navigate, signOut]);

  const loadDay = useCallback(async (d: Date) => {
    setLoading(true);
    const dateStr = format(d, 'yyyy-MM-dd');

    const [slotsRes, resRes, manualRes] = await Promise.all([
      supabase
        .from('time_slots')
        .select('id, start_time, end_time, max_capacity, ocupados_atualmente, track_id, track:tracks(id, name)')
        .eq('date', dateStr)
        .order('start_time'),
      supabase
        .from('reservations')
        .select('id, customer_name, customer_phone, num_pilots, battery_type, status, time_slot_id, time_slot:time_slots!inner(date)')
        .eq('time_slot.date', dateStr),
      supabase
        .from('manual_bookings')
        .select('id, customer_name, customer_phone, num_pilots, battery_type, notes, time_slot_id, created_at, time_slot:time_slots!inner(date)')
        .eq('time_slot.date', dateStr),
    ]);

    if (slotsRes.data) setSlots(slotsRes.data as SlotRow[]);
    if (resRes.data) setReservations(resRes.data as unknown as ReservationRow[]);
    if (manualRes.data) setManualBookings(manualRes.data as unknown as ManualBookingRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user && isStaff) loadDay(date);
  }, [date, user, isStaff, loadDay]);

  const handleDeleteManual = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from('manual_bookings').delete().eq('id', deleteId);
    if (error) {
      toast.error('Erro ao excluir agendamento');
      return;
    }
    toast.success('Agendamento removido');
    setDeleteId(null);
    loadDay(date);
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <div>
              <h1 className="font-racing text-lg font-bold leading-tight">Painel da Atendente</h1>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="w-4 h-4 mr-2" />
            Sair
          </Button>
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <CalendarDays className="w-4 h-4 mr-2" />
                {format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => d && setDate(d)}
                locale={ptBR}
                className="pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
          {loading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        </div>

        <div className="grid gap-3">
          {slots.length === 0 && !loading && (
            <Card className="p-6 text-center text-muted-foreground">
              Nenhum horário cadastrado para essa data.
            </Card>
          )}

          {slots.map((slot) => {
            const slotReservations = reservations.filter(
              (r) => r.time_slot_id === slot.id && r.status === 'paid'
            );
            const slotManuals = manualBookings.filter((m) => m.time_slot_id === slot.id);
            const available = Math.max(0, slot.max_capacity - slot.ocupados_atualmente);

            return (
              <Card key={slot.id} className="p-4">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div>
                    <p className="font-racing text-xl font-bold">
                      {slot.start_time.slice(0, 5)} – {slot.end_time.slice(0, 5)}
                    </p>
                    <p className="text-xs text-muted-foreground">{slot.track?.name}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={available === 0 ? 'destructive' : available <= 3 ? 'secondary' : 'default'}
                    >
                      {available} de {slot.max_capacity} vagas
                    </Badge>
                    <Button
                      size="sm"
                      variant="racing"
                      disabled={available === 0}
                      onClick={() => setNewBookingSlot({ id: slot.id, vagas: available })}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Agendar
                    </Button>
                  </div>
                </div>

                {(slotReservations.length > 0 || slotManuals.length > 0) && (
                  <div className="space-y-1.5 mt-2 border-t border-border pt-2">
                    {slotReservations.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-muted/30"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">SITE</Badge>
                          <span className="font-medium">{r.customer_name}</span>
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {r.customer_phone}
                          </span>
                        </div>
                        <span className="text-muted-foreground flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {r.num_pilots}
                        </span>
                      </div>
                    ))}
                    {slotManuals.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-primary/5"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">MANUAL</Badge>
                          <span className="font-medium">{m.customer_name}</span>
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {m.customer_phone}
                          </span>
                          {m.notes && <span className="text-xs italic text-muted-foreground">— {m.notes}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {m.num_pilots}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setDeleteId(m.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </main>

      {newBookingSlot && (
        <NewBookingDialog
          slotId={newBookingSlot.id}
          open={!!newBookingSlot}
          onClose={() => setNewBookingSlot(null)}
          onCreated={() => {
            setNewBookingSlot(null);
            loadDay(date);
          }}
          createdBy={user.id}
          vagasDisponiveis={newBookingSlot.vagas}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A vaga voltará a ficar disponível.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteManual}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
