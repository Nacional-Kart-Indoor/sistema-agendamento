/**
 * Meta Pixel — Nacional Kart Indoor
 *
 * O snippet base (fbevents.js + init + PageView inicial) fica no index.html.
 * Este arquivo concentra os disparos do funil, o advanced matching e a leitura
 * dos cookies _fbp/_fbc usados na Conversions API (dedupe do Purchase).
 *
 * Funil mapeado:
 *   PageView          -> toda página pública (index.html + troca de rota da SPA)
 *   AddToCart         -> entrou em "Configure sua Bateria"
 *   InitiateCheckout  -> entrou em "Resumo e Pagamento" (com valor)
 *   Purchase          -> pagamento confirmado (navegador + CAPI no webhook)
 */

export const META_PIXEL_ID = '28257199233881770';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

type EventParams = Record<string, unknown>;

const INTERNAL_ROUTES = ['/admin', '/atendente'];

/** Rotas internas (painel das atendentes e admin) não geram evento. */
export function isInternalRoute(pathname?: string): boolean {
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '/');
  return INTERNAL_ROUTES.some((route) => path.startsWith(route));
}

function callFbq(...args: unknown[]) {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return;
  if (isInternalRoute()) return;
  try {
    window.fbq(...args);
  } catch (error) {
    console.warn('[meta-pixel] falha ao disparar evento', error);
  }
}

const onlyDigits = (value: string) => value.replace(/\D/g, '');

/** Telefone no formato E.164 sem "+" (ex.: 5562992876718). */
export function normalizePhone(phone?: string | null): string | undefined {
  const digits = onlyDigits(phone || '');
  if (digits.length < 10) return undefined;
  return digits.startsWith('55') ? digits : `55${digits}`;
}

function splitName(fullName?: string | null): { fn?: string; ln?: string } {
  const parts = (fullName || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  return { fn: parts[0], ln: parts.length > 1 ? parts[parts.length - 1] : undefined };
}

/** ID anônimo e estável por navegador — melhora o match rate e liga navegador + CAPI. */
export function getExternalId(): string {
  const KEY = 'nki_external_id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `nki-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY, id);
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

/** Dados enviados para a edge function e gravados na reserva (usados no Purchase via CAPI). */
export function getTrackingPayload() {
  const { fbp, fbc } = getFbCookies();
  return {
    fbp,
    fbc,
    external_id: getExternalId(),
    event_source_url: typeof window !== 'undefined' ? window.location.href : undefined,
  };
}

/** Liga o external_id ao pixel logo no carregamento. */
export function attachExternalId() {
  const externalId = getExternalId();
  if (!externalId) return;
  callFbq('init', META_PIXEL_ID, { external_id: externalId, country: 'br' });
}

/**
 * Advanced matching: reenvia o init com os dados do cliente.
 * O próprio pixel normaliza e faz o hash SHA-256 no navegador.
 */
export function identify(user: { email?: string | null; phone?: string | null; name?: string | null }) {
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

export function track(eventName: string, params: EventParams = {}, eventId?: string) {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  if (eventId) callFbq('track', eventName, clean, { eventID: eventId });
  else callFbq('track', eventName, clean);
}

export function trackPageView() {
  track('PageView');
}

/** Garante um único disparo por chave dentro da mesma aba (ex.: Purchase por reserva). */
export function trackOnce(key: string, run: () => void) {
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    // sem sessionStorage disponível: segue e dispara mesmo assim
  }
  run();
}
