// PageSpeed Insights: chiamata e riduzione del JSON gigante in pochi numeri.
import { AuditError } from './validate.js';

const PSI_DEFAULT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

const RUNTIME_ERRORS = {
  FAILED_DOCUMENT_REQUEST: ['unreachable', 'Google non è riuscito ad aprire il sito. Controlla che sia online e raggiungibile da tutti.'],
  ERRORED_DOCUMENT_REQUEST: ['blocked', 'Il sito ha risposto con un errore agli strumenti di Google, oppure li blocca.'],
  DNS_FAILURE: ['unreachable', "Google non trova questo indirizzo. Controlla di averlo scritto giusto."],
  PAGE_HUNG: ['timeout', 'Il sito ha impiegato troppo a caricarsi durante il test.'],
  NO_FCP: ['render_failed', 'Il sito non ha mostrato nulla durante il test.'],
  NO_LCP: ['render_failed', 'Il sito non ha mostrato contenuti durante il test.'],
  INSECURE_DOCUMENT_REQUEST: ['unreachable', 'Il certificato di sicurezza del sito non è valido: i browser mostrano un avviso.'],
  NOT_HTML: ['not_html', "L'indirizzo non porta a una pagina web."],
};

export async function runPsi({ url, strategy, apiKey, endpoint, fetchImpl = fetch, timeoutMs = 75000 }) {
  const params = new URLSearchParams({ url, strategy });
  const cats = strategy === 'mobile' ? ['performance', 'accessibility', 'seo', 'best-practices'] : ['performance'];
  for (const c of cats) params.append('category', c);
  if (apiKey) params.set('key', apiKey);

  let res;
  try {
    res = await fetchImpl((endpoint || PSI_DEFAULT) + '?' + params.toString(), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new AuditError('timeout', "L'analisi di velocità ha impiegato troppo. Il sito è molto lento o non risponde.");
    }
    throw new AuditError('psi_failed', 'Il servizio di Google per la velocità non ha risposto. Riprova tra qualche minuto.');
  }

  let json = null;
  try { json = await res.json(); } catch { /* corpo non JSON */ }

  if (!res.ok) {
    const msg = json?.error?.message || '';
    if (res.status === 429 || /quota/i.test(msg)) {
      throw new AuditError('psi_busy', 'Il servizio di analisi è molto richiesto in questo momento. Riprova tra qualche minuto.');
    }
    if (/FAILED_DOCUMENT_REQUEST|ERRORED_DOCUMENT_REQUEST|DNS_FAILURE/.test(msg)) {
      throw new AuditError('unreachable', RUNTIME_ERRORS.FAILED_DOCUMENT_REQUEST[1]);
    }
    if (/timed? ?out|DEADLINE/i.test(msg)) {
      throw new AuditError('timeout', "L'analisi di velocità ha impiegato troppo. Il sito è molto lento o non risponde.");
    }
    throw new AuditError('psi_failed', "L'analisi di velocità non è andata a buon fine. Riprova tra qualche minuto.");
  }

  const rt = json?.lighthouseResult?.runtimeError;
  if (rt?.code && rt.code !== 'NO_ERROR' && RUNTIME_ERRORS[rt.code]) {
    const [code, message] = RUNTIME_ERRORS[rt.code];
    throw new AuditError(code, message);
  }
  if (!json?.lighthouseResult?.categories?.performance) {
    throw new AuditError('psi_failed', "L'analisi di velocità non ha restituito risultati. Riprova tra qualche minuto.");
  }
  return json;
}

const pct = (s) => (typeof s === 'number' ? Math.round(s * 100) : null);
const num = (a) => (a && typeof a.numericValue === 'number' ? a.numericValue : null);
const failed = (a) => a && a.score !== null && a.score !== undefined && a.score < 1 && a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'manual' && a.scoreDisplayMode !== 'informative';

