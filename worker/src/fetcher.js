// fetch "sicuro": segue i redirect a mano controllando ogni salto, con timeout e limite di dimensione.
import { AuditError, parseTargetUrl } from './validate.js';

export const BOT_UA =
  'Mozilla/5.0 (compatible; CreareCreativitaAudit/1.0; +https://www.crearecreativita.it/)';

async function readCapped(response, maxBytes) {
  if (!response.body) return { text: '', truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(value.slice(0, value.byteLength - (total - maxBytes)));
      truncated = true;
      try { await reader.cancel(); } catch { /* ignore */ }
      break;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return { text: new TextDecoder('utf-8').decode(buf), truncated };
}

/**
 * @returns {{status:number, finalUrl:string, headers:Headers, text:string, truncated:boolean, hops:string[], ms:number}}
 * Lancia AuditError('timeout' | 'unreachable' | 'redirect_loop' ...) se la rete fallisce.
 */
export async function safeFetch(url, opts = {}) {
  const {
    timeoutMs = 12000,
    maxBytes = 1_500_000,
    maxRedirects = 5,
    headers = {},
    method = 'GET',
    followRedirects = true,
    fetchImpl = fetch,
    body = true,
  } = opts;

  const hops = [];
  let current = url;
  const started = Date.now();

  for (let i = 0; i <= maxRedirects; i++) {
    let res;
    try {
      res = await fetchImpl(current, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': BOT_UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'it-IT,it;q=0.9,en;q=0.5', ...headers },
      });
    } catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new AuditError('timeout', 'Il sito ha impiegato troppo a rispondere.');
      }
      throw new AuditError('unreachable', 'Non riesco a raggiungere il sito.');
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      try { await res.body?.cancel(); } catch { /* ignore */ }
      if (!loc || !followRedirects) {
        return { status: res.status, finalUrl: current, headers: res.headers, text: '', truncated: false, hops, ms: Date.now() - started };
      }
      let next;
      try {
        next = parseTargetUrl(new URL(loc, current).href).url; // rivalida l'host a ogni salto
      } catch {
        throw new AuditError('unreachable', 'Il sito rimanda a un indirizzo che non posso visitare.');
      }
      hops.push(next);
      current = next;
      continue;
    }

    let text = '';
    let truncated = false;
    if (body && method !== 'HEAD') {
      try {
        ({ text, truncated } = await readCapped(res, maxBytes));
      } catch {
        throw new AuditError('timeout', 'Il sito ha impiegato troppo a rispondere.');
      }
    } else {
      try { await res.body?.cancel(); } catch { /* ignore */ }
    }
    return { status: res.status, finalUrl: current, headers: res.headers, text, truncated, hops, ms: Date.now() - started };
  }
  throw new AuditError('redirect_loop', 'Il sito rimanda continuamente da un indirizzo all\'altro.');
}

/** Traduce lo stato HTTP della home in un errore comprensibile (o null se va bene). */
export function statusToError(res) {
  const s = res.status;
  if (s < 400) return null;
  const mitigated = res.headers.get('cf-mitigated');
  if (mitigated || [401, 403, 406, 429].includes(s) || (s === 503 && /cloudflare|sucuri|incapsula|akamai/i.test(res.headers.get('server') || ''))) {
    return new AuditError('blocked', 'Il sito blocca gli strumenti di analisi automatica (di solito è una protezione anti-bot). Non è un problema del tuo sito: per analizzarlo bisognerebbe aprire un\'eccezione.');
  }
  if (s === 404) return new AuditError('not_found', 'La home page di questo indirizzo risponde "pagina non trovata". Controlla di aver scritto l\'indirizzo giusto.');
  return new AuditError('server_error', 'Il sito risponde con un errore (codice ' + s + '). Riprova più tardi o controlla che sia online.');
}
