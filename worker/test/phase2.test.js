import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCss, finalizeCss, colorFamilies, googleFontFamilies, colorsInValue, isNeutral } from '../src/css.js';
import { copyrightYear, detectWordPress, styleSources } from '../src/html.js';
import { collectExtras, buildExtras, releasesBehind } from '../src/extras.js';
import { buildReport } from '../src/report.js';
import { reducePsi } from '../src/psi.js';
import { psiFixture, HOME_HTML } from './helpers.js';
import { analyzeHtml } from '../src/html.js';

test('CSS: colori in tutti i formati', () => {
  assert.deepEqual(colorsInValue('#FFF'), ['#ffffff']);
  assert.deepEqual(colorsInValue('1px solid rgb(249, 34, 115)'), ['#f92273']);
  assert.deepEqual(colorsInValue('rgba(0,0,0,0)'), []);
  assert.deepEqual(colorsInValue('#ff000000'), []);
  assert.deepEqual(colorsInValue('hsl(0 100% 50%)'), ['#ff0000']);
  assert.equal(isNeutral('#cccccc'), true);
  assert.equal(isNeutral('#ffffff'), true);
  assert.equal(isNeutral('#bff747'), false);
});

test('CSS: font e variabili usate/non usate', () => {
  const css = `
    /* commento font-family: Comic Sans */
    @font-face{font-family:"Be Vietnam Pro";src:url(a.woff2)}
    body{font-family:"Be Vietnam Pro",sans-serif;color:#1b1a1c}
    h1{font-family:'Playfair Display',serif}
    .sys{font-family:-apple-system,BlinkMacSystemFont,Roboto,sans-serif}
    .ico{font-family:"Font Awesome 5 Free"}
    .v{font-family:var(--x)}
    :root{--e-global-typography-primary-font-family:"Roboto Slab";--e-global-typography-text-font-family:"Lora";--e-global-color-primary:#7a2fb0;--e-global-color-accent:#3a9d23}
    .t{font-family:var(--e-global-typography-text-font-family);color:var(--e-global-color-accent)}
    .a{background:#bff747}.b{color:#BFF747}.c{border-color:#f92273}.d{fill:#f92273}.e{color:#f92273}
    .g{background:linear-gradient(90deg,#ff00aa,#00ffaa)}`;
  const { fonts, colors } = finalizeCss(analyzeCss(css));
  assert.deepEqual([...fonts.keys()].sort(), ['Be Vietnam Pro', 'Lora', 'Playfair Display']);
  assert.ok(!fonts.has('Roboto Slab'));           // variabile mai usata
  assert.ok(colors.has("#3a9d23"));                // variabile usata
  assert.ok(!colors.has("#7a2fb0"));               // variabile non usata
  const fam = colorFamilies(colors);
  assert.equal(fam.families, 2);                   // lime e rosa; il verde 3a9d23 è usato una volta sola
  assert.equal(fam.top[0].hex, '#f92273');
});

test('CSS: famiglie di tinta, anche a cavallo dello zero', () => {
  const m = new Map([['#ff0000', 3], ['#ff0040', 3], ['#ff2000', 3], ['#0000ff', 3], ['#00ff00', 3]]);
  assert.equal(colorFamilies(m).families, 3);
});

test('Google Fonts nell’URL', () => {
  assert.deepEqual(googleFontFamilies('https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;700&family=Lora&display=swap'), ['Be Vietnam Pro', 'Lora']);
  assert.deepEqual(googleFontFamilies('https://x.it/a.css'), []);
});

test('Anno nel footer', () => {
  assert.equal(copyrightYear('<footer>© 2019 Rossi s.r.l.</footer>'), 2019);
  assert.equal(copyrightYear('<footer>Copyright &copy; 2015 - 2023 <span>Rossi</span></footer>'), 2023);
  assert.equal(copyrightYear('<footer><p>Tutti i diritti riservati</p></footer>'), null);
  assert.equal(copyrightYear('<div>2019</div><footer>P.IVA 01234567890 © 2022</footer>'), 2022);
  assert.equal(copyrightYear('<body><p>niente</p></body>'), null);
});

