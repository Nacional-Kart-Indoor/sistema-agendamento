
-- Passo 1: Habilitar extensão pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Passo 2: Agendar job diário às 00:05
SELECT cron.schedule(
  'generate-daily-time-slots',
  '5 0 * * *',
  $$SELECT generate_future_time_slots()$$
);

-- Passo 3: Executar imediatamente para gerar slots até D+45
SELECT generate_future_time_slots();
