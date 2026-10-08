/**
 * Meta Pixel — Nacional Kart Indoor (browser-side)
 *
 * O ID do pixel do Nacional Kart Indoor já vem configurado (DEFAULT_PIXEL_ID).
 * VITE_META_PIXEL_ID sobrescreve; `VITE_META_PIXEL_ID=off` desliga o pixel
 * (útil em dev local para não poluir os dados) — aí todas as funções viram no-op.
 *
 * Rotas internas (/admin, /atendente) e a página pós-compra de cadastro de
 * pilotos (/reserva/:token/pilotos) nunca carregam nem disparam o pixel: as
 * atendentes não poluem público nem conversão, e o cadastro de pilotos é
 * tráfego de link de WhatsApp, não de aquisição.
 *
 * O Purchase também é enviado pelo servidor (asaas-webhook, via Conversions
 * API) com o mesmo event_id, para o Meta deduplicar. Os cookies _fbp/_fbc, um
 * external_id anônimo e a URL de origem viajam junto com a reserva
 * (getTrackingPayload) para sustentar o match no envio server-side.
 *
 * Funil mapeado (ver TRACKING-META.md):
 *   PageView          -> carregamento inicial + troca de rota da SPA
 *   ViewContent       -> selecionou um horário
 *   AddToCart         -> "Continuar" em Configure sua Bateria (com valor)
 *   InitiateCheckout  -> dados do cliente válidos (com valor + advanced matching)
 *   AddPaymentInfo    -> reserva criada, indo para a Asaas
 *   Purchase          -> pagamento confirmado (navegador + CAPI)
 */

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

const DEFAULT_PIXEL_ID = '28257199233881770';

function resolvePixelId(): string {
  const fromEnv = (import.meta.env.VITE_META_PIXEL_ID as string | undefined)?.trim();
  if (fromEnv === 'off') return '';
  return fromEnv || DEFAULT_PIXEL_ID;
}

export const META_PIXEL_ID = resolvePixelId();

export type MetaStandardEvent =
  | 'ViewContent'
  | 'AddToCart'
  | 'InitiateCheckout'
  | 'AddPaymentInfo'
  | 'Purchase'
  | 'Lead'
  | 'Schedule';

export interface MetaEventParams {
  value?: number;
  currency?: string;
  content_ids?: string[];
  content_type?: 'product' | 'product_group';
  content_name?: string;
  content_category?: string;
  contents?: { id: string; quantity: number; item_price?: number }[];
  num_items?: number;
  order_id?: string;
  [key: string]: unknown;
}

const INTERNAL_ROUTES = ['/admin', '/atendente', '/reserva'];
const EXTERNAL_ID_KEY = 'nki_external_id';

let initialized = false;

export function isMetaPixelEnabled(): boolean {
  return !!META_PIXEL_ID;
}

/** Rotas sem valor de aquisição (painel interno e cadastro de pilotos) não geram evento. */
export function isInternalRoute(pathname?: string): boolean {
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return INTERNAL_ROUTES.some((route) => path.startsWith(route));
}

// ─── Identificação ───────────────────────────────────────────────────────────

