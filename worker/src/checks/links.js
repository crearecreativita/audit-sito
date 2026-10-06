// Link interni della home che portano a pagine inesistenti.
// Paletti per evitare falsi allarmi: solo link dello stesso sito, solo 404/410/500 contano come "rotti",
// i 403/429/5xx passeggeri sono protezioni o sovraccarichi, non link rotti; pochi link e pochi alla volta.
import { safeFetch } from '../fetcher.js';
import { parseTargetUrl, rateKeyHost } from '../validate.js';
import { cleanHtml, getTags } from '../html.js';

const SKIP_EXT = /\.(?:jpe?g|png|gif|webp|avif|svg|ico|css|js|json|xml|txt|zip|rar|7z|mp4|mp3|webm|woff2?|ttf|eot)(?:[?#]|$)/i;
const SKIP_PATH = /\/(?:wp-admin|wp-login\.php|xmlrpc\.php|wp-json|cdn-cgi|feed|cart|carrello|checkout|my-account|account|logout)(?:\/|$|\?)|add-to-cart|[?&]s=/i;

export function pickInternalLinks(html, baseUrl, max = 12) {
  const base = new URL(baseUrl);
  const baseHost = rateKeyHost(base.hostname.toLowerCase());
  const seen = new Set();
  const out = [];
  for (const a of getTags(cleanHtml(html), 'a')) {
    const href = (a.href || '').trim();
    if (!href || /^(#|mailto:|tel:|javascript:|sms:|whatsapp:|data:)/i.test(href)) continue;
    let u;
    try { u = new URL(href, base); } catch { continue; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    if (rateKeyHost(u.hostname.toLowerCase()) !== baseHost) continue;
    u.hash = '';
    const path = u.pathname + u.search;
    if (path === '/' || path === '' || u.href === base.href) continue;
    if (SKIP_EXT.test(path) || SKIP_PATH.test(path)) continue;
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    out.push(u.href);
    if (out.length >= max) break;
  }
  return out;
}

async function check(url, fetchImpl, timeoutMs) {
  const opts = { fetchImpl, timeoutMs, body: false, headers: { accept: 'text/html,*/*;q=0.5' } };
  try {
    let r = await safeFetch(url, { ...opts, method: 'HEAD' });
    if ([405, 501, 400].includes(r.status)) r = await safeFetch(url, { ...opts, method: 'GET' }); // alcuni server non gestiscono HEAD
    return { url, status: r.status, broken: r.status === 404 || r.status === 410 || r.status === 500 };
  } catch (e) {
    if (e && e.code === 'redirect_loop') return { url, status: null, broken: true, reason: 'loop' };
    try { // HEAD fallito per la rete: un secondo tentativo con GET prima di rinunciare
      const r = await safeFetch(url, { ...opts, method: 'GET' });
      return { url, status: r.status, broken: r.status === 404 || r.status === 410 || r.status === 500 };
    } catch (e2) {
      if (e2 && e2.code === 'redirect_loop') return { url, status: null, broken: true, reason: 'loop' };
      return { url, status: null, broken: false, unchecked: true };
    }
  }
}

/** @returns {{checked:number, unchecked:number, broken:{url:string,status:number|null}[]}} */
export async function checkLinks(urls, { fetchImpl = fetch, concurrency = 3, timeoutMs = 6000 } = {}) {
  const safe = [];
  for (const u of urls.slice(0, 12)) { try { safe.push(parseTargetUrl(u).url); } catch { /* non ammesso */ } }
  const results = [];
  for (let i = 0; i < safe.length; i += concurrency) {
    results.push(...(await Promise.all(safe.slice(i, i + concurrency).map((u) => check(u, fetchImpl, timeoutMs)))));
  }
  const unchecked = results.filter((r) => r.unchecked).length;
  return {
    checked: results.length - unchecked,
    unchecked,
    broken: results.filter((r) => r.broken).map(({ url, status }) => ({ url, status })),
  };
}
