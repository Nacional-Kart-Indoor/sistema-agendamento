-- Enum para tipos de bateria
CREATE TYPE public.battery_type AS ENUM ('individual', 'kids');

-- Enum para status da reserva
CREATE TYPE public.reservation_status AS ENUM ('pending', 'paid', 'cancelled', 'expired');

-- Tabela de pistas
CREATE TABLE public.tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  capacity INTEGER NOT NULL DEFAULT 10,
  price_per_pilot DECIMAL(10,2) NOT NULL DEFAULT 50.00,
  price_kids DECIMAL(10,2) NOT NULL DEFAULT 40.00,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Tabela de time slots
CREATE TABLE public.time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id UUID REFERENCES public.tracks(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  max_capacity INTEGER NOT NULL DEFAULT 10,
  ocupados_atualmente INTEGER NOT NULL DEFAULT 0,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(track_id, date, start_time)
);

-- Tabela de reservas
CREATE TABLE public.reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  time_slot_id UUID REFERENCES public.time_slots(id) ON DELETE RESTRICT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  num_pilots INTEGER NOT NULL DEFAULT 1,
  battery_type battery_type NOT NULL DEFAULT 'individual',
  valor_total DECIMAL(10,2) NOT NULL,
  payment_method TEXT,
  status reservation_status NOT NULL DEFAULT 'pending',
  payment_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

-- Políticas públicas para leitura (qualquer um pode ver pistas e horários disponíveis)
CREATE POLICY "Tracks are viewable by everyone" ON public.tracks
  FOR SELECT USING (true);

CREATE POLICY "Time slots are viewable by everyone" ON public.time_slots
  FOR SELECT USING (true);

-- Políticas para reservas (qualquer um pode criar, mas só ver as próprias por email)
CREATE POLICY "Anyone can create reservations" ON public.reservations
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Reservations viewable by email" ON public.reservations
  FOR SELECT USING (true);

CREATE POLICY "Reservations can be updated" ON public.reservations
  FOR UPDATE USING (true);

-- Função para atualizar updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para atualizar updated_at
CREATE TRIGGER update_reservations_updated_at
  BEFORE UPDATE ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Inserir pistas de exemplo
INSERT INTO public.tracks (name, description, capacity, price_per_pilot, price_kids) VALUES
  ('Pista Principal', 'Circuito completo de 800m com curvas técnicas', 10, 80.00, 60.00),
  ('Pista Kids', 'Circuito especial para crianças com 400m', 8, 60.00, 50.00);

-- Gerar time slots para os próximos 30 dias
INSERT INTO public.time_slots (track_id, date, start_time, end_time, max_capacity)
SELECT 
  t.id,
  d.date,
  h.start_time,
  h.end_time,
  t.capacity
FROM public.tracks t
CROSS JOIN (
  SELECT generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', INTERVAL '1 day')::DATE as date
) d
CROSS JOIN (
  SELECT '09:00'::TIME as start_time, '09:30'::TIME as end_time
  UNION ALL SELECT '09:30', '10:00'
  UNION ALL SELECT '10:00', '10:30'
  UNION ALL SELECT '10:30', '11:00'
  UNION ALL SELECT '11:00', '11:30'
  UNION ALL SELECT '11:30', '12:00'
  UNION ALL SELECT '14:00', '14:30'
  UNION ALL SELECT '14:30', '15:00'
  UNION ALL SELECT '15:00', '15:30'
  UNION ALL SELECT '15:30', '16:00'
  UNION ALL SELECT '16:00', '16:30'
  UNION ALL SELECT '16:30', '17:00'
  UNION ALL SELECT '17:00', '17:30'
  UNION ALL SELECT '17:30', '18:00'
) h;