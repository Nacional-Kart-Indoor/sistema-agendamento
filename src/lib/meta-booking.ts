// Monta os parâmetros dos eventos Meta a partir do estado da reserva.
// Centralizado aqui para que todos os eventos do funil (navegador e CAPI)
// enviem o mesmo content_id e o mesmo cálculo de valor.
//
// content_id é estável por tipo de bateria (`bateria-individual` / `bateria-kids`),
// não o UUID da pista: isso mantém o catálogo e os relatórios legíveis mesmo
// se as pistas forem recriadas no banco.

import { BatteryType, BookingData, Reservation } from '@/types/booking';
import { MetaEventParams } from '@/lib/meta-pixel';

export const META_CURRENCY = 'BRL';
export const META_CONTENT_CATEGORY = 'Agendamento de Kart';

export function batteryContentId(batteryType: BatteryType | string | null | undefined): string {
  return `bateria-${batteryType === 'kids' ? 'kids' : 'individual'}`;
}

export function batteryContentName(batteryType: BatteryType | string | null | undefined): string {
  return `Bateria ${batteryType === 'kids' ? 'Kids' : 'Individual'}`;
}

const round2 = (n: number) => Number(n.toFixed(2));

export function bookingEventParams(data: BookingData, total: number): MetaEventParams {
  const track = data.track;
  const contentId = batteryContentId(data.batteryType);
  const pricePerPilot = track
    ? data.batteryType === 'kids'
      ? Number(track.price_kids)
      : Number(track.price_per_pilot)
    : undefined;

  return {
    value: round2(total),
    currency: META_CURRENCY,
    content_type: 'product',
    content_ids: [contentId],
    content_name: batteryContentName(data.batteryType),
    content_category: META_CONTENT_CATEGORY,
    contents: [{ id: contentId, quantity: data.numPilots, item_price: pricePerPilot }],
    num_items: data.numPilots,
    track_name: track?.name,
    booking_date: data.date ? data.date.toISOString().slice(0, 10) : undefined,
    booking_time: data.timeSlot?.start_time?.slice(0, 5),
  };
}

export function reservationPurchaseParams(reservation: Reservation): MetaEventParams {
  const value = Number(reservation.valor_total) || 0;
  const numPilots = Number(reservation.num_pilots) || 1;
  const contentId = batteryContentId(reservation.battery_type);

  return {
    value: round2(value),
    currency: META_CURRENCY,
    content_type: 'product',
    content_ids: [contentId],
    content_name: batteryContentName(reservation.battery_type),
    content_category: META_CONTENT_CATEGORY,
    contents: [{ id: contentId, quantity: numPilots, item_price: round2(value / numPilots) }],
    num_items: numPilots,
    order_id: reservation.id,
  };
}

/** event_id compartilhado entre pixel (navegador) e CAPI (webhook) para dedupe. */
export function purchaseEventId(reservationId: string): string {
  return `purchase-${reservationId}`;
}
