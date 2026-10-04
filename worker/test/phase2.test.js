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
