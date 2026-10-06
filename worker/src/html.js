// Piccoli estrattori HTML basati su regex (nei Worker non c'è un DOM).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

export function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export const stripTags = (s) => decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** HTML senza commenti, script, style e template: per contare titoli, immagini, ecc. */
export function cleanHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template|svg)\b[\s\S]*?<\/\1>/gi, '');
}

const ATTR_RE = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export function parseAttrs(str) {
  const out = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(str))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

export function getTags(html, tag) {
  const re = new RegExp('<' + tag + '\\b([^>]*)>', 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(parseAttrs(m[1]));
  return out;
}

export function getTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? stripTags(m[1]) : '';
}

export function metaContent(metas, key) {
  const k = key.toLowerCase();
  const hit = metas.find((a) => (a.name || '').toLowerCase() === k || (a.property || '').toLowerCase() === k);
  return hit ? (hit.content || '').trim() : '';
}

export function getH1s(clean) {
  const out = [];
  const re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
  let m;
  while ((m = re.exec(clean))) {
    const t = stripTags(m[1]);
    // un H1 che contiene solo un'immagine con alt conta come pieno
    const imgAlt = /<img\b[^>]*\balt\s*=\s*["']([^"']+)["']/i.exec(m[1]);
    out.push(t || (imgAlt ? imgAlt[1] : ''));
  }
  return out;
}

/** Analisi della home per SEO base e mobile. */
export function analyzeHtml(html) {
  const clean = cleanHtml(html);
  const metas = getTags(clean, 'meta');
  const links = getTags(clean, 'link');

  const title = getTitle(clean);
  const description = metaContent(metas, 'description');
  const robotsMeta = metaContent(metas, 'robots').toLowerCase();
  const viewport = metaContent(metas, 'viewport');
  const h1s = getH1s(clean);

  const imgs = getTags(clean, 'img').filter((a) => {
    const src = (a.src || a['data-src'] || a['data-lazy-src'] || '').trim();
    if (src.startsWith('data:')) return Boolean(a['data-src'] || a['data-lazy-src']); // segnaposto lazy
    return Boolean(src || a.srcset || a['data-srcset']);
  });
  const imgsNoAlt = imgs.filter((a) => !('alt' in a)).length;

  const rel = (a) => (a.rel || '').toLowerCase().split(/\s+/);
  const canonical = (links.find((a) => rel(a).includes('canonical')) || {}).href || '';
  const hasIconLink = links.some((a) => rel(a).includes('icon') || rel(a).includes('apple-touch-icon'));

  const og = {
    title: metaContent(metas, 'og:title'),
    description: metaContent(metas, 'og:description'),
    image: metaContent(metas, 'og:image'),
  };

  const htmlTag = /<html\b([^>]*)>/i.exec(clean);
  const lang = htmlTag ? parseAttrs(htmlTag[1]).lang || '' : '';

  return {
    title,
    description,
    h1Count: h1s.length,
    h1Texts: h1s.slice(0, 3),
    emptyH1: h1s.filter((t) => !t).length,
    imgTotal: imgs.length,
    imgNoAlt: imgsNoAlt,
    noindex: /\bnoindex\b/.test(robotsMeta),
    canonical,
    lang,
    viewport,
    viewportOk: /width\s*=\s*device-width/i.test(viewport),
    zoomBlocked: /user-scalable\s*=\s*(no|0)/i.test(viewport) || /maximum-scale\s*=\s*1(\.0)?\b/i.test(viewport),
    og,
    hasIconLink,
  };
}

