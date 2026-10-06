// Cloudflare Worker: API dello strumento di analisi.
//   POST /api/start   valida form, anti-bot, rate limit → token firmato
//   POST /api/step    esegue un passo dell'analisi (psiMobile, psiDesktop, site, ssl, style)
//   POST /api/finish  verifica i passi, costruisce il report, salva il contatto
import { AuditError, parseTargetUrl, parseEmail, rateKeyHost } from './validate.js';
import { corsHeaders, allowedOrigins, makeToken, readToken, stepSignature, verify, checkAndCountRateLimit, verifyTurnstile, requireSecret } from './guard.js';
import { runPsi, reducePsi, extractScreenshot } from './psi.js';
import { collectSite } from './checks/site.js';
import { checkCertificate } from './ssl.js';
import { buildReport } from './report.js';
import { saveLead, parkLead } from './leads.js';
import { collectExtras, buildExtras } from './extras.js';
import { checkLinks } from './checks/links.js';

const CONSENT_VERSION = 'informativa-2026-10';
const MAX_BODY = 400_000;
const MIN_FORM_MS = 2000;
const STEPS = ['psiMobile', 'psiDesktop', 'site', 'ssl', 'style', 'links'];
const REPORT_TTL = 6 * 3600;
const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

function json(data, status, origin, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
      ...corsHeaders(origin, env),
    },
  });
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new AuditError('too_large', 'Richiesta troppo grande.', 413);
  try { return JSON.parse(text || '{}'); } catch { throw new AuditError('bad_json', 'Richiesta non valida.'); }
}

/* ───────── /api/start ───────── */
async function handleStart(request, env, ctx, deps) {
  const body = await readJson(request);
  const ip = request.headers.get('cf-connecting-ip') || 'local';

  // Anti-bot: campo trappola + tempo minimo di compilazione
  if (body.hp) throw new AuditError('bot', 'Non è stato possibile avviare l\'analisi.', 400);
  if (typeof body.elapsed === 'number' && body.elapsed < MIN_FORM_MS) {
    throw new AuditError('too_fast', 'Hai compilato il modulo molto in fretta. Riprova tra qualche secondo.', 400);
  }
  if (body.consent !== true) {
    throw new AuditError('consent_required', 'Per procedere serve il consenso al trattamento dell\'email.', 400);
  }
  const email = parseEmail(body.email);
  const target = parseTargetUrl(body.url);
  await verifyTurnstile(env, body.turnstile, ip, deps.fetchImpl);
  requireSecret(env);
  await checkAndCountRateLimit(env, { ip, domain: rateKeyHost(target.host), now: deps.now() });

  const jobId = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  const now = deps.now();
  const token = await makeToken(env, {
    j: jobId,
    u: target.url,
    h: target.host,
    e: email,
    c: new Date(now).toISOString(),
    x: now + 15 * 60_000,
  });
  return { ok: true, token, url: target.url, host: target.host, steps: STEPS };
}

/* ───────── /api/step ───────── */
async function runStep(step, tok, body, env, deps) {
  const f = deps.fetchImpl;
  switch (step) {
    case 'psiMobile':
    case 'psiDesktop': {
      const strategy = step === 'psiMobile' ? 'mobile' : 'desktop';
      const raw = await runPsi({ url: tok.u, strategy, apiKey: env.PSI_API_KEY, endpoint: env.PSI_ENDPOINT, fetchImpl: f });
      return { data: reducePsi(raw, strategy), screenshot: strategy === 'mobile' ? extractScreenshot(raw) : null };
    }
    case 'site':
      return { data: await collectSite(tok.u, { fetchImpl: f }) };
    case 'ssl':
      return { data: await checkCertificate(tok.h, { fetchImpl: f, now: deps.now() }) };
    case 'style': {
      const siteStep = body.site;
      const siteOk = siteStep && (await verify(requireSecret(env), `step.${tok.j}.site.${siteStep.payload}`, siteStep.sig));
      if (!siteOk) throw new AuditError('step_invalid', 'Passo non valido.', 400);
      const parsed = JSON.parse(siteStep.payload);
      if (!parsed.ok) throw new AuditError('step_invalid', 'Passo non valido.', 400);
      return { data: await collectExtras(parsed.data, { fetchImpl: f }) };
    }
    case 'links': {
      // l'elenco dei link arriva dal passo "style" firmato: il browser non può farci visitare indirizzi a piacere
      const st = body.style;
      const ok = st && typeof st.payload === 'string' && (await verify(requireSecret(env), `step.${tok.j}.style.${st.payload}`, st.sig));
      if (!ok) throw new AuditError('step_invalid', 'Passo non valido.', 400);
      const parsed = JSON.parse(st.payload);
      if (!parsed.ok || !Array.isArray(parsed.data.links)) throw new AuditError('step_invalid', 'Passo non valido.', 400);
      return { data: await checkLinks(parsed.data.links, { fetchImpl: f }) };
    }
    default:
      throw new AuditError('step_unknown', 'Passo sconosciuto.', 400);
  }
}

