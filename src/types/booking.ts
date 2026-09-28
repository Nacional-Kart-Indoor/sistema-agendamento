export interface Track {
  id: string;
  name: string;
  description: string | null;
  capacity: number;
  price_per_pilot: number;
  price_kids: number;
  is_active: boolean;
  created_at: string;
}

export interface TimeSlot {
  id: string;
  track_id: string;
  date: string;
  start_time: string;
  end_time: string;
  max_capacity: number;
  ocupados_atualmente: number;
  is_available: boolean;
  created_at: string;
  track?: Track;
}

export type BatteryType = 'individual' | 'kids';
export type ReservationStatus = 'pending' | 'paid' | 'cancelled' | 'expired';

export interface Reservation {
  id: string;
  time_slot_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  num_pilots: number;
  battery_type: BatteryType;
  valor_total: number;
  payment_method: string | null;
  status: ReservationStatus;
  payment_id: string | null;
  reservation_code?: string | null;
  checkout_url?: string | null;
  customer_cpf?: string | null;
  pilotos_token?: string | null;
  pilotos_completos?: boolean;
  created_at: string;
  updated_at: string;
  time_slot?: TimeSlot;
}

export interface BookingData {
  date: Date | null;
  timeSlot: TimeSlot | null;
  track: Track | null;
  numPilots: number;
  batteryType: BatteryType;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerCpf: string;
  paymentMethod: string;
}

export type BookingStep = 'date' | 'details' | 'customer' | 'payment' | 'confirmation';
