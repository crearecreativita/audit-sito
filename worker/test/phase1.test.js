import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTargetUrl, parseEmail, AuditError } from '../src/validate.js';
import { analyzeHtml, detectCookies, countMixedContent } from '../src/html.js';
import { parseRobots } from '../src/checks/site.js';
import { pickCertificate } from '../src/ssl.js';
import { reducePsi } from '../src/psi.js';
import { buildReport, wavg, labelFor } from '../src/report.js';
import { checkAndCountRateLimit, makeToken, readToken } from '../src/guard.js';
import worker from '../src/index.js';
import { makeEnv, psiFixture, HOME_HTML } from './helpers.js';

const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof AuditError && e.code === code);

test('URL: accetta e normalizza', () => {
  assert.equal(parseTargetUrl('www.esempio.it').url, 'https://www.esempio.it/');
  assert.equal(parseTargetUrl('  HTTP://Esempio.IT/chi-siamo#x ').url, 'http://esempio.it/chi-siamo');
  assert.equal(parseTargetUrl('https://xn--caff-pma.it').host, 'xn--caff-pma.it');
});

test('URL: blocca interni, IP, schemi strani, credenziali, porte', () => {
  for (const u of ['http://localhost', 'localhost:3000', 'http://127.0.0.1', 'http://10.0.0.5', 'http://192.168.1.1', 'http://169.254.169.254/latest',
    'http://2130706433', 'http://0x7f000001', 'http://[::1]', 'http://[::ffff:127.0.0.1]/', 'http://intranet', 'http://nas.local', 'http://router.lan',
    'http://app.internal', 'http://8.8.8.8']) {
    assert.throws(() => parseTargetUrl(u), AuditError, u);
  }
  for (const u of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.it', 'data:text/html,x', 'mailto:a@b.it', '', 'http://utente:pw@esempio.it', 'https://esempio.it:8443', 'http://esempio.it:22', 'https://sito.123']) {
    assert.throws(() => parseTargetUrl(u), AuditError, u);
  }
});

test('Email', () => {
  assert.equal(parseEmail(' Ale@Esempio.IT '), 'ale@esempio.it');
  for (const e of ['', 'abc', 'a@b', 'a b@c.it', '<x>@y.it', 'a@b.c']) throwsCode(() => parseEmail(e), 'email_invalid');
});

test('HTML: SEO base', () => {
  const a = analyzeHtml(HOME_HTML);
  assert.equal(a.title, 'Idraulico Rossi Padova');
  assert.equal(a.h1Count, 2);
  assert.equal(a.imgTotal, 4);
  assert.equal(a.imgNoAlt, 2);          // alt="" è valido (decorativa)
  assert.equal(a.viewportOk, true);
  assert.equal(a.noindex, false);
  assert.equal(a.og.image, 'https://example.it/og.jpg');
  assert.equal(a.og.description, '');
  assert.equal(a.canonical, 'https://example.it/');
  assert.equal(a.hasIconLink, true);
  assert.equal(analyzeHtml('<meta name="robots" content="noindex, follow"><meta name="viewport" content="width=device-width, user-scalable=no">').noindex, true);
  assert.equal(analyzeHtml('<meta name="viewport" content="width=device-width, user-scalable=no">').zoomBlocked, true);
  // H1 dentro script/commenti non conta
  assert.equal(analyzeHtml('<!-- <h1>x</h1> --><script>"<h1>y</h1>"</script><h1>Vero</h1>').h1Count, 1);
});

test('HTML: cookie e contenuti misti', () => {
  assert.deepEqual(detectCookies('<script src="https://cdn.iubenda.com/cs.js"></script><script src="https://www.googletagmanager.com/gtm.js">'), { trackers: true, banner: true });
  assert.deepEqual(detectCookies('<script src="https://www.googletagmanager.com/gtm.js">'), { trackers: true, banner: false });
  assert.deepEqual(detectCookies('<p>Ciao</p>'), { trackers: false, banner: false });
  assert.equal(countMixedContent(HOME_HTML), 1);
  assert.equal(countMixedContent('<a href="http://x.it">link</a>'), 0);
});