/** Estrae solo ciò che serve. Il risultato è piccolo (pochi KB) e finisce nel payload firmato. */
export function reducePsi(json, strategy) {
  const lh = json.lighthouseResult;
  const audits = lh.audits || {};
  const cats = lh.categories || {};

  const out = {
    strategy,
    finalUrl: lh.finalDisplayedUrl || lh.finalUrl || '',
    lighthouse: lh.lighthouseVersion || '',
    scores: {
      performance: pct(cats.performance?.score),
      accessibility: pct(cats.accessibility?.score),
      seo: pct(cats.seo?.score),
      bestPractices: pct(cats['best-practices']?.score),
    },
    metrics: {
      fcp: num(audits['first-contentful-paint']),
      lcp: num(audits['largest-contentful-paint']),
      cls: num(audits['cumulative-layout-shift']),
      tbt: num(audits['total-blocking-time']),
      si: num(audits['speed-index']),
      ttfb: num(audits['server-response-time']),
    },
    pageWeight: num(audits['total-byte-weight']),
  };

  // Dati reali degli utenti (CrUX), se Google li ha
  const le = json.loadingExperience;
  if (le?.metrics && le.overall_category) {
    out.field = {
      category: le.overall_category,
      lcp: le.metrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
      cls: le.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? le.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
      inp: le.metrics.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
    };
  }

  // Immagini: peso reale dalle richieste di rete + risparmio stimato da Lighthouse
  const reqs = audits['network-requests']?.details?.items || [];
  const images = reqs
    .filter((r) => r.resourceType === 'Image' && typeof r.transferSize === 'number')
    .map((r) => ({ url: String(r.url || ''), bytes: r.transferSize }))
    .sort((a, b) => b.bytes - a.bytes);
  const wasted = ['uses-optimized-images', 'modern-image-formats', 'uses-responsive-images', 'image-delivery-insight']
    .map((id) => audits[id]?.details?.overallSavingsBytes ?? audits[id]?.metricSavings?.bytes ?? 0)
    .reduce((a, b) => Math.max(a, b || 0), 0);
  out.images = {
    count: images.length,
    totalBytes: images.reduce((s, i) => s + i.bytes, 0),
    heavy: images.filter((i) => i.bytes >= 200 * 1024).slice(0, 5).map((i) => ({ name: shortName(i.url), bytes: i.bytes })),
    heavyCount: images.filter((i) => i.bytes >= 200 * 1024).length,
    wastedBytes: wasted,
  };

  // Mobile e usabilità
  const ts = audits['target-size'];
  const fs = audits['font-size'];
  out.mobile = {
    viewport: audits.viewport ? audits.viewport.score === 1 : null,
    zoomBlocked: audits['meta-viewport'] ? audits['meta-viewport'].score === 0 : null,
    targetSizeFails: ts && failed(ts) ? (ts.details?.items?.length || 1) : ts && ts.score === 1 ? 0 : null,
    fontSize: fs && fs.score !== null && fs.score !== undefined && fs.scoreDisplayMode !== 'notApplicable'
      ? { score: fs.score, displayValue: fs.displayValue || '' }
      : null,
  };

  // Accessibilità: elenco dei controlli falliti
  const refs = cats.accessibility?.auditRefs || [];
  out.a11yFails = refs
    .filter((r) => r.weight > 0 && failed(audits[r.id]))
    .map((r) => ({ id: r.id, n: audits[r.id].details?.items?.length || 1, w: r.weight }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 12);

  return out;
}

export function extractScreenshot(json) {
  const d = json?.lighthouseResult?.audits?.['final-screenshot']?.details?.data;
  return typeof d === 'string' && d.startsWith('data:image/') ? d : null;
}

function shortName(u) {
  try {
    const p = new URL(u).pathname.split('/').filter(Boolean).pop() || u;
    return decodeURIComponent(p).slice(0, 60);
  } catch {
    return String(u).slice(-60);
  }
}