const TRACKERS = [
  /googletagmanager\.com/i, /google-analytics\.com/i, /\bgtag\s*\(/i, /connect\.facebook\.net/i, /\bfbq\s*\(/i,
  /static\.hotjar\.com/i, /clarity\.ms/i, /snap\.licdn\.com/i, /analytics\.tiktok\.com/i, /sitekit/i, /googlesitekit/i,
  /matomo|piwik/i, /plausible\.io/i,
];

const CMP = [
  /iubenda/i, /cookiebot/i, /cookieyes/i, /cookie-law-info/i, /complianz|cmplz/i, /onetrust|optanon/i, /osano/i,
  /termly/i, /cookie[-_]notice/i, /cookie[-_]consent|cookieconsent/i, /borlabs/i, /usercentrics/i, /quantcast/i,
  /didomi/i, /trustarc/i, /axeptio/i, /cookiefirst/i, /gdpr[-_]cookie|moove_gdpr/i, /real-cookie-banner/i,
  /cookie[-_](banner|bar|popup|policy-popup|modal)/i, /cc-window|cc-banner/i, /\bcmp[-_]?(banner|container)\b/i,
  /utilizz\w+\s+(i\s+)?cookie/i, /accett\w+\s+(tutti\s+)?(i\s+)?cookie/i, /usiamo\s+(i\s+)?cookie/i,
];

export function detectCookies(rawHtml) {
  return {
    trackers: TRACKERS.some((re) => re.test(rawHtml)),
    banner: CMP.some((re) => re.test(rawHtml)),
  };
}

/** Elementi caricati in chiaro (http://) dentro una pagina https. */
export function countMixedContent(rawHtml) {
  const set = new Set();
  const re = /<(?:img|script|iframe|source|video|audio|link)\b[^>]*?\b(?:src|href)\s*=\s*["'](http:\/\/[^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(rawHtml))) {
    const tag = m[0].toLowerCase();
    if (tag.startsWith('<link') && !/rel\s*=\s*["']?(stylesheet|preload)/i.test(tag)) continue;
    set.add(m[1]);
    if (set.size >= 50) break;
  }
  return set.size;
}

/* ───────── Fase 2: segnali di abbandono e fonti di stile ───────── */

/** Anno di copyright nel footer (il più recente trovato). */
export function copyrightYear(html) {
  const clean = cleanHtml(html);
  const footers = [...clean.matchAll(/<footer\b[\s\S]*?<\/footer>/gi)].map((m) => m[0]);
  const scope = footers.length ? footers.join(' ') : clean.slice(-20000);
  const text = stripTags(scope);
  let best = null;
  const re = /(?:©|&copy;|copyright)\s*(?:\(c\)\s*)?(?:[^\d©]{0,25})?((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi;
  let m;
  while ((m = re.exec(text))) {
    const y = Number(m[2] || m[1]);
    if (best === null || y > best) best = y;
  }
  return best;
}

const okVer = (v) => /^\d{1,2}(\.\d{1,3}){1,2}$/.test(v || '') && Number(v.split('.')[0]) < 100;

export function detectWordPress(html) {
  const isWp = /\/wp-content\/|\/wp-includes\//i.test(html);
  if (!isWp) return { detected: false };
  const metas = getTags(html, 'meta');
  const gen = metas.find((a) => (a.name || '').toLowerCase() === 'generator' && /^WordPress/i.test(a.content || ''));
  let version = gen ? ((/WordPress\s+([\d.]+)/i.exec(gen.content) || [])[1] || null) : null;
  let versionFrom = version ? 'generator' : null;
  if (!version) {
    const m = /wp-includes\/(?:css\/dist\/block-library\/style(?:\.min)?\.css|js\/wp-emoji-release\.min\.js|css\/classic-themes(?:\.min)?\.css)\?ver=([\d.]+)/i.exec(html);
    if (m && okVer(m[1])) { version = m[1]; versionFrom = 'asset'; }
  }
  const themes = [];
  const seen = new Set();
  const re = /\/wp-content\/themes\/([\w-]+)\/([^"'\s>]*)/gi;
  let t;
  while ((t = re.exec(html))) {
    const slug = t[1].toLowerCase();
    if (!seen.has(slug)) { seen.add(slug); themes.push({ slug, version: null }); }
    const style = /^style(?:\.min)?\.css\?ver=([\d.]+)/.exec(t[2]);
    if (style && okVer(style[1])) themes.find((x) => x.slug === slug).version = style[1];
    if (themes.length >= 3) break;
  }
  // se il tema dichiara la stessa versione di WordPress, è WordPress che l'ha aggiunta: non è la versione del tema
  for (const t of themes) if (t.version && t.version === version) t.version = null;
  return { detected: true, version, versionFrom, themes };
}

/** CSS interno (<style>) e fogli di stile collegati. */
export function styleSources(html, baseUrl) {
  const inline = [];
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) inline.push(m[1]);
  const links = [];
  for (const a of getTags(html.replace(/<!--[\s\S]*?-->/g, ''), 'link')) {
    if (!/\bstylesheet\b/i.test(a.rel || '') || !a.href) continue;
    if ((a.media || 'all').toLowerCase() === 'print') continue;
    try { links.push(new URL(a.href, baseUrl).href); } catch { /* href malformato */ }
  }
  return { inline, links: [...new Set(links)] };
}

/** Indirizzi dei feed RSS/Atom dichiarati nella pagina (quelli dei commenti per ultimi). */
export function feedLinks(html, baseUrl) {
  const out = [];
  for (const a of getTags(html.replace(/<!--[\s\S]*?-->/g, ''), 'link')) {
    if (!/\balternate\b/i.test(a.rel || '') || !/(rss|atom)\+xml/i.test(a.type || '') || !a.href) continue;
    try { out.push(new URL(a.href, baseUrl).href); } catch { /* href malformato */ }
  }
  const main = out.filter((u) => !/comment/i.test(u));
  const comments = out.filter((u) => /comment/i.test(u));
  return [...new Set([...main, ...comments])];
}

/* ───────── Tecnologie datate e piattaforma ───────── */

const highest = (versions) => versions.sort((a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pb[i] || 0) - (pa[i] || 0); if (d) return d; }
  return 0;
})[0] || null;

function findVersions(html, patterns) {
  const found = [];
  for (const re of patterns) for (const m of html.matchAll(re)) if (/^\d{1,2}\.\d{1,2}(\.\d{1,3})?$/.test(m[1])) found.push(m[1]);
  return found;
}

/** jQuery e Bootstrap letti dai nomi dei file caricati (versione più alta trovata), tag HTML obsoleti, Flash. */
export function detectLegacyTech(rawHtml) {
  const jquery = highest(findVersions(rawHtml, [
    /jquery[-.](\d+\.\d+(?:\.\d+)?)(?:\.min)?\.js/gi,
    /ajax\/libs\/jquery\/(\d+\.\d+(?:\.\d+)?)\//gi,
    /\/jquery(?:\.min)?\.js\?ver=(\d+\.\d+(?:\.\d+)?)/gi,
  ]));
  const bootstrap = highest(findVersions(rawHtml, [
    /bootstrap(?:cdn\.com)?\/(\d+\.\d+(?:\.\d+)?)\//gi,
    /bootstrap@(\d+\.\d+(?:\.\d+)?)/gi,
    /bootstrap(?:\.min)?\.(?:css|js)\?ver=(\d+\.\d+(?:\.\d+)?)/gi,
    /bootstrap[-.](\d+\.\d+(?:\.\d+)?)(?:\.min)?\.(?:css|js)/gi,
  ]));
  const clean = cleanHtml(rawHtml);
  const obsoleteTags = (clean.match(/<(?:font|center|marquee|blink)\b/gi) || []).length;
  const flash = /\.swf\b|application\/x-shockwave-flash|swfobject|clsid:d27cdb6e/i.test(rawHtml);
  return { jquery, bootstrap, obsoleteTags, flash };
}

/** Piattaforma con cui è fatto il sito (per te: serve a capire che tipo di cliente è). Stringa vuota se non si capisce. */
export function detectPlatform(rawHtml, headers) {
  const h = (n) => (headers && typeof headers.get === 'function' ? headers.get(n) || '' : '');
  const metas = getTags(rawHtml, 'meta');
  // i siti hanno spesso più meta "generator" (WordPress, Elementor, Site Kit…): si leggono tutti
  const gen = metas.filter((a) => (a.name || '').toLowerCase() === 'generator').map((a) => a.content || '').join(' | ');
  const t = (re) => re.test(rawHtml);
  if (h('x-wix-request-id') || t(/wixstatic\.com|static\.parastorage\.com/i) || /(^|\| )Wix/i.test(gen)) return 'Wix';
  if (t(/static1\.squarespace\.com|squarespace-cdn/i) || /Squarespace/i.test(gen)) return 'Squarespace';
  if (h('x-shopid') || t(/cdn\.shopify\.com|Shopify\.theme/i)) return 'Shopify';
  if (t(/data-wf-page|assets-global\.website-files\.com/i) || /Webflow/i.test(gen)) return 'Webflow';
  if (t(/img1\.wsimg\.com|websitebuilder\.godaddy/i)) return 'GoDaddy Website Builder';
  if (t(/\.jimdo(?:cdn|static)?\.com|jimdo-cdn/i) || /Jimdo/i.test(gen)) return 'Jimdo';
  if (t(/cdn\d*\.editmysite\.com|weebly\.com/i)) return 'Weebly';
  if (/PrestaShop/i.test(gen) || t(/\/modules\/ps_|prestashop\.com|var prestashop/i)) return 'PrestaShop';
  if (t(/\/static\/version\d+\/frontend\/|Magento_/i) || /Magento/i.test(gen)) return 'Magento';
  if (/Joomla/i.test(gen) || t(/\/media\/jui\/|\/media\/system\/js\/|com_content/i)) return 'Joomla';
  if (/Drupal/i.test(gen) || /Drupal/i.test(h('x-generator')) || t(/\/sites\/default\/files\/|Drupal\.settings/i)) return 'Drupal';
  if (t(/\/wp-content\/|\/wp-includes\//i) || /(^|\| )WordPress/i.test(gen)) {
    const builder = /Elementor/i.test(gen) || t(/\/plugins\/elementor\//i) ? 'Elementor'
      : t(/\/themes\/Divi\/|et_pb_section/i) ? 'Divi'
      : t(/js_composer|wpb_wrapper/i) ? 'WPBakery'
      : t(/fl-builder/i) ? 'Beaver Builder'
      : t(/\/plugins\/oxygen|oxy-/i) ? 'Oxygen' : '';
    return builder ? `WordPress (${builder})` : 'WordPress';
  }
  return '';
}