test('WordPress: versione e tema', () => {
  const a = detectWordPress('<meta name="generator" content="WordPress 6.2.1" /><link href="/wp-content/themes/astra/style.css?ver=4.1.5"><link href="/wp-content/themes/astra-child/style.css?ver=1696239123">');
  assert.equal(a.version, '6.2.1');
  assert.equal(a.themes[0].slug, 'astra');
  assert.equal(a.themes[0].version, '4.1.5');
  assert.equal(a.themes[1].version, null);   // marca temporale, non una versione
  const b = detectWordPress('<link href="/wp-includes/css/dist/block-library/style.min.css?ver=6.4.3"><img src="/wp-content/uploads/a.jpg">');
  assert.equal(b.version, '6.4.3');
  assert.equal(detectWordPress('<p>niente</p>').detected, false);
  assert.equal(releasesBehind('6.2', '6.9'), 7);
  assert.equal(releasesBehind('6.9', '7.0'), 1);
});

test('Fonti di stile', () => {
  const s = styleSources('<style>a{color:red}</style><link rel="stylesheet" href="/a.css"><link rel="stylesheet" media="print" href="/p.css"><link rel="icon" href="/i.png">', 'https://x.it/');
  assert.equal(s.inline.length, 1);
  assert.deepEqual(s.links, ['https://x.it/a.css']);
});

/* rete finta per il passo "style" */
const SITE_HTML = `<html><head><title>x</title>
<meta name="generator" content="WordPress 6.2.1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora&display=swap">
<link rel="stylesheet" href="/wp-content/themes/astra/style.css?ver=4.1.5">
<link rel="stylesheet" href="http://127.0.0.1/evil.css">
<style>body{font-family:"Playfair Display",serif;color:#222}</style></head>
<body><footer>© 2019</footer></body></html>`;
const CSS = `a{color:#bff747}b{color:#bff747}c{color:#f92273}d{color:#f92273}e{color:#00aaff}f{color:#00aaff}g{color:#ffaa00}h{color:#ffaa00}i{color:#8800ff}j{color:#8800ff}k{color:#00ff88}l{color:#00ff88}p{font-family:Montserrat}q{font-family:Oswald}`;
function fakeFetch(calls) {
  return async (input) => {
    const url = String(input); calls.push(url);
    const R = (b, s = 200, h = {}) => new Response(b, { status: s, headers: h });
    if (url === 'https://tardo.it/') return R(SITE_HTML, 200, { 'content-type': 'text/html' });
    if (url === 'https://tardo.it/wp-content/themes/astra/style.css?ver=4.1.5') return R(CSS, 200, { 'content-type': 'text/css' });
    if (url === 'https://tardo.it/favicon.ico') return R('x', 404);
    if (url.startsWith('https://api.wordpress.org/core/version-check')) return R(JSON.stringify({ offers: [{ current: '7.1.2' }] }));
    if (url.includes('theme_information')) return R(JSON.stringify({ name: 'Astra', version: '4.8.0', last_updated: '2023-02-10' }));
    return R('nope', 404);
  };
}

test('Passo style: raccoglie font, colori, anno, WordPress (e non visita IP interni)', async () => {
  const calls = [];
  const x = await collectExtras({ finalUrl: 'https://tardo.it/', seo: { hasIconLink: false } }, { fetchImpl: fakeFetch(calls) });
  assert.ok(!calls.some((c) => c.includes('127.0.0.1')));
  assert.deepEqual(x.fonts.map((f) => f.name).sort(), ['Lora', 'Montserrat', 'Oswald', 'Playfair Display']);
  assert.equal(x.colors.families, 6);
  assert.equal(x.favicon.ok, false);
  assert.equal(x.year, 2019);
  assert.equal(x.wp.version, '6.2.1');
  assert.equal(x.wp.latest, '7.1.2');
  assert.equal(x.wp.themes[0].latest, '4.8.0');
  assert.ok(JSON.stringify(x).length < 3000);
});

