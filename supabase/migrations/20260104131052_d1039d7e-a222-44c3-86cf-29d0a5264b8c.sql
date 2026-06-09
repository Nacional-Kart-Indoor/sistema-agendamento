-- Criar função para gerar time_slots para D+45
CREATE OR REPLACE FUNCTION generate_future_time_slots()
RETURNS void AS $$
BEGIN
  INSERT INTO time_slots (date, start_time, end_time, track_id, is_available, max_capacity, ocupados_atualmente)
  SELECT 
    d.date,
    t.start_time,
    t.end_time,
    track.id,
    true,
    12,
    0
  FROM (
    SELECT generate_series(CURRENT_DATE, CURRENT_DATE + interval '45 days', '1 day')::date AS date
  ) d
  CROSS JOIN (
    SELECT 
      time '10:00' + (n * interval '30 minutes') AS start_time,
      time '10:00' + ((n + 1) * interval '30 minutes') AS end_time
    FROM generate_series(0, 23) n
  ) t
  CROSS JOIN (
    SELECT id FROM tracks WHERE is_active = true
  ) track
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;