/** ID anônimo e estável por navegador — melhora o match rate e liga navegador + CAPI. */
export function getExternalId(): string {
  try {
    let id = localStorage.getItem(EXTERNAL_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `nki-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(EXTERNAL_ID_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Cookies do Meta usados pela Conversions API.
 * _fbc é montado a partir do fbclid da URL quando o cookie ainda não existe.
 */
export function getFbCookies(): { fbp?: string; fbc?: string } {
  const fbp = readCookie('_fbp');
  let fbc = readCookie('_fbc');

  if (!fbc && typeof window !== 'undefined') {
    const fbclid = new URLSearchParams(window.location.search).get('fbclid');
    if (fbclid) fbc = `fb.1.${Date.now()}.${fbclid}`;
  }

  return { fbp, fbc };
}

/** Dados enviados ao create-reservation e gravados na reserva (usados no Purchase via CAPI). */
export function getTrackingPayload() {
  const { fbp, fbc } = getFbCookies();
  return {
    fbp,
    fbc,
    external_id: getExternalId(),
    event_source_url: typeof window !== 'undefined' ? window.location.href : undefined,
  };
}

/** Telefone no formato E.164 sem "+" (ex.: 5562992876718). */
export function normalizePhone(phone?: string | null): string | undefined {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) return undefined;
  return digits.startsWith('55') ? digits : `55${digits}`;
}

function splitName(fullName?: string | null): { fn?: string; ln?: string } {
  const parts = (fullName || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  return { fn: parts[0], ln: parts.length > 1 ? parts[parts.length - 1] : undefined };
}

// ─── Núcleo ──────────────────────────────────────────────────────────────────

function callFbq(...args: unknown[]): void {
  if (!META_PIXEL_ID || typeof window === 'undefined' || typeof window.fbq !== 'function') return;
  if (isInternalRoute()) return;
  try {
    window.fbq(...args);
  } catch (err) {
    console.warn('[meta-pixel] falha ao disparar evento', err);
  }
}

/** Injeta o script base do Meta Pixel, liga o external_id e dispara o PageView inicial. */
export function initMetaPixel(): void {
  if (!META_PIXEL_ID || initialized || typeof window === 'undefined') return;
  if (isInternalRoute()) return;
  initialized = true;

  // Snippet oficial do Meta, convertido para TS.
  type FbqFn = ((...args: unknown[]) => void) & {
    callMethod?: (...args: unknown[]) => void;
    queue: unknown[][];
    push: unknown;
    loaded: boolean;
    version: string;
  };
  const w = window as unknown as { fbq?: FbqFn; _fbq?: FbqFn };
  if (!w.fbq) {
    const n = ((...args: unknown[]) => {
      if (n.callMethod) {
        n.callMethod(...args);
      } else {
        n.queue.push(args);
      }
    }) as FbqFn;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    w.fbq = n;
    if (!w._fbq) w._fbq = n;

    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(script);
  }

  const externalId = getExternalId();
  callFbq('init', META_PIXEL_ID, externalId ? { external_id: externalId, country: 'br' } : {});
  callFbq('track', 'PageView');
}

/**
 * Advanced matching: reenvia o init com os dados do cliente.
 * O próprio pixel normaliza e faz o hash SHA-256 no navegador.
 */
export function identify(user: { email?: string | null; phone?: string | null; name?: string | null }): void {
  const data: Record<string, string> = { country: 'br' };

  const email = (user.email || '').trim().toLowerCase();
  if (email) data.em = email;

  const phone = normalizePhone(user.phone);
  if (phone) data.ph = phone;

  const { fn, ln } = splitName(user.name);
  if (fn) data.fn = fn;
  if (ln) data.ln = ln;

  const externalId = getExternalId();
  if (externalId) data.external_id = externalId;

  callFbq('init', META_PIXEL_ID, data);
}

/**
 * Dispara um evento padrão. `eventId` é opcional mas recomendado em eventos
 * que também são enviados via CAPI (Purchase), para deduplicação.
 */
export function trackMetaEvent(
  event: MetaStandardEvent,
  params: MetaEventParams = {},
  eventId?: string,
): void {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  if (eventId) callFbq('track', event, clean, { eventID: eventId });
  else callFbq('track', event, clean);
}

/** Evento personalizado (não padrão) — aparece no Gerenciador como custom event. */
export function trackMetaCustomEvent(event: string, params: MetaEventParams = {}): void {
  callFbq('trackCustom', event, params);
}

/** PageView em troca de rota da SPA (o inicial sai no initMetaPixel). */
export function trackPageView(): void {
  callFbq('track', 'PageView');
}

/** Garante um único disparo por chave dentro da mesma aba (ex.: Purchase por reserva). */
export function trackOnce(key: string, run: () => void): void {
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    // sem sessionStorage disponível: segue e dispara mesmo assim
  }
  run();
}