test('robots.txt', () => {
  assert.equal(parseRobots('User-agent: *\nDisallow: /').blocksAll, true);
  assert.equal(parseRobots('User-agent: *\nDisallow: /wp-admin/\nSitemap: https://a.it/s.xml').blocksAll, false);
  assert.deepEqual(parseRobots('User-agent: *\nDisallow: /wp-admin/\nSitemap: https://a.it/s.xml').sitemaps, ['https://a.it/s.xml']);
  assert.equal(parseRobots('User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow:').blocksAll, false);
  assert.equal(parseRobots('User-agent: *\nDisallow: /\nAllow: /').blocksAll, false);
});

test('Certificato: scelta del più recente che copre l’host', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const list = [
    { not_before: '2026-01-01T00:00:00Z', not_after: '2026-04-01T00:00:00Z', dns_names: ['esempio.it', 'www.esempio.it'] },
    { not_before: '2026-09-01T00:00:00Z', not_after: '2026-10-11T00:00:00Z', dns_names: ['*.esempio.it'], issuer: { friendly_name: 'Let\'s Encrypt' } },
    { not_before: '2026-09-20T00:00:00Z', not_after: '2027-01-01T00:00:00Z', dns_names: ['altro.it'] },
  ];
  const c = pickCertificate(list, 'www.esempio.it', now);
  assert.equal(c.daysLeft, 10);
  assert.equal(pickCertificate(list, 'a.b.esempio.it', now), null);
  assert.equal(pickCertificate([], 'x.it', now), null);
});

test('PSI: riduzione', () => {
  const r = reducePsi(psiFixture(), 'mobile');
  assert.equal(r.scores.performance, 42);
  assert.equal(r.metrics.lcp, 4300);
  assert.equal(r.images.heavyCount, 2);
  assert.equal(r.images.heavy[0].name, 'hero-originale.jpg');
  assert.equal(r.images.wastedBytes, 1_200_000);
  assert.equal(r.mobile.targetSizeFails, 5);
  assert.equal(r.mobile.viewport, true);
  assert.ok(r.a11yFails.find((f) => f.id === 'color-contrast'));
  assert.ok(!r.a11yFails.find((f) => f.id === 'html-has-lang'));
  assert.ok(JSON.stringify(r).length < 4000);
});

test('Report: punteggi, etichette, ordine dei problemi', () => {
  assert.equal(wavg([{ w: 1, v: 100 }, { w: 1, v: null }]), 100);
  assert.equal(labelFor(80).text, 'Sito in buona forma');
  assert.equal(labelFor(79).text, 'Sito da rinforzare');
  assert.equal(labelFor(49).text, 'Sito da rifare');

  const site = {
    finalUrl: 'https://example.it/', host: 'example.it', https: true, httpToHttps: false, mixedContent: 1,
    seo: { ...analyzeHtml(HOME_HTML), noindexHeader: false, robotsTxt: false, robotsBlocksAll: false, sitemap: false },
    cookies: { trackers: true, banner: false },
  };
  const steps = {
    psiMobile: { ok: true, data: reducePsi(psiFixture(), 'mobile') },
    psiDesktop: { ok: true, data: reducePsi(psiFixture({ perf: 0.8, strategy: 'desktop' }), 'desktop') },
    site: { ok: true, data: site },
    ssl: { ok: true, data: { known: true, daysLeft: 9, notAfter: '2026-10-13T00:00:00Z' } },
  };
  const rep = buildReport({ steps, now: Date.parse('2026-10-04T10:00:00Z') });
  assert.equal(rep.areas.length, 4);
  assert.ok(rep.score > 0 && rep.score < 75, 'punteggio ' + rep.score);
  assert.ok(rep.areas.every((a) => a.score >= 0 && a.score <= 100));
  const sevOrder = { alta: 3, media: 2, bassa: 1 };
  for (let i = 1; i < rep.issues.length; i++) assert.ok(sevOrder[rep.issues[i - 1].severity] >= sevOrder[rep.issues[i].severity]);
  const ids = rep.issues.map((i) => i.id);
  for (const id of ['speed-mobile', 'lcp', 'cls', 'images', 'tap-targets', 'h1-many', 'img-alt', 'sitemap', 'robots', 'og', 'http-redirect', 'ssl-expiry', 'mixed', 'cookie', 'a11y-contrast', 'a11y-names', 'desc-length'.replace('-length', '-length')]) {
    if (id === 'desc-length') continue; // la descrizione c'è ed è nella norma
    assert.ok(ids.includes(id), 'manca ' + id);
  }
  assert.ok(rep.issues.every((i) => i.title && i.meaning && i.why && i.fix));
  assert.ok(rep.summary.length > 20);
});

