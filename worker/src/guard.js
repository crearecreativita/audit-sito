// Firme, rate limit, Turnstile, CORS: tutto ciò che protegge il Worker dagli abusi.
import { AuditError } from './validate.js';

const enc = new TextEncoder();

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function sign(secret, message) {
  return b64u(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(message)));
}

export async function verify(secret, message, sig) {
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64u(String(sig)), enc.encode(message));
  } catch {
    return false;
  }
}

export function requireSecret(env) {
  if (!env.SIGNING_SECRET || env.SIGNING_SECRET.length < 16) {
    throw new AuditError('misconfigured', 'Il servizio non è configurato correttamente. Riprova più tardi.', 500);
  }
  return env.SIGNING_SECRET;
}

/** Token di sessione: contiene url, email, scadenza. Firmato, quindi non falsificabile dal browser. */
export async function makeToken(env, data) {
  const body = b64u(enc.encode(JSON.stringify(data)));
  return body + '.' + (await sign(requireSecret(env), 'tok.' + body));
}

export async function readToken(env, token, now = Date.now()) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !(await verify(requireSecret(env), 'tok.' + body, sig))) {
    throw new AuditError('token_invalid', 'La sessione non è valida. Ricarica la pagina e riprova.', 401);
  }
  const data = JSON.parse(new TextDecoder().decode(fromB64u(body)));
  if (!data.x || data.x < now) {
    throw new AuditError('token_expired', 'La sessione è scaduta. Ricarica la pagina e riprova.', 401);
  }
  return data;
}

export const stepSignature = (env, jobId, step, payload) => sign(requireSecret(env), `step.${jobId}.${step}.${payload}`);

/** Origin ammessi (CORS). */
export function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

export function corsHeaders(origin, env) {
  if (origin && allowedOrigins(env).includes(origin)) {
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'Origin',
    };
  }
  return {};
}

export async function hashIp(env, ip) {
  return (await sign(requireSecret(env), 'ip.' + ip)).slice(0, 22);
}

const today = (now) => new Date(now).toISOString().slice(0, 10);

/**
 * Rate limit giornaliero per IP e per dominio, più tetto globale.
 * Usa KV (non atomico, ma per questo scopo basta). Gli IP vengono salvati solo come hash e per 25 ore.
 */
export async function checkAndCountRateLimit(env, { ip, domain, now = Date.now() }) {
  const kv = env.AUDIT_KV;
  if (!kv) throw new AuditError('misconfigured', 'Il servizio non è configurato correttamente. Riprova più tardi.', 500);
  const limit = Number(env.RATE_LIMIT_PER_DAY || 3);
  const globalLimit = Number(env.GLOBAL_DAILY_LIMIT || 200);
  const d = today(now);
  const keys = {
    ip: `rl:${d}:ip:${await hashIp(env, ip)}`,
    dom: `rl:${d}:dom:${domain}`,
    all: `rl:${d}:all`,
  };
  const [cIp, cDom, cAll] = await Promise.all([kv.get(keys.ip), kv.get(keys.dom), kv.get(keys.all)]).then((a) => a.map((v) => Number(v || 0)));

  if (cIp >= limit) {
    throw new AuditError('rate_ip', `Hai già fatto ${limit} analisi oggi. Per non sovraccaricare il servizio ne concedo ${limit} al giorno: riprova domani, oppure scrivimi e lo guardiamo insieme.`, 429);
  }
  if (cDom >= limit) {
    throw new AuditError('rate_domain', `Questo sito è già stato analizzato ${limit} volte oggi. Riprova domani.`, 429);
  }
  if (cAll >= globalLimit) {
    throw new AuditError('rate_global', "Oggi il servizio ha raggiunto il numero massimo di analisi. Riprova domani, oppure scrivimi e lo guardiamo insieme.", 429);
  }
  const ttl = { expirationTtl: 25 * 3600 };
  await Promise.all([
    kv.put(keys.ip, String(cIp + 1), ttl),
    kv.put(keys.dom, String(cDom + 1), ttl),
    kv.put(keys.all, String(cAll + 1), ttl),
  ]);
}

export async function verifyTurnstile(env, token, ip, fetchImpl = fetch) {
  if (!env.TURNSTILE_SECRET) return; // Turnstile facoltativo
  if (!token) throw new AuditError('captcha', 'Verifica anti-robot non completata. Ricarica la pagina e riprova.');
  try {
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json();
    if (j.success) return;
  } catch { /* cade nell'errore sotto */ }
  throw new AuditError('captcha', 'Verifica anti-robot non superata. Ricarica la pagina e riprova.');
}
