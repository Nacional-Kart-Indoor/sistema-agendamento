
REVOKE EXECUTE ON FUNCTION public.recalc_slot_occupancy(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reservations_recalc_slot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.manual_bookings_recalc_slot() FROM PUBLIC, anon, authenticated;