test('Report: sito sano → buona forma, senza allarmismi', () => {
  const html = `<html lang="it"><head><title>Studio Bianchi – commercialista a Padova e provincia</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="Commercialista a Padova: contabilità, dichiarazioni e consulenza per partite IVA e piccole imprese. Primo incontro gratuito, risposte in 24 ore."><link rel="canonical" href="https://b.it/">
  <meta property="og:title" content="a"><meta property="og:description" content="b"><meta property="og:image" content="c"></head><body><h1>Studio Bianchi</h1><img src="a.jpg" alt="Studio"></body></html>`;
  const good = psiFixture({ perf: 0.95, a11y: 0.97, lcp: 1800, cls: 0.02, tbt: 100, ttfb: 300 });
  good.lighthouseResult.audits['target-size'] = { score: 1, scoreDisplayMode: 'binary' };
  good.lighthouseResult.audits['network-requests'] = { details: { items: [{ resourceType: 'Image', url: 'x.webp', transferSize: 40_000 }] } };
  good.lighthouseResult.audits['modern-image-formats'] = { details: { overallSavingsBytes: 0 } };
  for (const id of ['color-contrast', 'button-name']) good.lighthouseResult.audits[id] = { score: 1, scoreDisplayMode: 'binary' };
  const steps = {
    psiMobile: { ok: true, data: reducePsi(good, 'mobile') },
    psiDesktop: { ok: true, data: reducePsi({ ...good, lighthouseResult: { ...good.lighthouseResult, categories: { performance: { score: 0.99 } } } }, 'desktop') },
    site: { ok: true, data: { finalUrl: 'https://b.it/', host: 'b.it', https: true, httpToHttps: true, mixedContent: 0, seo: { ...analyzeHtml(html), robotsTxt: true, robotsBlocksAll: false, sitemap: true, noindexHeader: false }, cookies: { trackers: false, banner: false } } },
    ssl: { ok: true, data: { known: true, daysLeft: 70, notAfter: '2026-12-13T00:00:00Z' } },
  };
  const rep = buildReport({ steps });
  assert.ok(rep.score >= 90, 'punteggio ' + rep.score);
  assert.equal(rep.label.text, 'Sito in buona forma');
  assert.equal(rep.counts.alta, 0);
});

test('Token firmato e rate limit', async () => {
  const env = makeEnv();
  const t = await makeToken(env, { j: 'a', x: Date.now() + 1000 });
  assert.equal((await readToken(env, t)).j, 'a');
  await assert.rejects(readToken(env, t.slice(0, -2) + 'xx'), (e) => e.code === 'token_invalid');
  await assert.rejects(readToken(env, await makeToken(env, { j: 'a', x: Date.now() - 1 })), (e) => e.code === 'token_expired');

  for (let i = 0; i < 3; i++) await checkAndCountRateLimit(env, { ip: '1.2.3.4', domain: 'a' + i + '.it' });
  await assert.rejects(checkAndCountRateLimit(env, { ip: '1.2.3.4', domain: 'nuovo.it' }), (e) => e.code === 'rate_ip' && e.status === 429);
  // altro IP, stesso dominio: scatta il limite per dominio al quarto giro
  for (let i = 0; i < 3; i++) await checkAndCountRateLimit(env, { ip: '9.9.9.' + i, domain: 'stesso.it' });
  await assert.rejects(checkAndCountRateLimit(env, { ip: '5.5.5.5', domain: 'stesso.it' }), (e) => e.code === 'rate_domain');
});

/* ───── flusso completo con rete finta ───── */
function fakeFetch(calls) {
  return async (input, init = {}) => {
    const url = String(input);
    calls.push(url);
    const R = (body, status = 200, headers = {}) => new Response(body, { status, headers });
    if (url.startsWith('https://www.googleapis.com/pagespeedonline')) {
      const strat = new URL(url).searchParams.get('strategy');
      return R(JSON.stringify(psiFixture({ perf: strat === 'mobile' ? 0.42 : 0.8 })), 200, { 'content-type': 'application/json' });
    }
    if (url.startsWith('https://api.certspotter.com')) {
      return R(JSON.stringify([{ not_before: '2026-08-01T00:00:00Z', not_after: '2027-01-01T00:00:00Z', dns_names: ['example.it'] }]));
    }
    if (url === 'https://example.it/') return R(HOME_HTML, 200, { 'content-type': 'text/html' });
    if (url === 'https://example.it/robots.txt') return R('User-agent: *\nDisallow: /wp-admin/\nSitemap: https://example.it/sitemap_index.xml');
    if (url === 'https://example.it/sitemap_index.xml') return R('<?xml version="1.0"?><sitemapindex></sitemapindex>');
    if (url === 'http://example.it/') return R(null, 301, { location: 'https://example.it/' });
    if (url === 'https://down.it/') return R('Forbidden', 403, { server: 'cloudflare' });
    if (url.includes('lead.test')) return R(JSON.stringify({ ok: true }));
    return R('not found', 404);
  };
}