test('Report fase 2: sezioni, problemi e ordine', () => {
  const now = Date.parse('2026-10-04T10:00:00Z');
  const x = {
    fonts: [{ name: 'Lora', n: 3 }, { name: 'Montserrat', n: 2 }, { name: 'Oswald', n: 2 }, { name: 'Playfair Display', n: 1 }],
    googleFonts: ['Lora'], colors: { distinct: 40, families: 6, top: [{ hex: '#bff747', n: 4 }] }, cssFiles: 3,
    favicon: { ok: false }, year: 2019,
    wp: { detected: true, version: '6.2.1', latest: '7.1.2', themes: [{ slug: 'astra', version: '4.1.5', latest: '4.8.0', lastUpdated: '2023-02-10', name: 'Astra', org: true }] },
  };
  const site = { finalUrl: 'https://tardo.it/', host: 'tardo.it', https: true, httpToHttps: true, mixedContent: 0, seo: { ...analyzeHtml(HOME_HTML), robotsTxt: true, sitemap: true }, cookies: { trackers: false, banner: false } };
  const extras = buildExtras(x, site, now);
  const rep = buildReport({
    steps: { psiMobile: { ok: true, data: reducePsi(psiFixture(), 'mobile') }, site: { ok: true, data: site } },
    now, extras,
  });
  const ids = rep.issues.map((i) => i.id);
  for (const id of ['fonts', 'palette', 'favicon', 'copyright', 'wp-version', 'theme-stale']) assert.ok(ids.includes(id), 'manca ' + id);
  assert.equal(rep.issues.find((i) => i.id === 'wp-version').severity, 'alta');
  assert.equal(rep.issues.find((i) => i.id === 'copyright').severity, 'media');
  assert.deepEqual(rep.sections.map((s) => s.id), ['identity', 'care']);
  assert.equal(rep.sections[0].rows.find((r) => r.label === 'Coerenza generale').value, 'Dispersiva');
  assert.equal(rep.areas.length, 4);                  // le sezioni extra non cambiano il voto
});

test('Sito pulito: nessun problema di identità o abbandono', () => {
  const x = { fonts: [{ name: 'Be Vietnam Pro', n: 9 }], googleFonts: [], colors: { distinct: 9, families: 2, top: [] }, cssFiles: 2, favicon: { ok: true }, year: 2026, wp: { detected: true, version: '7.1.2', latest: '7.1.2', themes: [{ slug: 'x', version: null }] } };
  const [id, care] = buildExtras(x, {}, Date.parse('2026-10-04T10:00:00Z'));
  assert.equal(id.issues.length + care.issues.length, 0);
  assert.equal(id.section.rows.find((r) => r.label === 'Coerenza generale').value, 'Coerente');
});

test('CSS: colori predefiniti di plugin/WordPress non gonfiano la palette', () => {
  const css = `.btn{background:#d9534f}.btn2{background:#d9534f}.ok{color:#f92273}.ok2{color:#f92273}
    .has-vivid-red-color{color:var(--wp--preset--color--vivid-red)!important}:root{--wp--preset--color--vivid-red:#cf2e2e}
    .wp-block-button__link{background-color:#12ab34}.wp-block-button__link:hover{background-color:#12ab34}`;
  const { colors } = finalizeCss(analyzeCss(css));
  assert.deepEqual([...colors.keys()], ['#f92273']);
});

import { parseFeedLatest } from '../src/extras.js';
import { parseHttpDate } from '../src/checks/site.js';
import { feedLinks } from '../src/html.js';

test('Feed: data dell’articolo più recente (RSS e Atom), lastBuildDate ignorata', () => {
  const rss = `<rss><channel><lastBuildDate>Mon, 05 Oct 2026 10:00:00 +0000</lastBuildDate>
    <item><title>a</title><pubDate>Tue, 12 Mar 2024 09:00:00 +0000</pubDate></item>
    <item><title>b</title><pubDate>Mon, 01 Jan 2024 09:00:00 +0000</pubDate></item></channel></rss>`;
  assert.equal(parseFeedLatest(rss, Date.parse('2026-10-05')), '2024-03-12T09:00:00.000Z');
  const atom = `<feed><updated>2026-10-01T00:00:00Z</updated><entry><published>2022-05-02T08:00:00Z</published></entry></feed>`;
  assert.equal(parseFeedLatest(atom), '2022-05-02T08:00:00.000Z');
  assert.equal(parseFeedLatest('<rss><channel><title>vuoto</title></channel></rss>'), null);
  assert.equal(parseFeedLatest('<html>non è un feed</html>'), null);
  assert.equal(parseFeedLatest('<rss><channel><item><pubDate>Mon, 01 Jan 2040 09:00:00 +0000</pubDate></item></channel></rss>', Date.parse('2026-10-05')), null); // data nel futuro
});

