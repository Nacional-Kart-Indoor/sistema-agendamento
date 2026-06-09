import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BookingData } from '@/types/booking';
import { ArrowLeft, ArrowRight, User, Mail, Phone } from 'lucide-react';
import { z } from 'zod';

interface CustomerStepProps {
  bookingData: BookingData;
  onUpdate: (data: Partial<BookingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const customerSchema = z.object({
  customerName: z.string().min(3, 'Nome deve ter pelo menos 3 caracteres').max(100),
  customerEmail: z.string().email('Email inválido'),
  customerPhone: z.string().min(10, 'Telefone inválido').max(15),
});

export function CustomerStep({ bookingData, onUpdate, onNext, onBack }: CustomerStepProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    try {
      customerSchema.parse({
        customerName: bookingData.customerName,
        customerEmail: bookingData.customerEmail,
        customerPhone: bookingData.customerPhone,
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
    if (validate()) {
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
        </div>
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
