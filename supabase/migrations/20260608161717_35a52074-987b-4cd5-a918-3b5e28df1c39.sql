
-- ============================================
-- Manual bookings (created by attendants)
-- ============================================
CREATE TABLE public.manual_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  time_slot_id uuid NOT NULL REFERENCES public.time_slots(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  num_pilots integer NOT NULL CHECK (num_pilots >= 1 AND num_pilots <= 12),
  battery_type battery_type NOT NULL DEFAULT 'individual',
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_bookings TO authenticated;
GRANT ALL ON public.manual_bookings TO service_role;

ALTER TABLE public.manual_bookings ENABLE ROW LEVEL SECURITY;

-- Temporary permissive policies for authenticated users.
-- These will be tightened in Fase 2 once the user_roles table exists.
CREATE POLICY "Authenticated can view manual bookings"
  ON public.manual_bookings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert manual bookings"
  ON public.manual_bookings FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can update manual bookings"
  ON public.manual_bookings FOR UPDATE
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete manual bookings"
  ON public.manual_bookings FOR DELETE
  TO authenticated
  USING (true);

CREATE TRIGGER manual_bookings_updated_at
  BEFORE UPDATE ON public.manual_bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_manual_bookings_time_slot ON public.manual_bookings(time_slot_id);

-- ============================================
-- Recalculate slot occupancy
-- Source of truth: paid reservations + manual bookings
-- ============================================
CREATE OR REPLACE FUNCTION public.recalc_slot_occupancy(_slot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  paid_total integer;
  manual_total integer;
BEGIN
  SELECT COALESCE(SUM(num_pilots), 0) INTO paid_total
    FROM public.reservations
    WHERE time_slot_id = _slot_id AND status = 'paid';

  SELECT COALESCE(SUM(num_pilots), 0) INTO manual_total
    FROM public.manual_bookings
    WHERE time_slot_id = _slot_id;

  UPDATE public.time_slots
    SET ocupados_atualmente = paid_total + manual_total
    WHERE id = _slot_id;
END;
$$;

-- Trigger function for reservations
CREATE OR REPLACE FUNCTION public.reservations_recalc_slot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_slot_occupancy(OLD.time_slot_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalc_slot_occupancy(NEW.time_slot_id);
  IF TG_OP = 'UPDATE' AND OLD.time_slot_id IS DISTINCT FROM NEW.time_slot_id THEN
    PERFORM public.recalc_slot_occupancy(OLD.time_slot_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservations_recalc ON public.reservations;
CREATE TRIGGER trg_reservations_recalc
  AFTER INSERT OR UPDATE OF status, num_pilots, time_slot_id OR DELETE
  ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.reservations_recalc_slot();

-- Trigger function for manual_bookings
CREATE OR REPLACE FUNCTION public.manual_bookings_recalc_slot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_slot_occupancy(OLD.time_slot_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalc_slot_occupancy(NEW.time_slot_id);
  IF TG_OP = 'UPDATE' AND OLD.time_slot_id IS DISTINCT FROM NEW.time_slot_id THEN
    PERFORM public.recalc_slot_occupancy(OLD.time_slot_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_bookings_recalc ON public.manual_bookings;
CREATE TRIGGER trg_manual_bookings_recalc
  AFTER INSERT OR UPDATE OF num_pilots, time_slot_id OR DELETE
  ON public.manual_bookings
  FOR EACH ROW EXECUTE FUNCTION public.manual_bookings_recalc_slot();

-- ============================================
-- One-shot recompute for all existing slots
-- ============================================
DO $$
DECLARE
  s record;
BEGIN
  FOR s IN SELECT id FROM public.time_slots LOOP
    PERFORM public.recalc_slot_occupancy(s.id);
  END LOOP;
END$$;
