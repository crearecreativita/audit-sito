// Validazione di URL ed email. Qui si decide cosa il Worker accetta di visitare.

export class AuditError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const BAD_SUFFIXES = [
  '.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet',
  '.test', '.example', '.invalid', '.onion', '.arpa',
];

const URL_MSG = 'Questo indirizzo non sembra un sito web valido. Prova con una forma come www.tuosito.it.';

/**
 * Trasforma quello che scrive l'utente in un URL http/https sicuro da visitare.
 * Lancia AuditError se l'indirizzo è vuoto, non web, interno o con IP diretto.
 */
export function parseTargetUrl(input) {
  let raw = String(input ?? '').trim();
  if (!raw || raw.length > 2048) throw new AuditError('url_invalid', URL_MSG);

  if (!raw.includes('://')) {
    if (/^(javascript|data|file|ftp|mailto|tel|blob|about|view-source):/i.test(raw)) {
      throw new AuditError('url_invalid', 'Posso analizzare solo indirizzi web che iniziano con http o https.');
    }
    raw = 'https://' + raw.replace(/^\/+/, '');
  }

  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new AuditError('url_invalid', URL_MSG);
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new AuditError('url_invalid', 'Posso analizzare solo indirizzi web che iniziano con http o https.');
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  assertPublicHost(host);
  if (u.username || u.password) throw new AuditError('url_invalid', URL_MSG);
  if (u.port && u.port !== '80' && u.port !== '443') {
    throw new AuditError('url_invalid', 'Posso analizzare solo siti sulle porte web standard.');
  }

  u.hash = '';
  return { url: u.href, host, protocol: u.protocol };
}

/** Blocca localhost, indirizzi IP (privati e non), nomi interni. */
export function assertPublicHost(host) {
  const internal = new AuditError(
    'url_internal',
    'Questo indirizzo non è raggiungibile da internet, quindi non posso analizzarlo.'
  );
  if (!host || host === 'localhost') throw internal;
  if (host.includes(':') || host.startsWith('[')) throw internal; // IPv6
  if (/^[\d.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) throw internal; // IPv4 in ogni forma
  if (BAD_SUFFIXES.some((s) => host.endsWith(s))) throw internal;
  if (!host.includes('.')) throw internal;
  const tld = host.split('.').pop();
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) throw new AuditError('url_invalid', URL_MSG);
}

export function parseEmail(input) {
  const email = String(input ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i.test(email)) {
    throw new AuditError('email_invalid', "L'indirizzo email non sembra corretto. Controlla di averlo scritto bene.");
  }
  return email;
}

/** Dominio usato per il rate limit: senza "www." */
export function rateKeyHost(host) {
  return host.replace(/^www\./, '');
}