async function handleStep(request, env, ctx, deps) {
  const body = await readJson(request);
  const tok = await readToken(env, body.token, deps.now());
  const step = String(body.step);
  if (!STEPS.includes(step)) throw new AuditError('step_unknown', 'Passo sconosciuto.', 400);

  let result;
  try {
    const out = await runStep(step, tok, body, env, deps);
    result = { payload: JSON.stringify({ ok: true, data: out.data }), screenshot: out.screenshot || undefined };
  } catch (e) {
    if (!(e instanceof AuditError)) {
      console.error('step_error', step, e && e.stack || e);
      e = new AuditError('internal', 'Qualcosa è andato storto durante l\'analisi.', 500);
    }
    result = { payload: JSON.stringify({ ok: false, error: { code: e.code, message: e.message } }) };
  }
  return { ok: true, step, payload: result.payload, sig: await stepSignature(env, tok.j, step, result.payload), ...(result.screenshot ? { screenshot: result.screenshot } : {}) };
}

/* ───────── /api/finish ───────── */
async function handleFinish(request, env, ctx, deps) {
  const body = await readJson(request);
  const tok = await readToken(env, body.token, deps.now());

  // un token = un solo report (evita duplicati nei contatti)
  const doneKey = `done:${tok.j}`;
  if (env.AUDIT_KV && (await env.AUDIT_KV.get(doneKey))) {
    throw new AuditError('already_done', 'Questa analisi è già stata completata. Ricarica la pagina per farne un\'altra.', 409);
  }
  if (env.AUDIT_KV) await env.AUDIT_KV.put(doneKey, '1', { expirationTtl: 3600 });

  const steps = {};
  for (const name of STEPS) {
    const s = body.steps?.[name];
    if (!s || typeof s.payload !== 'string') continue;
    const ok = await verify(requireSecret(env), `step.${tok.j}.${name}.${s.payload}`, s.sig);
    if (!ok) throw new AuditError('step_invalid', 'Dati dell\'analisi non validi. Riprova.', 400);
    steps[name] = JSON.parse(s.payload);
  }

  const lead = {
    email: tok.e,
    url: tok.u,
    date: new Date(deps.now()).toISOString(),
    consentAt: tok.c,
    consentVersion: CONSENT_VERSION,
    score: null,
    label: '',
    outcome: '',
  };

  // Errori che impediscono il report
  const fatal = steps.site && !steps.site.ok ? steps.site.error
    : !steps.site ? { code: 'incomplete', message: 'L\'analisi non si è completata. Riprova tra qualche minuto.' }
    : steps.psiMobile && !steps.psiMobile.ok ? steps.psiMobile.error
    : !steps.psiMobile ? { code: 'incomplete', message: 'L\'analisi non si è completata. Riprova tra qualche minuto.' }
    : null;

  if (fatal) {
    lead.outcome = `errore: ${fatal.code}`;
    await persistLead(env, ctx, tok.j, lead, deps);
    return { ok: false, error: fatal };
  }

  const extras = steps.style?.ok ? buildExtras(steps.style.data, steps.site.data, deps.now(), steps.psiMobile?.ok ? steps.psiMobile.data : null) : [];
  const report = buildReport({ steps, now: deps.now(), extras });
  lead.score = report.score;
  lead.label = report.label?.text || '';
  // dati in più per te: aiutano a rispondere subito con cognizione di causa
  const areaScore = (id) => report.areas.find((a) => a.id === id)?.score ?? null;
  lead.scores = { speed: areaScore('speed'), mobile: areaScore('mobile'), seo: areaScore('seo'), trust: areaScore('trust') };
  lead.counts = report.counts;
  lead.top = report.issues.slice(0, 3).map((i) => i.title);
  lead.platform = (steps.style?.ok && steps.style.data.platform) || '';
  lead.outcome = report.partial.desktopMissing ? 'ok (senza desktop)' : 'ok';
  await persistLead(env, ctx, tok.j, lead, deps);

  // Copia del report per 6 ore, raggiungibile solo con un codice casuale: serve a riaprirlo nel browser vero
  // quando l'analisi è stata fatta in un browser integrato (Instagram, Facebook...) che non permette di stampare.
  let shareId = null;
  if (env.AUDIT_KV) {
    shareId = randomHex(16);
    try { await env.AUDIT_KV.put(`rep:${shareId}`, JSON.stringify(report), { expirationTtl: REPORT_TTL }); } catch { shareId = null; }
  }
  return { ok: true, report, shareId };
}

