import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Users, CheckCircle, User, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { isValidCpf } from '@/components/booking/CustomerStep';

interface PilotForm {
  nome: string;
  cpf: string;
}

interface PilotsInfo {
  customer_name: string;
  num_pilots: number;
  missing: number;
  pilotos_completos: boolean;
  pilots: { nome: string }[];
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function formatCpf(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  let out = d;
  if (d.length > 3) out = `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length > 6) out = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  if (d.length > 9) out = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return out;
}

export default function ReservationPilots() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<PilotsInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [forms, setForms] = useState<PilotForm[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/get-reservation-pilots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data: PilotsInfo = await res.json();
        setInfo(data);
        setForms(Array.from({ length: data.missing }, () => ({ nome: '', cpf: '' })));
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const updateForm = (index: number, field: keyof PilotForm, value: string) => {
    setForms((prev) => prev.map((f, i) => (i === index ? { ...f, [field]: value } : f)));
  };

  const handleSubmit = async () => {
    const newErrors: Record<number, string> = {};
    forms.forEach((f, i) => {
      if (f.nome.trim().length < 2) newErrors[i] = 'Nome inválido';
      else if (!isValidCpf(f.cpf)) newErrors[i] = 'CPF inválido';
    });
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-reservation-pilots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
        body: JSON.stringify({
          token,
          pilots: forms.map((f) => ({ nome: f.nome.trim(), cpf: f.cpf.replace(/\D/g, '') })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Erro ao enviar dados');
        return;
      }
      setDone(true);
    } catch {
      toast.error('Erro ao enviar dados. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="card-racing p-8 max-w-md text-center">
          <h1 className="text-xl font-racing font-bold mb-2">Link inválido</h1>
          <p className="text-muted-foreground text-sm">
            Esse link não é válido ou já expirou. Se precisar de ajuda, fale com a gente pelo WhatsApp.
          </p>
        </Card>
      </div>
    );
  }

  const isComplete = done || info.pilotos_completos;

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Users className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-racing font-bold mb-2">Dados dos Pilotos</h1>
          <p className="text-muted-foreground text-sm">
            Reserva de {info.customer_name} — {info.num_pilots} pilotos
          </p>
        </div>

        {isComplete ? (
          <Card className="card-racing p-8 text-center">
            <CheckCircle className="w-12 h-12 text-racing-success mx-auto mb-3" />
            <h2 className="font-racing font-bold text-lg mb-2">Dados enviados!</h2>
            <p className="text-muted-foreground text-sm">
              Todos os pilotos já estão cadastrados pra essa reserva. Te esperamos na pista! 🏁
            </p>
          </Card>
        ) : (
          <>
            <p className="text-sm text-muted-foreground text-center mb-6">
              Preencha nome completo e CPF dos <strong>{info.missing} piloto(s) extra(s)</strong> (o piloto
              principal já está cadastrado).
            </p>
            <div className="space-y-4">
              {forms.map((form, i) => (
                <Card key={i} className="card-racing p-5 space-y-3">
                  <p className="font-semibold text-sm text-primary">Piloto extra {i + 1}</p>
                  <div className="space-y-1.5">
                    <Label htmlFor={`nome-${i}`} className="flex items-center gap-2 text-xs">
                      <User className="w-3.5 h-3.5" /> Nome completo
                    </Label>
                    <Input
                      id={`nome-${i}`}
                      value={form.nome}
                      onChange={(e) => updateForm(i, 'nome', e.target.value)}
                      placeholder="Nome do piloto"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`cpf-${i}`} className="flex items-center gap-2 text-xs">
                      <FileText className="w-3.5 h-3.5" /> CPF
                    </Label>
                    <Input
                      id={`cpf-${i}`}
                      inputMode="numeric"
                      value={form.cpf}
                      onChange={(e) => updateForm(i, 'cpf', formatCpf(e.target.value))}
                      placeholder="000.000.000-00"
                      maxLength={14}
                    />
                  </div>
                  {errors[i] && <p className="text-destructive text-xs">{errors[i]}</p>}
                </Card>
              ))}
            </div>
            <Button variant="racing" size="lg" className="w-full mt-6" onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : null}
              Enviar dados dos pilotos
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-4">
              Atenção: depois de enviado não é possível editar por aqui. Se precisar corrigir algo, ajustamos
              na hora, na recepção.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
