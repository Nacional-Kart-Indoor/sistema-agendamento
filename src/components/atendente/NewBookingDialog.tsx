import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  slotId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  createdBy: string;
  vagasDisponiveis: number;
}

// Máscara de telefone: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX
const maskPhone = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 10) {
    return digits
      .replace(/^(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }
  return digits
    .replace(/^(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d)/, '$1-$2');
};

export function NewBookingDialog({ slotId, open, onClose, onCreated, createdBy, vagasDisponiveis }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [numPilots, setNumPilots] = useState(1);
  const [battery, setBattery] = useState<'individual' | 'kids'>('individual');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName('');
    setPhone('');
    setNumPilots(1);
    setBattery('individual');
    setNotes('');
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(maskPhone(e.target.value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error('Preencha o nome do cliente');
      return;
    }

    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      toast.error('Telefone inválido. Use o formato (XX) XXXXX-XXXX');
      return;
    }

    // Validação de capacidade
    if (numPilots > vagasDisponiveis) {
      toast.error(`Vagas insuficientes. Disponível: ${vagasDisponiveis} vaga${vagasDisponiveis !== 1 ? 's' : ''}`);
      return;
    }

    setSubmitting(true);

    const { error } = await supabase.from('manual_bookings').insert({
      time_slot_id: slotId,
      customer_name: name.trim(),
      customer_phone: phoneDigits,
      num_pilots: numPilots,
      battery_type: battery,
      notes: notes.trim() || null,
      created_by: createdBy,
    });

    setSubmitting(false);

    if (error) {
      toast.error('Erro ao criar agendamento: ' + error.message);
      return;
    }

    toast.success('Agendamento criado');
    reset();
    onCreated();
  };

  // Gera opções de pilotos limitadas pelas vagas disponíveis
  const maxPilots = Math.min(12, vagasDisponiveis);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo agendamento manual</DialogTitle>
          <DialogDescription>
            Cadastre um cliente que reservou presencialmente ou por telefone.
            {vagasDisponiveis < 12 && (
              <span className="block mt-1 text-yellow-500 font-medium">
                Atenção: {vagasDisponiveis} vaga{vagasDisponiveis !== 1 ? 's' : ''} disponível{vagasDisponiveis !== 1 ? 'eis' : ''} neste horário.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome do cliente</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome completo"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Telefone</Label>
            <Input
              id="phone"
              value={phone}
              onChange={handlePhoneChange}
              placeholder="(62) 99999-9999"
              maxLength={15}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pilots">Pilotos</Label>
              <Select
                value={numPilots.toString()}
                onValueChange={(v) => setNumPilots(parseInt(v))}
              >
                <SelectTrigger id="pilots">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {maxPilots > 0
                    ? Array.from({ length: maxPilots }, (_, i) => i + 1).map((n) => (
                        <SelectItem key={n} value={n.toString()}>
                          {n}
                        </SelectItem>
                      ))
                    : <SelectItem value="0" disabled>Sem vagas</SelectItem>
                  }
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Bateria</Label>
              <RadioGroup
                value={battery}
                onValueChange={(v) => setBattery(v as 'individual' | 'kids')}
                className="flex gap-3 pt-2"
              >
                <label className="flex items-center gap-1.5 text-sm">
                  <RadioGroupItem value="individual" /> Adulto
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <RadioGroupItem value="kids" /> Kids
                </label>
              </RadioGroup>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Observações (opcional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Ex: aniversário, confraternização..."
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="racing"
              disabled={submitting || vagasDisponiveis === 0}
            >
              {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {vagasDisponiveis === 0 ? 'Sem vagas' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