test('Last-Modified e link ai feed', () => {
  const now = Date.parse('2026-10-05');
  assert.equal(parseHttpDate('Wed, 21 Oct 2020 07:28:00 GMT', now), '2020-10-21T07:28:00.000Z');
  assert.equal(parseHttpDate(null, now), null);
  assert.equal(parseHttpDate('boh', now), null);
  assert.equal(parseHttpDate('Wed, 21 Oct 2040 07:28:00 GMT', now), null);
  const links = feedLinks('<link rel="alternate" type="application/rss+xml" href="/comments/feed/"><link rel="alternate" type="application/rss+xml" href="/feed/"><link rel="alternate" type="application/json" href="/x.json">', 'https://a.it/');
  assert.deepEqual(links, ['https://a.it/feed/', 'https://a.it/comments/feed/']);
});

test('Passo style: ultimo articolo dal feed, ultima modifica dal server', async () => {
  const f = async (input) => {
    const url = String(input);
    const R = (b, s = 200, h = {}) => new Response(b, { status: s, headers: h });
    if (url === 'https://blog.it/') return R('<html><head><link rel="alternate" type="application/rss+xml" href="/feed/"></head><body><footer>© 2026</footer></body></html>', 200, { 'content-type': 'text/html' });
    if (url === 'https://blog.it/feed/') return R('<rss><channel><item><pubDate>Fri, 10 Mar 2023 09:00:00 +0000</pubDate></item></channel></rss>');
    return R('nope', 404);
  };
  const x = await collectExtras({ finalUrl: 'https://blog.it/', seo: { hasIconLink: true }, lastModified: '2022-01-10T00:00:00.000Z' }, { fetchImpl: f });
  assert.equal(x.lastPost.date, '2023-03-10T09:00:00.000Z');
  assert.equal(x.lastPost.source, 'feed');
  assert.equal(x.lastModified, '2022-01-10T00:00:00.000Z');
});

test('Report: ultimo articolo e ultima modifica (soglie 12 e 24 mesi)', () => {
  const now = Date.parse('2026-10-05T10:00:00Z');
  const base = { fonts: [], colors: { distinct: 0, families: 0, top: [] }, cssFiles: 0, favicon: { ok: true }, year: 2026, wp: { detected: false } };
  const run = (x) => buildExtras({ ...base, ...x }, {}, now)[1];
  const stale = run({ lastPost: { date: '2023-03-10T09:00:00.000Z' }, lastModified: '2022-01-10T00:00:00.000Z' });
  const post = stale.issues.find((i) => i.id === 'last-post');
  assert.equal(post.severity, 'media');
  assert.match(post.title, /marzo 2023/);
  assert.match(post.meaning, /3 anni/);
  assert.equal(stale.issues.find((i) => i.id === 'last-modified').severity, 'bassa');
  assert.ok(stale.section.rows.some((r) => r.label === 'Ultimo articolo pubblicato' && r.status === 'bad'));

  const mid = run({ lastPost: { date: '2025-06-01T00:00:00.000Z' } });
  assert.equal(mid.issues.find((i) => i.id === 'last-post').severity, 'bassa');
  const fresh = run({ lastPost: { date: '2026-08-01T00:00:00.000Z' }, lastModified: '2026-09-01T00:00:00.000Z' });
  assert.equal(fresh.issues.length, 0);
  assert.ok(fresh.passed.includes('Blog aggiornato di recente'));
  // nessun dato: nessuna riga, nessun problema
  const none = run({ lastPost: { date: null }, lastModified: null });
  assert.ok(!none.section || !none.section.rows.some((r) => /articolo|modifica/.test(r.label)));
});

import { parsePhpVersion } from '../src/checks/site.js';
import { phpSupportEnd } from '../src/extras.js';

test('PHP: lettura della versione e fine supporto', () => {
  assert.equal(parsePhpVersion('PHP/8.3.31, PleskLin'), '8.3.31');
  assert.equal(parsePhpVersion('PHP/7.4.33'), '7.4.33');
  assert.equal(parsePhpVersion('Express'), null);
  assert.equal(parsePhpVersion(null), null);
  assert.equal(phpSupportEnd('8.1.2'), '2025-12-31');
  assert.equal(phpSupportEnd('8.3.31'), '2027-12-31');
  assert.ok(phpSupportEnd('7.4.33') < '2023-01-01');
  assert.equal(phpSupportEnd('9.9.0'), null); // ramo che non conosco: nessun giudizio
});

