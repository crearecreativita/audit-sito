// Passo "site": scarica la home e i file di servizio (robots, sitemap) e ne ricava i fatti utili.
import { safeFetch, statusToError } from '../fetcher.js';
import { AuditError } from '../validate.js';
import { analyzeHtml, detectCookies, countMixedContent } from '../html.js';

export function parseRobots(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const sitemaps = [];
  let blocksAll = false;
  let inStar = false;
  let sawAgentInGroup = false;
  let allowRoot = false;
  let disallowRoot = false;
  for (const l of lines) {
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(l);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === 'sitemap') sitemaps.push(v);
    else if (k === 'user-agent') {
      if (sawAgentInGroup && !inStar) { /* nuovo gruppo */ }
      if (!sawAgentInGroup) inStar = false;
      sawAgentInGroup = true;
      if (v === '*') inStar = true;
    } else {
      sawAgentInGroup = false;
      if (inStar && k === 'disallow' && v === '/') disallowRoot = true;
      if (inStar && k === 'allow' && v === '/') allowRoot = true;
    }
  }
  blocksAll = disallowRoot && !allowRoot;
  return { blocksAll, sitemaps };
}

const looksLikeSitemap = (t) => /<urlset\b|<sitemapindex\b/i.test(t);

/** Data dell'intestazione Last-Modified in formato ISO, o null se assente/non valida/nel futuro. */
export function parseHttpDate(value, now = Date.now()) {
  const t = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(t) || t > now + 86400000 || t < Date.UTC(1995, 0, 1)) return null;
  return new Date(t).toISOString();
}

const TEMPORARY = new Set([502, 503, 504]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function collectSite(url, { fetchImpl = fetch, retryDelayMs = 2500 } = {}) {
  // Un 502/503/504 spesso è un attimo di sovraccarico (cache appena svuotata, picco di visite): riproviamo una volta
  let home = await safeFetch(url, { fetchImpl, timeoutMs: 15000, maxBytes: 1_500_000 });
  if (TEMPORARY.has(home.status)) {
    await wait(retryDelayMs);
    home = await safeFetch(url, { fetchImpl, timeoutMs: 15000, maxBytes: 1_500_000 });
  }
  const err = statusToError(home);
  if (err) throw err;
  if (!/html/i.test(home.headers.get('content-type') || 'text/html') || home.text.trim().length < 1) {
    throw new AuditError('not_html', "L'indirizzo non porta a una pagina web.");
  }

  const finalUrl = new URL(home.finalUrl);
  const origin = finalUrl.origin;
  const isHttps = finalUrl.protocol === 'https:';
  const html = home.text;
  const analysis = analyzeHtml(html);
  const xRobots = (home.headers.get('x-robots-tag') || '').toLowerCase();

  const sub = (path, max = 200_000) =>
    safeFetch(origin + path, { fetchImpl, timeoutMs: 8000, maxBytes: max }).catch(() => null);

  const [robotsRes, httpRes] = await Promise.all([
    sub('/robots.txt'),
    isHttps
      ? safeFetch('http://' + finalUrl.host + '/', { fetchImpl, timeoutMs: 8000, followRedirects: false, body: false }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const robotsOk = !!robotsRes && robotsRes.status === 200 && !/<html/i.test(robotsRes.text.slice(0, 500)) && /user-agent|sitemap|disallow/i.test(robotsRes.text);
  const robots = robotsOk ? parseRobots(robotsRes.text) : { blocksAll: false, sitemaps: [] };

  // Sitemap: prima quella dichiarata in robots.txt, poi i percorsi più comuni
  const candidates = [];
  for (const s of robots.sitemaps.slice(0, 2)) {
    try { candidates.push(new URL(s, origin).pathname + new URL(s, origin).search); } catch { /* ignora */ }
  }
  for (const p of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']) if (!candidates.includes(p)) candidates.push(p);
  let sitemap = false;
  for (const p of candidates.slice(0, 4)) {
    const r = await sub(p, 60_000);
    if (r && r.status === 200 && looksLikeSitemap(r.text)) { sitemap = true; break; }
  }

  let httpToHttps = null; // il vecchio indirizzo http:// porta a https?
  if (httpRes) {
    const loc = httpRes.headers.get('location') || '';
    if ([301, 302, 307, 308].includes(httpRes.status)) httpToHttps = /^https:/i.test(loc);
    else if (httpRes.status === 200) httpToHttps = false;
  }

  return {
    inputUrl: url,
    finalUrl: home.finalUrl,
    host: finalUrl.hostname,
    https: isHttps,
    httpToHttps,
    ttfbMs: home.ms,
    lastModified: parseHttpDate(home.headers.get('last-modified')),
    truncated: home.truncated,
    seo: {
      ...analysis,
      noindexHeader: /\bnoindex\b/.test(xRobots),
      robotsTxt: robotsOk,
      robotsBlocksAll: robots.blocksAll,
      sitemap,
    },
    cookies: detectCookies(html),
    mixedContent: isHttps ? countMixedContent(html) : 0,
  };
}
