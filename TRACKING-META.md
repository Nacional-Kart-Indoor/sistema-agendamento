# Rastreamento Meta Ads — Nacional Kart Indoor

Pixel: **28257199233881770**

O agendamento é uma SPA: tudo acontece na rota `/`, sem troca de URL entre as etapas.
Por isso os eventos são disparados por mudança de etapa do React, não por página nova.

## Funil

| Etapa na tela | Evento | Onde dispara | Valor |
|---|---|---|---|
| Qualquer página pública | `PageView` | snippet no `index.html` + `MetaPixelRouteTracker` na troca de rota | — |
| "Configure sua Bateria" (depois de escolher a data) | `AddToCart` | `src/pages/Index.tsx` | sem valor (ainda não existe preço definido) |
| "Resumo e Pagamento" | `InitiateCheckout` | `src/pages/Index.tsx` | `value` = total da reserva, `currency` BRL |
| Pagamento aprovado no Stripe | `Purchase` | navegador (`src/pages/Index.tsx`) + Conversions API (`supabase/functions/stripe-webhook`) | `value` = `valor_total` da reserva |

O painel interno (`/admin` e `/atendente`) não carrega o pixel — as atendentes não
poluem público nem conversão.

## Por que o AddToCart vai sem valor

No momento em que a pessoa entra em "Configure sua Bateria" ela só escolheu a data.
Pista, horário, número de pilotos e tipo de bateria ainda não existem, então qualquer
valor enviado ali seria chute e distorceria o ROAS. O valor entra no `InitiateCheckout`,
onde o total já está fechado, e no `Purchase`, onde ele é real.

Se um dia quiserem valor também no AddToCart, o ponto certo é a seleção do horário
dentro do `DetailsStep`, não a entrada na etapa.

## Purchase: navegador + servidor, sem contar em dobro

O pagamento é feito fora do site (Stripe Checkout), então o pixel não existe na tela
de pagamento. O `Purchase` sai de dois lugares:

1. **Navegador** — quando a pessoa volta do Stripe para `/?payment=success&...` e a
   reserva é confirmada como `paid`.
2. **Conversions API** — no `stripe-webhook`, quando o `checkout.session.completed`
   chega. Esse caminho pega inclusive quem pagou e fechou a aba sem voltar ao site.

Os dois usam o mesmo `event_id`: `purchase-<reservation_id>`. O Meta deduplica e conta
uma venda só. O envio pela API ainda leva `fbp`, `fbc`, `external_id`, IP e user agent
gravados na reserva no momento em que ela foi criada, além de e-mail, telefone e nome
com hash SHA-256 — é isso que sustenta o match quando o navegador bloqueia o pixel.

## Advanced matching

Antes do `InitiateCheckout` e do `Purchase`, o pixel é reinicializado com e-mail,
telefone (formato 55DDDNÚMERO), primeiro e último nome e um `external_id` anônimo
guardado no `localStorage`. O hash é feito pelo próprio pixel no navegador. O mesmo
`external_id` viaja para a Conversions API, com hash, para ligar as duas pontas.

## O que precisa ser configurado (fora do código)

1. **Migration** `supabase/migrations/20260820120000_meta_tracking_fields.sql` — cria as
   colunas de rastreamento em `reservations`. Enquanto ela não roda, a reserva continua
   sendo criada normalmente (as edge functions caem para o comportamento antigo e
   registram no log), mas o Purchase pelo servidor perde `fbp`/`fbc` e o match cai.
2. **Secrets das edge functions:**
   - `META_CAPI_ACCESS_TOKEN` — token da Conversions API (Gerenciador de Eventos →
     Configurações → Gerar token de acesso). Sem esse token o Purchase pelo servidor é
     ignorado com log, e só o do navegador continua valendo.
   - `META_PIXEL_ID` — opcional, o código já usa 28257199233881770 como padrão.
   - `META_TEST_EVENT_CODE` — opcional, só durante o teste em "Testar eventos".
   - `SITE_URL` — opcional, usado como `event_source_url` quando a reserva não tem um.
3. **Domínio verificado** no Gerenciador de Negócios e priorização de eventos na
   Mensuração Agregada (Purchase em primeiro lugar).

## Como testar

- **Navegador:** extensão Meta Pixel Helper no site + "Testar eventos" no Gerenciador
  de Eventos. Percorrer o funil: PageView → escolher data → AddToCart → preencher dados
  → InitiateCheckout com o valor da tela.
- **Purchase:** fazer uma reserva com o Stripe em modo teste. Conferir no Gerenciador de
  Eventos se aparece **um** Purchase com origem "Navegador e servidor" (deduplicado).
- **Servidor:** logs da função `stripe-webhook` no Supabase, linha
  `[STRIPE-WEBHOOK] Purchase enviado ao Meta (CAPI)`.