test('Report: PHP', () => {
  const now = Date.parse('2026-10-05T10:00:00Z');
  const base = { fonts: [], colors: { distinct: 0, families: 0, top: [] }, cssFiles: 0, favicon: { ok: true }, year: 2026 };
  const run = (x) => buildExtras({ ...base, ...x }, {}, now)[1];

  const old = run({ php: '7.4.33', wp: { detected: true, version: '7.1.2', latest: '7.1.2', themes: [] } });
  assert.equal(old.issues.find((i) => i.id === 'php-version').severity, 'media');   // mai alta: alcuni hosting danno supporto esteso
  assert.match(old.issues.find((i) => i.id === 'php-version').title, /fuori dal supporto/);
  assert.match(old.issues.find((i) => i.id === 'php-version').why, /supporto esteso/);
  const soon = run({ php: '8.2.10', wp: { detected: false } });
  assert.equal(soon.issues.find((i) => i.id === 'php-version').severity, 'bassa');
  assert.match(soon.issues.find((i) => i.id === 'php-version').title, /dicembre 2026/);
  const fine = run({ php: '8.3.31', wp: { detected: false } });
  assert.equal(fine.issues.length, 0);
  assert.ok(fine.passed.includes('Versione di PHP supportata'));
  const eol1 = run({ php: '8.1.5', wp: { detected: false } });
  assert.equal(eol1.issues.find((i) => i.id === 'php-version').severity, 'media');   // scaduta da meno di un anno
});

test('PHP: se la home (cache) non la dichiara, la versione si legge dal feed o dall’API REST', async () => {
  const mk = (feedHeaders, restHeaders) => async (input) => {
    const url = String(input);
    const R = (b, s = 200, h = {}) => new Response(b, { status: s, headers: h });
    if (url === 'https://cache.it/') return R('<html><head><link rel="alternate" type="application/rss+xml" href="/feed/"></head><body>/wp-content/x.png</body></html>', 200, { 'content-type': 'text/html', 'x-powered-by': 'PleskLin' });
    if (url === 'https://cache.it/feed/') return R('<rss><channel><item><pubDate>Fri, 10 Mar 2023 09:00:00 +0000</pubDate></item></channel></rss>', 200, feedHeaders);
    if (url === 'https://cache.it/wp-json/') return R('{}', 200, restHeaders);
    return R('nope', 404);
  };
  const site = { finalUrl: 'https://cache.it/', seo: { hasIconLink: true }, php: null };
  const dalFeed = await collectExtras(site, { fetchImpl: mk({ 'x-powered-by': 'PHP/8.3.31' }, {}) });
  assert.equal(dalFeed.php, '8.3.31');
  const dalRest = await collectExtras(site, { fetchImpl: mk({}, { 'x-powered-by': 'PHP/8.2.20' }) });
  assert.equal(dalRest.php, '8.2.20');
  const nessuna = await collectExtras(site, { fetchImpl: mk({}, {}) });
  assert.equal(nessuna.php, null);
  const dichiarata = await collectExtras({ ...site, php: '8.4.1' }, { fetchImpl: mk({ 'x-powered-by': 'PHP/7.4.0' }, {}) });
  assert.equal(dichiarata.php, '8.4.1');   // quella della home ha la precedenza
});

import { detectLegacyTech, detectPlatform } from '../src/html.js';

test('Tecnologie datate: jQuery, Bootstrap, tag obsoleti, Flash', () => {
  const vecchio = detectLegacyTech(`<script src="https://code.jquery.com/jquery-1.12.4.min.js"></script>
    <script src="/js/jquery-migrate-3.4.1.min.js"></script><script src="/js/jquery-ui-1.12.1.min.js"></script>
    <link href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.min.css">
    <body><center><font color="red">Benvenuti</font></center><embed src="intro.swf"></body>`);
  assert.equal(vecchio.jquery, '1.12.4');          // migrate e ui non contano
  assert.equal(vecchio.bootstrap, '3.3.7');
  assert.equal(vecchio.obsoleteTags, 2);
  assert.equal(vecchio.flash, true);
  const wp = detectLegacyTech('<script src="/wp-includes/js/jquery/jquery.min.js?ver=3.7.1"></script><script src="/wp-includes/js/jquery/jquery-migrate.min.js?ver=3.4.1"></script><link href="/css/bootstrap.min.css?ver=5.3.2">');
  assert.equal(wp.jquery, '3.7.1');
  assert.equal(wp.bootstrap, '5.3.2');
  const piu = detectLegacyTech('<script src="a/jquery-3.6.0.min.js"></script><script src="b/jquery-1.8.3.js"></script>');
  assert.equal(piu.jquery, '3.6.0');                // si prende la più alta: meno falsi allarmi
  assert.deepEqual(detectLegacyTech('<p>niente</p>'), { jquery: null, bootstrap: null, obsoleteTags: 0, flash: false });
});