async function handleReport(request, env) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[a-f0-9]{32}$/.test(id)) throw new AuditError('report_not_found', 'Report non trovato.', 404);
  const raw = env.AUDIT_KV ? await env.AUDIT_KV.get(`rep:${id}`) : null;
  if (!raw) throw new AuditError('report_expired', 'Questo report non è più disponibile (resta salvato per 6 ore). Rifai l\'analisi.', 404);
  return { ok: true, report: JSON.parse(raw) };
}

async function persistLead(env, ctx, jobId, lead, deps) {
  // Lo script Google può metterci 10-20 secondi: il report non aspetta, il salvataggio prosegue in background.
  // Se alla fine non riesce, il contatto resta 30 giorni nel KV.
  const job = (async () => {
    const res = await saveLead(env, lead, { fetchImpl: deps.fetchImpl });
    if (!res.saved) await parkLead(env, jobId, lead);
  })();
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(job);
  else await job;
}

/* ───────── router ───────── */
export default {
  async fetch(request, env, ctx, depsOverride = {}) {
    const deps = { fetchImpl: fetch, now: () => Date.now(), ...depsOverride };
    const origin = request.headers.get('origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      const ok = allowedOrigins(env).includes(origin);
      return new Response(null, { status: ok ? 204 : 403, headers: { ...corsHeaders(origin, env), 'x-robots-tag': 'noindex' } });
    }
    if (url.pathname === '/api/health' && request.method === 'GET') return json({ ok: true }, 200, origin, env);

    if (url.pathname === '/api/report' && request.method === 'GET') {
      if (!allowedOrigins(env).includes(origin)) {
        return json({ ok: false, error: { code: 'forbidden_origin', message: 'Richiesta non autorizzata da questo sito.' } }, 403, origin, env);
      }
      try { return json(await handleReport(request, env), 200, origin, env); } catch (e) {
        if (e instanceof AuditError) return json({ ok: false, error: { code: e.code, message: e.message } }, e.status, origin, env);
        return json({ ok: false, error: { code: 'internal', message: 'Errore imprevisto.' } }, 500, origin, env);
      }
    }

    const routes = { '/api/start': handleStart, '/api/step': handleStep, '/api/finish': handleFinish };
    const handler = routes[url.pathname];
    if (!handler || request.method !== 'POST') return json({ ok: false, error: { code: 'not_found', message: 'Non trovato.' } }, 404, origin, env);

    if (!allowedOrigins(env).includes(origin)) {
      return json({ ok: false, error: { code: 'forbidden_origin', message: 'Richiesta non autorizzata da questo sito.' } }, 403, origin, env);
    }
    try {
      return json(await handler(request, env, ctx, deps), 200, origin, env);
    } catch (e) {
      if (e instanceof AuditError) return json({ ok: false, error: { code: e.code, message: e.message } }, e.status, origin, env);
      console.error('unhandled', e && e.stack || e);
      return json({ ok: false, error: { code: 'internal', message: 'Errore imprevisto. Riprova tra qualche minuto.' } }, 500, origin, env);
    }
  },
};
