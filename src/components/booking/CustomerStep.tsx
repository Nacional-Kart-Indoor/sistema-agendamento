import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { BookingData } from '@/types/booking';
import { ArrowLeft, ArrowRight, User, Mail, Phone, FileText } from 'lucide-react';
import { z } from 'zod';

interface CustomerStepProps {
  bookingData: BookingData;
  onUpdate: (data: Partial<BookingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

// ─── Validação de CPF / CNPJ (dígitos verificadores) ──────────────────────────
export function isValidCpf(value: string): boolean {
  const cpf = value.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i], 10) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(cpf[9], 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i], 10) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(cpf[10], 10);
}

function isValidCnpj(value: string): boolean {
  const cnpj = value.replace(/\D/g, '');
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const digit = (len: number): number => {
    const weights =
      len === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(cnpj[i], 10) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };

  return digit(12) === parseInt(cnpj[12], 10) && digit(13) === parseInt(cnpj[13], 10);
}

function isValidCpfCnpj(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

function formatCpfCnpj(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) {
    // 000.000.000-00
    let out = d;
    if (d.length > 3) out = `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length > 6) out = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    if (d.length > 9) out = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    return out;
  }
  // 00.000.000/0000-00
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

const customerSchema = z.object({
  customerName: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres').max(100),
  customerEmail: z.string().email('Email inválido'),
  customerPhone: z.string().min(10, 'Telefone inválido').max(15),
  customerCpf: z.string().refine(isValidCpfCnpj, 'CPF ou CNPJ inválido'),
});

export function CustomerStep({ bookingData, onUpdate, onNext, onBack }: CustomerStepProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [ackMinor, setAckMinor] = useState(false);
  const [ackHeight, setAckHeight] = useState(false);
  const [ackDocument, setAckDocument] = useState(false);
  const [ackArrival, setAckArrival] = useState(false);
  const [ackError, setAckError] = useState(false);

  const validate = () => {
    try {
      customerSchema.parse({
        customerName: bookingData.customerName,
        customerEmail: bookingData.customerEmail,
        customerPhone: bookingData.customerPhone,
        customerCpf: bookingData.customerCpf,
      });
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
      }
      return false;
    }
  };

  const handleNext = () => {
    const dataOk = validate();
    const ackOk = ackMinor && ackHeight && ackDocument && ackArrival;
    setAckError(!ackOk);
    if (dataOk && ackOk) {
      onNext();
    }
  };

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    if (numbers.length <= 2) return numbers;
    if (numbers.length <= 7) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    onUpdate({ customerPhone: formatted });
  };

  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate({ customerCpf: formatCpfCnpj(e.target.value) });
  };

  return (
    <div className="animate-slide-up max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
          <User className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-2xl font-racing font-bold mb-2">Seus Dados</h2>
        <p className="text-muted-foreground">
          Preencha suas informações para a reserva
        </p>
      </div>

      <Card className="card-racing p-6">
        <div className="space-y-6">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name" className="flex items-center gap-2">
              <User className="w-4 h-4 text-primary" />
              Nome Completo
            </Label>
            <Input
              id="name"
              value={bookingData.customerName}
              onChange={(e) => onUpdate({ customerName: e.target.value })}
              placeholder="Digite seu nome"
              className="h-12"
            />
            {errors.customerName && (
              <p className="text-destructive text-sm">{errors.customerName}</p>
            )}
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email" className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" />
              E-mail
            </Label>
            <Input
              id="email"
              type="email"
              value={bookingData.customerEmail}
              onChange={(e) => onUpdate({ customerEmail: e.target.value })}
              placeholder="seu@email.com"
              className="h-12"
            />
            {errors.customerEmail && (
              <p className="text-destructive text-sm">{errors.customerEmail}</p>
            )}
          </div>

          {/* Phone */}
          <div className="space-y-2">
            <Label htmlFor="phone" className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-primary" />
              Telefone
            </Label>
            <Input
              id="phone"
              type="tel"
              value={bookingData.customerPhone}
              onChange={handlePhoneChange}
              placeholder="(11) 99999-9999"
              className="h-12"
              maxLength={15}
            />
            {errors.customerPhone && (
              <p className="text-destructive text-sm">{errors.customerPhone}</p>
            )}
          </div>

          {/* CPF / CNPJ */}
          <div className="space-y-2">
            <Label htmlFor="cpf" className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              CPF / CNPJ
            </Label>
            <Input
              id="cpf"
              inputMode="numeric"
              value={bookingData.customerCpf}
              onChange={handleCpfChange}
              placeholder="000.000.000-00"
              className="h-12"
              maxLength={18}
            />
            <p className="text-muted-foreground text-xs">
              Necessário para emitir a cobrança.
            </p>
            {errors.customerCpf && (
              <p className="text-destructive text-sm">{errors.customerCpf}</p>
            )}
          </div>
        </div>
      </Card>

      <Card className="card-racing p-6 mt-6 space-y-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id="ack-height"
            checked={ackHeight}
            onCheckedChange={(v) => setAckHeight(v === true)}
            className="mt-0.5"
          />
          <Label htmlFor="ack-height" className="text-sm font-normal leading-snug cursor-pointer">
            Estou ciente de que a Pista Adulto exige <strong>idade mínima de 12 anos</strong> e{' '}
            <strong>altura mínima de 1,50m</strong>. Reservas feitas para pilotos que não atendam a
            esses requisitos não garantem participação.
          </Label>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="ack-minor"
            checked={ackMinor}
            onCheckedChange={(v) => setAckMinor(v === true)}
            className="mt-0.5"
          />
          <Label htmlFor="ack-minor" className="text-sm font-normal leading-snug cursor-pointer">
            Estou ciente de que, caso haja <strong>menores de idade</strong> entre os pilotos, um
            responsável deve estar presente para assinar o termo de responsabilidade no local.
          </Label>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="ack-document"
            checked={ackDocument}
            onCheckedChange={(v) => setAckDocument(v === true)}
            className="mt-0.5"
          />
          <Label htmlFor="ack-document" className="text-sm font-normal leading-snug cursor-pointer">
            Estou ciente de que todos os pilotos devem <strong>apresentar documento com foto</strong> no
            dia da corrida.
          </Label>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="ack-arrival"
            checked={ackArrival}
            onCheckedChange={(v) => setAckArrival(v === true)}
            className="mt-0.5"
          />
          <Label htmlFor="ack-arrival" className="text-sm font-normal leading-snug cursor-pointer">
            Estou ciente de que devo <strong>chegar com 20 minutos de antecedência</strong> do horário
            reservado.
          </Label>
        </div>
        {ackError && (
          <p className="text-destructive text-sm">
            Marque todas as opções acima para continuar.
          </p>
        )}
      </Card>

      <div className="flex justify-between mt-8">
        <Button variant="outline" size="lg" onClick={onBack}>
          <ArrowLeft className="w-5 h-5 mr-2" />
          Voltar
        </Button>
        <Button variant="racing" size="lg" onClick={handleNext}>
          Continuar
          <ArrowRight className="w-5 h-5 ml-2" />
        </Button>
      </div>
    </div>
  );
}