test('Piattaforma', () => {
  const H = (o = {}) => ({ get: (n) => o[n.toLowerCase()] || null });
  assert.equal(detectPlatform('<img src="https://static.wixstatic.com/a.jpg">', H()), 'Wix');
  assert.equal(detectPlatform('<link href="https://cdn.shopify.com/s/x.css">', H()), 'Shopify');
  assert.equal(detectPlatform('<meta name="generator" content="Joomla! - Open Source Content Management">', H()), 'Joomla');
  assert.equal(detectPlatform('<meta name="generator" content="WordPress 6.8"><meta name="generator" content="Elementor 3.30">', H()), 'WordPress (Elementor)');
  assert.equal(detectPlatform('<link href="/wp-content/themes/x/style.css">', H()), 'WordPress');
  assert.equal(detectPlatform('<p>sito scritto a mano</p>', H()), '');
  assert.equal(detectPlatform('<p>x</p>', H({ 'x-wix-request-id': 'abc' })), 'Wix');
});

test('Report: tecnologie datate (gravità e voci)', () => {
  const now = Date.parse('2026-10-05T10:00:00Z');
  const base = { fonts: [], colors: { distinct: 0, families: 0, top: [] }, cssFiles: 0, favicon: { ok: true }, year: 2026, wp: { detected: false } };
  const run = (legacy) => buildExtras({ ...base, legacy }, {}, now)[1];
  const old = run({ jquery: '1.12.4', bootstrap: '3.3.7', obsoleteTags: 3, flash: true });
  const sev = (id) => old.issues.find((i) => i.id === id).severity;
  assert.equal(sev('jquery'), 'media'); assert.equal(sev('bootstrap'), 'media'); assert.equal(sev('obsolete-html'), 'bassa'); assert.equal(sev('flash'), 'alta');
  assert.match(old.issues.find((i) => i.id === 'bootstrap').meaning, /luglio 2019/);
  assert.equal(run({ jquery: '3.4.1', bootstrap: '4.6.0', obsoleteTags: 0, flash: false }).issues.map((i) => i.severity).join(), 'bassa,bassa');
  const ok = run({ jquery: '3.7.1', bootstrap: '5.3.2', obsoleteTags: 0, flash: false });
  assert.equal(ok.issues.length, 0);
  assert.ok(ok.passed.includes('Librerie di base aggiornate'));
  assert.ok(ok.section.rows.some((r) => r.label === 'Libreria jQuery' && r.value === '3.7.1' && r.status === 'ok'));
  const nulla = run({ jquery: null, bootstrap: null, obsoleteTags: 0, flash: false });
  assert.equal(nulla.issues.length, 0);
  assert.ok(!nulla.passed.includes('Librerie di base aggiornate'));
});

import { analyzeHeadings } from '../src/html.js';
import { cleanHtml } from '../src/html.js';

test('Struttura dei titoli: conteggi, salti di livello, vuoti, solo contenuto principale', () => {
  const page = `<header><h4>Menu</h4><h5>Chiamaci</h5></header>
    <main><h1>Idraulico a Padova</h1><h2>Servizi</h2><h3>Caldaie</h3><h3>Perdite</h3><h2>Contatti</h2><h4>Orari</h4><h2></h2><h3><span> </span></h3></main>
    <footer><h6>Note</h6></footer>`;
  const h = analyzeHeadings(cleanHtml(page));
  assert.deepEqual(h.counts, { 1: 1, 2: 2, 3: 2, 4: 1, 5: 0, 6: 0 });   // header e footer esclusi
  assert.equal(h.skips, 1);
  assert.equal(h.firstSkip, 'H2 → H4');
  assert.equal(h.empty, 2);
  // senza <main>: si tolgono header, footer, nav e aside
  const h2 = analyzeHeadings(cleanHtml('<nav><h5>x</h5></nav><h1>Titolo</h1><aside><h4>y</h4></aside><h2>A</h2>'));
  assert.deepEqual(h2.counts, { 1: 1, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0 });
  assert.equal(h2.skips, 0);
  // titolo con sola immagine con alt vale come pieno
  assert.equal(analyzeHeadings(cleanHtml('<main><h1><img src="a.png" alt="Logo Rossi"></h1></main>')).total, 1);
});