async function post(env, path, body, deps, origin = 'https://www.crearecreativita.it') {
  const req = new Request('https://api.test' + path, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': '7.7.7.7' }, body: JSON.stringify(body) });
  const res = await worker.fetch(req, env, {}, deps);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const good = { url: 'example.it', email: 'mario@rossi.it', consent: true, hp: '', elapsed: 8000 };

test('Flusso completo: start → step → finish → lead salvato', async () => {
  const calls = [];
  const saved = [];
  const base = fakeFetch(calls);
  const deps = { fetchImpl: async (u, i) => { if (String(u).includes('lead.test')) saved.push(JSON.parse(i.body)); return base(u, i); } };
  const env = makeEnv({ LEAD_WEBHOOK_URL: 'https://lead.test/exec', LEAD_WEBHOOK_SECRET: 's3' });

  const start = await post(env, '/api/start', good, deps);
  assert.equal(start.status, 200);
  assert.equal(start.headers.get('access-control-allow-origin'), 'https://www.crearecreativita.it');
  assert.equal(start.headers.get('x-robots-tag'), 'noindex, nofollow');

  const out = {};
  for (const step of ['psiMobile', 'psiDesktop', 'site', 'ssl']) {
    const r = await post(env, '/api/step', { token: start.body.token, step }, deps);
    assert.equal(r.status, 200, step);
    assert.equal(JSON.parse(r.body.payload).ok, true, step + ' ' + r.body.payload.slice(0, 200));
    out[step] = { payload: r.body.payload, sig: r.body.sig };
    if (step === 'psiMobile') assert.ok(r.body.screenshot.startsWith('data:image'));
  }
  const fin = await post(env, '/api/finish', { token: start.body.token, steps: out }, deps);
  assert.equal(fin.status, 200);
  assert.equal(fin.body.ok, true);
  assert.equal(fin.body.report.areas.length, 4);
  assert.ok(fin.body.report.score > 0);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].email, 'mario@rossi.it');
  assert.equal(saved[0].secret, 's3');
  assert.equal(saved[0].score, fin.body.report.score);

  // secondo finish con lo stesso token → rifiutato
  const again = await post(env, '/api/finish', { token: start.body.token, steps: out }, deps);
  assert.equal(again.status, 409);
});

test('Finish: payload manomesso o passo di un altro job → rifiutato', async () => {
  const deps = { fetchImpl: fakeFetch([]) };
  const env = makeEnv();
  const s1 = await post(env, '/api/start', good, deps);
  const step = await post(env, '/api/step', { token: s1.body.token, step: 'ssl' }, deps);
  const tampered = step.body.payload.replace('"ok":true', '"ok":true,"x":1');
  const r = await post(env, '/api/finish', { token: s1.body.token, steps: { ssl: { payload: tampered, sig: step.body.sig } } }, deps);
  assert.equal(r.body.error.code, 'step_invalid');

  const env2 = makeEnv();
  const a = await post(env2, '/api/start', { ...good, url: 'example.it' }, deps);
  const b = await post(env2, '/api/start', { ...good, url: 'example.it', email: 'altro@x.it' }, deps);
  const stepA = await post(env2, '/api/step', { token: a.body.token, step: 'ssl' }, deps);
  const cross = await post(env2, '/api/finish', { token: b.body.token, steps: { ssl: { payload: stepA.body.payload, sig: stepA.body.sig } } }, deps);
  assert.equal(cross.body.error.code, 'step_invalid');
});

