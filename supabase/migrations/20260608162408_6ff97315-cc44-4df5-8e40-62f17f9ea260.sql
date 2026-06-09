
-- ============================================
-- app_role enum + user_roles table
-- ============================================
CREATE TYPE public.app_role AS ENUM ('admin', 'atendente');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- has_role security definer function
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- user_roles policies
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- Tighten manual_bookings policies
-- ============================================
DROP POLICY IF EXISTS "Authenticated can view manual bookings" ON public.manual_bookings;
DROP POLICY IF EXISTS "Authenticated can insert manual bookings" ON public.manual_bookings;
DROP POLICY IF EXISTS "Authenticated can update manual bookings" ON public.manual_bookings;
DROP POLICY IF EXISTS "Authenticated can delete manual bookings" ON public.manual_bookings;

CREATE POLICY "Staff can view manual bookings"
  ON public.manual_bookings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'atendente') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Staff can insert manual bookings"
  ON public.manual_bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), 'atendente') OR public.has_role(auth.uid(), 'admin'))
    AND created_by = auth.uid()
  );

CREATE POLICY "Staff can update manual bookings"
  ON public.manual_bookings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'atendente') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'atendente') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Staff can delete manual bookings"
  ON public.manual_bookings FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'atendente') OR public.has_role(auth.uid(), 'admin'));

-- Also allow staff to read reservations directly (they already can via existing public SELECT policy,
-- but explicit policy is left for clarity; nothing to add here).