test('Report: titoli (H2 mancanti, salti, vuoti) e riga contrasto in Identità visiva', () => {
  const mk = (headings) => ({ finalUrl: 'https://a.it/', host: 'a.it', https: true, httpToHttps: true, mixedContent: 0, cookies: { trackers: false, banner: false },
    seo: { ...analyzeHtml(HOME_HTML), robotsTxt: true, sitemap: true, headings } });
  const run = (headings) => buildReport({ steps: { psiMobile: { ok: true, data: reducePsi(psiFixture(), 'mobile') }, site: { ok: true, data: mk(headings) } } });
  const flat = run({ counts: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, total: 1, empty: 0, skips: 0, firstSkip: '', textLength: 3000 });
  assert.ok(flat.issues.find((i) => i.id === 'h2-missing'));
  const short = run({ counts: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }, total: 1, empty: 0, skips: 0, firstSkip: '', textLength: 400 });
  assert.ok(!short.issues.find((i) => i.id === 'h2-missing'));          // pagina corta: nessun giudizio
  const skip = run({ counts: { 1: 1, 2: 2, 3: 0, 4: 1, 5: 0, 6: 0 }, total: 4, empty: 1, skips: 1, firstSkip: 'H2 → H4', textLength: 3000 });
  assert.match(skip.issues.find((i) => i.id === 'heading-skip').title, /H2 → H4/);
  assert.ok(skip.issues.find((i) => i.id === 'heading-empty'));
  const good = run({ counts: { 1: 1, 2: 3, 3: 2, 4: 0, 5: 0, 6: 0 }, total: 6, empty: 0, skips: 0, firstSkip: '', textLength: 3000 });
  assert.ok(good.passed.includes('Titoli ben organizzati'));
  assert.ok(!good.issues.some((i) => /^h2-|^heading-/.test(i.id)));
  assert.equal(good.areas.find((a) => a.id === 'seo').rows.find((r) => r.label === 'Struttura dei titoli').value, '1 H1, 3 H2, 2 H3');
  // il controllo di Google sull'ordine dei titoli non finisce più tra "altri controlli di accessibilità" (c'è la voce dedicata)
  const psi = reducePsi(psiFixture({ a11y: 0.86 }), 'mobile');
  psi.a11yFails = [{ id: 'heading-order', n: 2, w: 3 }, { id: 'empty-heading', n: 1, w: 2 }];
  const ctrl = buildReport({ steps: { psiMobile: { ok: true, data: psi }, site: { ok: true, data: mk({ counts: { 1: 1, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0 }, total: 2, empty: 0, skips: 0, firstSkip: '', textLength: 2000 }) } } });
  assert.ok(!ctrl.issues.some((i) => i.id === 'a11y-other'));
  // …mentre un altro controllo fallito continua a comparire
  psi.a11yFails.push({ id: 'aria-hidden-focus', n: 1, w: 7 });
  const ctrl2 = buildReport({ steps: { psiMobile: { ok: true, data: psi }, site: { ok: true, data: mk({ counts: { 1: 1, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0 }, total: 2, empty: 0, skips: 0, firstSkip: '', textLength: 2000 }) } } });
  assert.ok(ctrl2.issues.some((i) => i.id === 'a11y-other'));

  // Identità visiva: contrasto dal dato di Google
  const x = { fonts: [], colors: { distinct: 0, families: 0, top: [] }, cssFiles: 0, favicon: { ok: true }, year: 2026, wp: { detected: false } };
  const withFail = buildExtras(x, {}, Date.now(), { scores: { accessibility: 80 }, a11yFails: [{ id: 'color-contrast', n: 3, w: 7 }] })[0];
  assert.ok(withFail.section.rows.some((r) => r.label === 'Contrasto dei testi' && /3 punti/.test(r.value) && r.status === 'warn'));
  const okc = buildExtras(x, {}, Date.now(), { scores: { accessibility: 97 }, a11yFails: [] })[0];
  assert.ok(okc.section.rows.some((r) => r.label === 'Contrasto dei testi' && r.value === 'Buono'));
  const none = buildExtras(x, {}, Date.now(), null)[0];
  assert.ok(!none.section.rows.some((r) => r.label === 'Contrasto dei testi'));   // senza dati di Google: nessuna riga
  assert.equal(withFail.issues.length, 0);                                       // nessun secondo problema
});
