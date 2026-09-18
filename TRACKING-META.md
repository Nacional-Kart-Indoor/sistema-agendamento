# Rastreamento Meta Ads — Nacional Kart Indoor

O agendamento é uma SPA: tudo acontece na rota `/`, sem troca de URL entre as etapas.
Por isso os eventos do funil são disparados por ação do React, não por página nova.

Pixel: **28257199233881770** — já configurado como padrão em `src/lib/meta-pixel.ts`
e `supabase/functions/_shared/meta-capi.ts`. `VITE_META_PIXEL_ID` (frontend) e
`META_PIXEL_ID` (edge functions) só servem para sobrescrever. Em dev local,
`VITE_META_PIXEL_ID=off` no `.env.local` desliga o pixel para não poluir os dados
(não coloque isso no `.env` — ele é versionado e o build da Vercel o lê).

## Funil

| Etapa na tela | Evento | Onde dispara | Parâmetros |
|---|---|---|---|
| Qualquer página pública | `PageView` | `initMetaPixel()` em `src/main.tsx` + `MetaPixelRouteTracker` na troca de rota | — |
| Selecionou um horário em "Configure sua Bateria" | `ViewContent` | `src/pages/Index.tsx` (effect no `timeSlot`) | value, content_ids |
| Clicou "Continuar" em "Configure sua Bateria" | `AddToCart` | `src/pages/Index.tsx` | value, contents, num_items |
| Dados do cliente válidos → "Resumo e Pagamento" | `InitiateCheckout` | `src/pages/Index.tsx` | value + advanced matching (`identify`) |
| Clicou "Pagar com Stripe" (reserva criada) | `AddPaymentInfo` | `src/hooks/useBooking.ts`, antes do redirect | value, order_id |
| Pagamento aprovado no Stripe | `Purchase` | navegador (`src/pages/Index.tsx`) + Conversions API (`supabase/functions/stripe-webhook`) | value = `valor_total`, order_id |
| Voltou do Stripe cancelado | `CheckoutCancelled` (custom) | `src/pages/Index.tsx` | reservation_id |

Os parâmetros são montados em `src/lib/meta-booking.ts`, para que todos os eventos
(navegador e servidor) usem o mesmo `content_id` e o mesmo valor.

O painel interno (`/admin` e `/atendente`) não carrega o pixel — as atendentes não
poluem público nem conversão (`isInternalRoute` em `src/lib/meta-pixel.ts`).

## content_ids

`bateria-individual` / `bateria-kids`, estáveis por tipo de bateria — não o UUID da
pista. Isso mantém o catálogo e os relatórios legíveis mesmo que as pistas sejam
recriadas no banco. `content_category` é sempre `Agendamento de Kart`.

## Purchase: navegador + servidor, sem contar em dobro

O pagamento é feito fora do site (Stripe Checkout), então o pixel não existe na tela
de pagamento. O `Purchase` sai de dois lugares:

1. **Navegador** — quando a pessoa volta do Stripe para `/?payment=success&...` e a
   reserva é confirmada como `paid`. Guardado por `sessionStorage` (`trackOnce`), então
   um reload não dispara de novo.
2. **Conversions API** — no `stripe-webhook`, quando o `checkout.session.completed`
   chega. Esse caminho pega inclusive quem pagou e fechou a aba sem voltar ao site.
   Quando o envio dá certo, `reservations.meta_purchase_sent_at` é preenchido.

Os dois usam o mesmo `event_id`: `purchase-<reservation_id>`. O Meta deduplica e conta
uma venda só.

## Advanced matching

- **Navegador:** `identify()` reinicializa o pixel com e-mail, telefone
  (formato `55DDDNÚMERO`), primeiro e último nome, `external_id` e país antes do
  `InitiateCheckout` e do `Purchase`. O hash é feito pelo próprio pixel.
- **Servidor:** o `create-reservation` grava na reserva os cookies `_fbp`/`_fbc`, o
  `external_id` (UUID anônimo no `localStorage`), a URL de origem, IP e user agent.
  O `stripe-webhook` manda tudo isso na CAPI (`_shared/meta-capi.ts`), com e-mail,
  telefone e nome em SHA-256. É isso que sustenta o match quando o navegador bloqueia
  o pixel.

O mesmo `external_id` viaja pelos dois lados para ligar as pontas.

## O que precisa ser configurado (fora do código)

1. **Frontend** — nada obrigatório. Opcional: `VITE_META_PIXEL_ID` para trocar o
   pixel, ou `off` para desligar em dev.
2. **Migration** `supabase/migrations/20260820120000_meta_tracking_fields.sql` — cria as
   colunas de rastreamento em `reservations`. Enquanto ela não roda, a reserva continua
   sendo criada normalmente (as edge functions caem para o comportamento antigo e
   registram no log), mas o Purchase pelo servidor perde `fbp`/`fbc` e o match cai.
3. **Secrets das edge functions:**
   - `META_CAPI_ACCESS_TOKEN` — token da Conversions API (Gerenciador de Eventos →
     Configurações → Gerar token de acesso). Sem ele o Purchase pelo servidor é
     ignorado com log, e só o do navegador continua valendo.
   - `META_PIXEL_ID` — opcional, o código já usa 28257199233881770 como padrão.
   - `META_CAPI_TEST_EVENT_CODE` — opcional, só durante o teste em "Testar eventos".
   - `SITE_URL` — opcional, fallback do `event_source_url`.
4. **Deploy** das functions alteradas: `create-reservation`, `create-checkout`,
   `verify-checkout-session`, `stripe-webhook`.
5. **Domínio verificado** no Gerenciador de Negócios e priorização de eventos na
   Mensuração Agregada (Purchase em primeiro lugar).

## Como testar

- **Navegador:** extensão Meta Pixel Helper no site + "Testar eventos" no Gerenciador
  de Eventos. Percorrer o funil: PageView → escolher data → escolher horário
  (ViewContent) → Continuar (AddToCart) → preencher dados (InitiateCheckout com o
  valor da tela) → Pagar com Stripe (AddPaymentInfo).
- **Purchase:** fazer uma reserva com o Stripe em modo teste. Conferir no Gerenciador de
  Eventos se aparece **um** Purchase com origem "Navegador e servidor" (deduplicado).
- **Servidor:** logs da função `stripe-webhook` no Supabase, linha
  `[META-CAPI] Event sent`.
