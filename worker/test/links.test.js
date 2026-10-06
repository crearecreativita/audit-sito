import test from 'node:test';
import assert from 'node:assert/strict';
import { pickInternalLinks, checkLinks } from '../src/checks/links.js';
import { buildReport } from '../src/report.js';
import { reducePsi } from '../src/psi.js';
import { analyzeHtml } from '../src/html.js';
import worker from '../src/index.js';
import { makeEnv, psiFixture, HOME_HTML } from './helpers.js';

const HOME = `<html><body><nav>
  <a href="/chi-siamo/">Chi siamo</a><a href="https://www.esempio.it/servizi/#top">Servizi</a><a href="/servizi/">doppione</a>
  <a href="https://altro-sito.it/x">esterno</a><a href="https://facebook.com/esempio">fb</a><a href="mailto:a@b.it">mail</a><a href="tel:+39000">tel</a><a href="#in-alto">ancora</a>
  <a href="/">home</a><a href="/wp-admin/">admin</a><a href="/foto.jpg">foto</a><a href="/carrello/">carrello</a><a href="/contatti">Contatti</a>
  <a href="javascript:void(0)">js</a><a href="/feed/">feed</a><a href="/blog/?p=3">articolo</a>
  </nav><script>var l='<a href="/nascosto/">x</a>'</script></body></html>`;

test('Link interni: solo dello stesso sito, senza doppioni, file, aree riservate e ancore', () => {
  assert.deepEqual(pickInternalLinks(HOME, 'https://www.esempio.it/', 12), [
    'https://www.esempio.it/chi-siamo/', 'https://www.esempio.it/servizi/', 'https://www.esempio.it/contatti', 'https://www.esempio.it/blog/?p=3',
  ]);
  assert.equal(pickInternalLinks(HOME, 'https://www.esempio.it/', 2).length, 2);   // limite
  assert.deepEqual(pickInternalLinks('<a href="/a">a</a>', 'https://esempio.it/'), ['https://esempio.it/a']);   // www e non-www sono lo stesso sito
});

const fake = (map, calls = []) => async (input, init = {}) => {
  const url = String(input); const key = `${init.method || 'GET'} ${url}`; calls.push(key);
  const r = map[key] ?? map[url];
  if (r instanceof Error) throw r;
  if (!r) return new Response('ok', { status: 200 });
  if (r.status) return new Response(null, { status: r.status, headers: r.headers || {} });
  return new Response('ok');
};

test('Controllo link: 404/410/500 sono rotti; 403, 429, 503 e timeout no; HEAD non supportato → GET; redirect verso un 404', async () => {
  const calls = [];
  const f = fake({
    'HEAD https://s.it/ok': { status: 200 },
    'HEAD https://s.it/manca': { status: 404 },
    'HEAD https://s.it/via': { status: 410 },
    'HEAD https://s.it/errore': { status: 500 },
    'HEAD https://s.it/protetto': { status: 403 },
    'HEAD https://s.it/troppe': { status: 429 },
    'HEAD https://s.it/occupato': { status: 503 },
    'HEAD https://s.it/nohead': { status: 405 }, 'GET https://s.it/nohead': { status: 200 },
    'HEAD https://s.it/rimanda': { status: 301, headers: { location: 'https://s.it/finito' } }, 'HEAD https://s.it/finito': { status: 404 },
    'HEAD https://s.it/lento': new Error('timeout'), 'GET https://s.it/lento': new Error('timeout'),
  }, calls);
  const r = await checkLinks(['ok', 'manca', 'via', 'errore', 'protetto', 'troppe', 'occupato', 'nohead', 'rimanda', 'lento'].map((x) => 'https://s.it/' + x), { fetchImpl: f, concurrency: 3 });
  assert.deepEqual(r.broken.map((b) => b.url.split('/').pop()).sort(), ['errore', 'manca', 'rimanda', 'via']);
  assert.equal(r.unchecked, 1);               // il link lento non conta
  assert.equal(r.checked, 9);
  assert.ok(calls.includes('GET https://s.it/nohead'));
  // indirizzi non ammessi non vengono mai visitati
  const c2 = [];
  const r2 = await checkLinks(['http://127.0.0.1/x', 'http://localhost/y', 'https://s.it/ok'], { fetchImpl: fake({}, c2) });
  assert.equal(r2.checked, 1);
  assert.ok(!c2.some((c) => /127\.0\.0\.1|localhost/.test(c)));
});