test('Start: anti-bot, consenso, CORS, URL interni, rate limit', async () => {
  const deps = { fetchImpl: fakeFetch([]) };
  const env = makeEnv();
  assert.equal((await post(env, '/api/start', { ...good, hp: 'http://spam' }, deps)).body.error.code, 'bot');
  assert.equal((await post(env, '/api/start', { ...good, elapsed: 300 }, deps)).body.error.code, 'too_fast');
  assert.equal((await post(env, '/api/start', { ...good, consent: false }, deps)).body.error.code, 'consent_required');
  assert.equal((await post(env, '/api/start', { ...good, email: 'xx' }, deps)).body.error.code, 'email_invalid');
  assert.equal((await post(env, '/api/start', { ...good, url: 'http://localhost:8787' }, deps)).body.error.code, 'url_internal');
  assert.equal((await post(env, '/api/start', { ...good, url: 'http://169.254.169.254' }, deps)).body.error.code, 'url_internal');
  const bad = await post(env, '/api/start', good, deps, 'https://evil.example');
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  assert.equal((await post(env, '/api/start', good, deps, '')).status, 403);

  const env2 = makeEnv();
  for (let i = 0; i < 3; i++) assert.equal((await post(env2, '/api/start', { ...good, url: `s${i}.it` }, deps)).status, 200);
  const limited = await post(env2, '/api/start', { ...good, url: 'quarto.it' }, deps);
  assert.equal(limited.status, 429);
  assert.match(limited.body.error.message, /domani/);
});

test('Sito che blocca: errore chiaro e contatto salvato comunque', async () => {
  const saved = [];
  const base = fakeFetch([]);
  const deps = { fetchImpl: async (u, i) => { if (String(u).includes('lead.test')) saved.push(JSON.parse(i.body)); return base(u, i); } };
  const env = makeEnv({ LEAD_WEBHOOK_URL: 'https://lead.test/exec' });
  const s = await post(env, '/api/start', { ...good, url: 'down.it' }, deps);
  const site = await post(env, '/api/step', { token: s.body.token, step: 'site' }, deps);
  assert.equal(JSON.parse(site.body.payload).error.code, 'blocked');
  const fin = await post(env, '/api/finish', { token: s.body.token, steps: { site: { payload: site.body.payload, sig: site.body.sig } } }, deps);
  assert.equal(fin.body.ok, false);
  assert.equal(fin.body.error.code, 'blocked');
  assert.equal(saved.length, 1);
  assert.match(saved[0].outcome, /blocked/);
});

test('Lead non salvabile: finisce in KV, il report arriva lo stesso', async () => {
  const deps = { fetchImpl: async (u, i) => { if (String(u).includes('lead.test')) throw new Error('rete'); return fakeFetch([])(u, i); } };
  const env = makeEnv({ LEAD_WEBHOOK_URL: 'https://lead.test/exec' });
  const s = await post(env, '/api/start', good, deps);
  const steps = {};
  for (const step of ['psiMobile', 'site']) { const r = await post(env, '/api/step', { token: s.body.token, step }, deps); steps[step] = { payload: r.body.payload, sig: r.body.sig }; }
  const fin = await post(env, '/api/finish', { token: s.body.token, steps }, deps);
  assert.equal(fin.body.ok, true);
  assert.equal([...env.AUDIT_KV.m.keys()].filter((k) => k.startsWith('lead:')).length, 1);
});

test('Home non HTML (es. JSON) → errore chiaro', async () => {
  const { collectSite } = await import('../src/checks/site.js');
  const f = async () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(collectSite('https://api.esempio.it/', { fetchImpl: f }), (e) => e.code === 'not_html');
});

test('503 passeggero: al secondo tentativo il sito risponde → analisi ok', async () => {
  const { collectSite } = await import('../src/checks/site.js');
  let n = 0;
  const f = async (u) => {
    u = String(u);
    if (u === 'https://lento.it/') return ++n === 1 ? new Response('busy', { status: 503 }) : new Response(HOME_HTML, { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response('nope', { status: 404 });
  };
  const d = await collectSite('https://lento.it/', { fetchImpl: f, retryDelayMs: 1 });
  assert.equal(n, 2);
  assert.equal(d.seo.title, 'Idraulico Rossi Padova');
});

test('503 persistente: messaggio chiaro dopo due tentativi', async () => {
  const { collectSite } = await import('../src/checks/site.js');
  let n = 0;
  const f = async () => { n++; return new Response('busy', { status: 503 }); };
  await assert.rejects(collectSite('https://giu.it/', { fetchImpl: f, retryDelayMs: 1 }), (e) => e.code === 'server_error' && /momentaneamente/.test(e.message));
  assert.equal(n, 2);
});
