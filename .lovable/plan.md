
# Plano: Agenda própria no Supabase + Painel de Atendentes + GitHub

## Visão geral

Hoje a disponibilidade depende do Google Calendar (via N8N). Vamos eliminar essa dependência e usar **somente o Supabase** como fonte de verdade. As atendentes terão um painel próprio com login para ver, criar e excluir agendamentos. Por último, migramos o código para o GitHub.

A execução será dividida em **3 fases independentes** — cada uma só começa após a anterior validada.

---

## FASE 1 — Trocar Google Calendar pelo Supabase

### O que muda na regra de disponibilidade
- Capacidade de cada slot de 30 min = **12 pilotos**
- Vagas ocupadas = soma de pilotos em:
  - Reservas com status `paid` (site)
  - Agendamentos manuais criados pelas atendentes
- Reservas `pending` **não** bloqueiam vagas (evita travar horário durante checkout abandonado)
- Vaga disponível = `12 − ocupados`

### Banco de dados
- Nova tabela `manual_bookings` (agendamentos feitos pelas atendentes — presencial/telefone)
  - Vinculada a `time_slots`
  - Campos: nome, telefone, nº de pilotos, tipo de bateria, observações, atendente que criou
- Atualizar `time_slots.ocupados_atualmente` automaticamente via **trigger** sempre que:
  - Uma `reservation` muda para `paid` (soma) ou sai de `paid` (subtrai)
  - Um `manual_booking` é criado (soma) ou excluído (subtrai)
- Criar função `get_slot_availability(date)` que devolve a lista de horários do dia com vagas restantes — usada pelo site e pelo painel

### Frontend (fluxo de reserva do cliente)
- `DateStep` e `DetailsStep` passam a ler diretamente de `time_slots` (sem chamar N8N)
- Mantém o visual de "vagas disponíveis" por horário
- Sem mudança no fluxo de pagamento (Asaas — migrado do Stripe)

### Limpeza
- Remover edge functions: `check-calendar-availability`, `get-calendar-slots`, `send-webhook`
- Remover secrets: `N8N_CALENDAR_WEBHOOK_URL`, `N8N_WEBHOOK_URL`
- Remover código de chamadas a essas funções em `useBooking.ts`
- Atualizar memórias do projeto (remover referências a Google Calendar e N8N)

---

## FASE 2 — Painel exclusivo das Atendentes

### Autenticação
- Lovable Cloud Auth (email + senha)
- Tabela `user_roles` com enum `app_role` ('atendente', 'admin')
- Função `has_role()` security definer para uso em RLS
- Cadastro de atendentes feito por você (admin) — sem signup público
- Página de login dedicada em `/atendente/login`

### Rota protegida `/atendente`
Acessível somente para usuários com role `atendente` ou `admin`. Conteúdo:

1. **Calendário/dia selecionado** com todos os horários (10:00–22:00, slots de 30 min)
2. Para cada slot:
   - Vagas livres / 12
   - Lista de reservas do site (nome, telefone, pilotos, status pagamento)
   - Lista de agendamentos manuais
3. **Botão "Novo agendamento"** → modal pedindo nome, telefone, pilotos, tipo de bateria, observações
4. **Botão excluir** em cada agendamento manual (com confirmação)
5. Filtros por data e pista

### Permissões
- Atendente: ver tudo + criar e excluir `manual_bookings`
- Atendente **não** edita nem cancela reservas online (mantém integridade do pagamento Asaas)
- Substitui a página `/recepcao` atual (que era sem login) — vai ser removida ou também ficar atrás de login

---

## FASE 3 — Migração para GitHub

Feita só depois das fases 1 e 2 validadas em produção.

1. Publicar versão final no Lovable
2. Conectar repositório GitHub pelo menu **+ → GitHub → Connect project**
3. Criar o repositório (sync bidirecional fica ativo)
4. Configurar manualmente os secrets em qualquer ambiente de deploy externo (Asaas, Supabase, etc — não vão pro GitHub)
5. Opcional: documentar no README como rodar localmente

> Importante: conectar ao GitHub **não** desconecta o projeto do Lovable. Você pode continuar editando aqui e no GitHub em paralelo.

---

## Detalhes técnicos (referência)

### Migrations da Fase 1
```sql
-- manual_bookings
CREATE TABLE public.manual_bookings (
  id uuid PK default gen_random_uuid(),
  time_slot_id uuid REFERENCES time_slots(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  num_pilots int NOT NULL,
  battery_type battery_type NOT NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz default now()
);
GRANT SELECT, INSERT, DELETE ON public.manual_bookings TO authenticated;
GRANT ALL ON public.manual_bookings TO service_role;
ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
-- policies: só authenticated com role atendente/admin

-- trigger: recalcula time_slots.ocupados_atualmente
CREATE FUNCTION recalc_slot_occupancy(slot_id uuid) ...
-- triggers em reservations (AFTER UPDATE OF status) e em manual_bookings
```

### Migrations da Fase 2
```sql
CREATE TYPE app_role AS ENUM ('atendente', 'admin');
CREATE TABLE public.user_roles (
  id uuid PK,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);
-- GRANT + RLS + has_role() security definer (padrão)
```

### Arquivos a remover
- `supabase/functions/check-calendar-availability/`
- `supabase/functions/get-calendar-slots/`
- `supabase/functions/send-webhook/`
- Trechos correspondentes em `src/hooks/useBooking.ts` e `src/components/booking/DateStep.tsx`

### Arquivos novos
- `src/pages/atendente/Login.tsx`
- `src/pages/atendente/Dashboard.tsx`
- `src/components/atendente/SlotCard.tsx`
- `src/components/atendente/NewBookingDialog.tsx`
- `src/hooks/useAtendenteAuth.ts`

---

## Ordem de execução

1. ✅ Aprovar este plano
2. Fase 1 (migration + frontend + remoção N8N) → testar reserva
3. Fase 2 (auth + painel) → você cria o primeiro usuário atendente
4. Fase 3 (GitHub) por último

Quer que eu comece pela Fase 1?
