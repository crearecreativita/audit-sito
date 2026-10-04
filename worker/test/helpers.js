// Utilità condivise dai test: KV finto, fixture PageSpeed, fetch finto.
export class MemoryKV {
  constructor() { this.m = new Map(); }
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, String(v)); }
}

export function makeEnv(extra = {}) {
  return {
    ALLOWED_ORIGINS: 'https://www.crearecreativita.it,https://audit.crearecreativita.it',
    SIGNING_SECRET: 'test-secret-test-secret-1234',
    RATE_LIMIT_PER_DAY: '3',
    GLOBAL_DAILY_LIMIT: '50',
    AUDIT_KV: new MemoryKV(),
    ...extra,
  };
}

/** JSON di PageSpeed realistico (solo i campi che leggiamo). */
export function psiFixture({ perf = 0.42, a11y = 0.86, lcp = 4300, cls = 0.31, tbt = 450, ttfb = 900, strategy = 'mobile' } = {}) {
  const imgs = [
    { url: 'https://example.it/wp-content/uploads/hero-originale.jpg', resourceType: 'Image', transferSize: 1_800_000 },
    { url: 'https://example.it/wp-content/uploads/team.png', resourceType: 'Image', transferSize: 420_000 },
    { url: 'https://example.it/logo.svg', resourceType: 'Image', transferSize: 8_000 },
    { url: 'https://example.it/app.js', resourceType: 'Script', transferSize: 300_000 },
  ];
  const audits = {
    'first-contentful-paint': { numericValue: 2100 },
    'largest-contentful-paint': { numericValue: lcp },
    'cumulative-layout-shift': { numericValue: cls },
    'total-blocking-time': { numericValue: tbt },
    'speed-index': { numericValue: 4000 },
    'server-response-time': { numericValue: ttfb },
    'total-byte-weight': { numericValue: 4_200_000 },
    'network-requests': { details: { items: imgs } },
    'modern-image-formats': { details: { overallSavingsBytes: 1_200_000 } },
    viewport: { score: 1, scoreDisplayMode: 'binary' },
    'meta-viewport': { score: 1, scoreDisplayMode: 'binary' },
    'target-size': { score: 0, scoreDisplayMode: 'binary', details: { items: [{}, {}, {}, {}, {}] } },
    'color-contrast': { score: 0, scoreDisplayMode: 'binary', details: { items: [{}, {}, {}] } },
    'button-name': { score: 0, scoreDisplayMode: 'binary', details: { items: [{}] } },
    'html-has-lang': { score: 1, scoreDisplayMode: 'binary' },
    'final-screenshot': { details: { data: 'data:image/jpeg;base64,AAAA' } },
  };
  return {
    loadingExperience: { overall_category: 'SLOW', metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 4100 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 28 } } },
    lighthouseResult: {
      lighthouseVersion: '13.0.0',
      finalUrl: 'https://example.it/',
      audits,
      categories: {
        performance: { score: perf },
        accessibility: { score: a11y, auditRefs: [
          { id: 'color-contrast', weight: 7 }, { id: 'button-name', weight: 10 }, { id: 'html-has-lang', weight: 3 },
        ] },
        seo: { score: 0.9 },
        'best-practices': { score: 0.8 },
      },
    },
  };
}

export const HOME_HTML = `<!doctype html><html lang="it"><head>
<title>Idraulico Rossi Padova</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Idraulico a Padova per urgenze e manutenzioni. Preventivo gratuito in 24 ore.">
<link rel="canonical" href="https://example.it/"><link rel="icon" href="/favicon.png">
<meta property="og:title" content="Idraulico Rossi"><meta property="og:image" content="https://example.it/og.jpg">
</head><body><h1>Idraulico a Padova</h1><h1>Servizi</h1>
<img src="/a.jpg" alt="Caldaia"><img src="/b.jpg"><img src="/c.jpg" alt="">
<script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
<img src="http://example.it/vecchia.jpg">
<footer>© 2019 Idraulico Rossi</footer></body></html>`;
