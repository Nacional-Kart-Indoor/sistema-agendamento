-- Feriados (nacionais + municipais de Goiânia-GO) e correção da janela de
-- horários gerados por generate_future_time_slots(): hoje gera 10h-22h todo
-- dia; precisa ser 14h-22h em dia útil e 10h-22h em fim de semana/feriado.

CREATE TABLE public.feriados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL UNIQUE,
  descricao text NOT NULL,
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('nacional', 'municipal', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feriados ENABLE ROW LEVEL SECURITY;

CREATE POLICY feriados_select_staff ON public.feriados
  FOR SELECT
  USING (has_role(auth.uid(), 'atendente'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

COMMENT ON TABLE public.feriados IS 'Datas em que a pista opera no horário de fim de semana (10h-22h) em vez do horário de dia útil (14h-22h). origem=nacional/municipal são calculados automaticamente; manual é marcado pela atendente via set_manual_holiday().';

-- ─── Páscoa (algoritmo Anônimo/Gauss) — base pros feriados móveis ────────────
CREATE OR REPLACE FUNCTION public.easter_sunday(p_year int)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
  v_month int; v_day int;
BEGIN
  a := p_year % 19;
  b := p_year / 100;
  c := p_year % 100;
  d := b / 4;
  e := b % 4;
  f := (b + 8) / 25;
  g := (b - f + 1) / 3;
  h := (19*a + b - d - g + 15) % 30;
  i := c / 4;
  k := c % 4;
  l := (32 + 2*e + 2*i - h - k) % 7;
  m := (a + 11*h + 22*l) / 451;
  v_month := (h + l - 7*m + 114) / 31;
  v_day := ((h + l - 7*m + 114) % 31) + 1;
  RETURN make_date(p_year, v_month, v_day);
END;
$$;

-- ─── Popula feriados nacionais + municipais (Goiânia-GO) de um ano ──────────
-- Idempotente (ON CONFLICT DO NOTHING) — nunca sobrescreve uma data já
-- marcada (nem outro feriado, nem uma marcação manual da atendente).
CREATE OR REPLACE FUNCTION public.populate_holidays(p_year int)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_easter date := easter_sunday(p_year);
BEGIN
  INSERT INTO public.feriados (data, descricao, origem) VALUES
    (make_date(p_year, 1, 1), 'Confraternização Universal', 'nacional'),
    (make_date(p_year, 4, 21), 'Tiradentes', 'nacional'),
    (make_date(p_year, 5, 1), 'Dia do Trabalho', 'nacional'),
    (make_date(p_year, 9, 7), 'Independência do Brasil', 'nacional'),
    (make_date(p_year, 10, 12), 'Nossa Senhora Aparecida', 'nacional'),
    (make_date(p_year, 11, 2), 'Finados', 'nacional'),
    (make_date(p_year, 11, 15), 'Proclamação da República', 'nacional'),
    (make_date(p_year, 11, 20), 'Dia Nacional de Zumbi e da Consciência Negra', 'nacional'),
    (make_date(p_year, 12, 25), 'Natal', 'nacional'),
    (v_easter - 47, 'Carnaval', 'nacional'),
    (v_easter - 2, 'Sexta-feira Santa', 'nacional'),
    (v_easter + 60, 'Corpus Christi', 'nacional'),
    (make_date(p_year, 5, 24), 'Nossa Senhora Auxiliadora (padroeira de Goiânia)', 'municipal'),
    (make_date(p_year, 10, 24), 'Aniversário de Goiânia', 'municipal')
  ON CONFLICT (data) DO NOTHING;
END;
$$;

-- ─── RPCs pra atendente marcar/desmarcar feriado manual (aba "Feriados") ────
CREATE OR REPLACE FUNCTION public.set_manual_holiday(p_data date, p_descricao text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (has_role(auth.uid(), 'atendente'::app_role) OR has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.feriados (data, descricao, origem)
  VALUES (p_data, COALESCE(NULLIF(trim(p_descricao), ''), 'Feriado / ponto facultativo'), 'manual')
  ON CONFLICT (data) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.unset_manual_holiday(p_data date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (has_role(auth.uid(), 'atendente'::app_role) OR has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  DELETE FROM public.feriados WHERE data = p_data AND origem = 'manual';
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_manual_holiday(date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unset_manual_holiday(date) TO authenticated;

-- ─── Seed: ano corrente e o próximo ──────────────────────────────────────────
SELECT public.populate_holidays(EXTRACT(YEAR FROM CURRENT_DATE)::int);
SELECT public.populate_holidays(EXTRACT(YEAR FROM CURRENT_DATE)::int + 1);

-- ─── Corrige generate_future_time_slots(): 14h-22h em dia útil comum,
--     10h-22h em fim de semana OU feriado (public.feriados) ─────────────────
CREATE OR REPLACE FUNCTION public.generate_future_time_slots()
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.time_slots
    (date, start_time, end_time, track_id, is_available, max_capacity, ocupados_atualmente)
  SELECT
    d.date,
    (d.start_hour + (n * interval '30 minutes'))::TIME,
    (d.start_hour + ((n + 1) * interval '30 minutes'))::TIME,
    track.id,
    true, 12, 0
  FROM (
    SELECT
      gs::date AS date,
      CASE
        WHEN EXTRACT(DOW FROM gs) IN (0, 6)
          OR EXISTS (SELECT 1 FROM public.feriados f WHERE f.data = gs::date)
        THEN time '10:00'
        ELSE time '14:00'
      END AS start_hour
    FROM generate_series(CURRENT_DATE, CURRENT_DATE + interval '45 days', '1 day') AS gs
  ) d
  CROSS JOIN generate_series(0, 23) n
  CROSS JOIN (SELECT id FROM public.tracks WHERE is_active = true) track
  WHERE (d.start_hour + ((n + 1) * interval '30 minutes')) <= time '22:00'
  ON CONFLICT DO NOTHING;
END;
$function$;

-- ─── Limpeza: remove horários futuros de segunda-manhã já gerados errado
--     (só linhas com 0 ocupação — nunca mexe em algo com reserva real) ──────
DELETE FROM public.time_slots ts
WHERE ts.date >= CURRENT_DATE
  AND ts.ocupados_atualmente = 0
  AND ts.start_time < (
    CASE
      WHEN EXTRACT(DOW FROM ts.date) IN (0, 6)
        OR EXISTS (SELECT 1 FROM public.feriados f WHERE f.data = ts.date)
      THEN time '10:00'
      ELSE time '14:00'
    END
  );

-- ─── Reagenda o cron diário: gera slots + garante feriados de ano
--     corrente e próximo sempre populados (auto-manutenção, nunca precisa
--     lembrar de atualizar feriados móveis de anos futuros) ─────────────────
SELECT cron.unschedule('generate-daily-time-slots');
SELECT cron.schedule(
  'generate-daily-time-slots',
  '5 0 * * *',
  $$
  SELECT public.populate_holidays(EXTRACT(YEAR FROM CURRENT_DATE)::int);
  SELECT public.populate_holidays(EXTRACT(YEAR FROM CURRENT_DATE)::int + 1);
  SELECT public.generate_future_time_slots();
  $$
);