test('Report: link rotti nell’area SEO (gravità, riga, voce a posto)', () => {
  const site = { finalUrl: 'https://a.it/', host: 'a.it', https: true, httpToHttps: true, mixedContent: 0, cookies: { trackers: false, banner: false }, seo: { ...analyzeHtml(HOME_HTML), robotsTxt: true, sitemap: true } };
  const run = (links) => buildReport({ steps: { psiMobile: { ok: true, data: reducePsi(psiFixture(), 'mobile') }, site: { ok: true, data: site }, ...(links ? { links: { ok: true, data: links } } : {}) } });
  const one = run({ checked: 12, unchecked: 0, broken: [{ url: 'https://a.it/servizi-vecchi/', status: 404 }] });
  assert.equal(one.issues.find((i) => i.id === 'links-broken').severity, 'bassa');
  assert.match(one.issues.find((i) => i.id === 'links-broken').title, /Un link della home/);
  assert.match(one.issues.find((i) => i.id === 'links-broken').meaning, /\/servizi-vecchi\/ \(404\)/);
  const three = run({ checked: 12, unchecked: 0, broken: [1, 2, 3].map((n) => ({ url: `https://a.it/p${n}/`, status: 404 })) });
  assert.equal(three.issues.find((i) => i.id === 'links-broken').severity, 'media');
  const good = run({ checked: 12, unchecked: 1, broken: [] });
  assert.ok(good.passed.includes('Link interni funzionanti'));
  assert.ok(good.areas.find((a) => a.id === 'seo').rows.some((r) => r.label === 'Link interni funzionanti' && r.value === '12 su 12'));
  const none = run(null);                                    // passo non riuscito: nessuna riga, nessun problema
  assert.ok(!none.issues.some((i) => i.id === 'links-broken'));
  assert.ok(!none.areas.find((a) => a.id === 'seo').rows.some((r) => /Link interni/.test(r.label)));
  const zero = run({ checked: 0, unchecked: 5, broken: [] });  // nessun link verificabile: nessun giudizio
  assert.ok(!zero.areas.find((a) => a.id === 'seo').rows.some((r) => /Link interni/.test(r.label)));
});

test('Passo "links": solo con l’elenco firmato dal passo "style"', async () => {
  const calls = [];
  const deps = { fetchImpl: async (u, i = {}) => { calls.push(`${i.method || 'GET'} ${u}`); const url = String(u);
    if (url === 'https://example.it/') return new Response('<html><body><a href="/a/">A</a><a href="/rotta/">R</a><link rel="icon" href="/i.png"></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    if (url === 'https://example.it/rotta/') return new Response(null, { status: 404 });
    return new Response('x', { status: i.method === 'HEAD' ? 200 : 404 }); } };
  const env = makeEnv();
  const call = async (path, body) => (await worker.fetch(new Request('https://api.test' + path, { method: 'POST', headers: { origin: 'https://www.crearecreativita.it', 'content-type': 'application/json', 'cf-connecting-ip': '5.6.7.8' }, body: JSON.stringify(body) }), env, {}, deps)).json();
  const s = await call('/api/start', { url: 'example.it', email: 'a@b.it', consent: true, hp: '', elapsed: 9000 });
  const site = await call('/api/step', { token: s.token, step: 'site' });
  const style = await call('/api/step', { token: s.token, step: 'style', site: { payload: site.payload, sig: site.sig } });
  assert.deepEqual(JSON.parse(style.payload).data.links, ['https://example.it/a/', 'https://example.it/rotta/']);
  const links = await call('/api/step', { token: s.token, step: 'links', style: { payload: style.payload, sig: style.sig } });
  const data = JSON.parse(links.payload).data;
  assert.equal(data.checked, 2);
  assert.deepEqual(data.broken.map((b) => b.url), ['https://example.it/rotta/']);
  // un elenco inventato dal browser viene rifiutato
  const falso = JSON.stringify({ ok: true, data: { links: ['https://example.it/segreto'] } });
  const bad = await call('/api/step', { token: s.token, step: 'links', style: { payload: falso, sig: style.sig } });
  assert.equal(JSON.parse(bad.payload).error.code, 'step_invalid');
  assert.ok(!calls.some((c) => c.includes('/segreto')));
  const mancante = await call('/api/step', { token: s.token, step: 'links' });
  assert.equal(JSON.parse(mancante.payload).error.code, 'step_invalid');
});
