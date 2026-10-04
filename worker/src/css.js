// Analisi del CSS: quanti font e quanti colori usa davvero il sito.

// Se lo stack inizia con una di queste voci, il sito usa i caratteri di sistema: non conta come "font scelto".
const SYSTEM_ONLY = new Set(['-apple-system', 'blinkmacsystemfont', 'segoe ui', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'emoji', 'math', 'fangsong', 'inherit', 'initial', 'unset', 'revert']);

const ICON_FONT = /(awesome|icon|dashicons|eicons|fontello|glyph|genericons|material|symbols|elementor|woocommerce|swiper|slick|themify|linearicons|ionicons|fa-|fa\b)/i;

const COLOR_PROPS = /^(color|background|background-color|background-image|border|border-color|border-top|border-right|border-bottom|border-left|border-top-color|border-right-color|border-bottom-color|border-left-color|outline|outline-color|fill|stroke|text-decoration-color|caret-color|accent-color)$/;

// Colori predefiniti di framework, WordPress ed Elementor: compaiono nei CSS dei plugin (spesso uniti in un solo file dalle cache)
// senza che il sito li usi davvero. Li escludiamo dal conteggio.
const DEFAULT_PALETTE = new Set((
  // Bootstrap 3/4
  '#d9534f #5cb85c #5bc0de #f0ad4e #337ab7 #428bca #d43f3a #449d44 #31b0d5 #ec971f #286090 #007bff #6c757d #28a745 #17a2b8 #ffc107 #dc3545 #0069d9 #0056b3 #c82333 #218838 #e0a800 #138496 ' +
  // WordPress admin / avvisi
  '#dc3232 #46b450 #ffb900 #00a0d2 #0073aa #007cba #00a32a #d63638 #2271b1 #72aee6 #135e96 #0a4b78 #3582c4 #f0b849 #dba617 ' +
  // preset di WordPress (blocchi)
  '#cf2e2e #ff6900 #fcb900 #7bdcb5 #00d084 #8ed1fc #0693e3 #9b51e0 #abb8c3 #f78da7 #32373c ' +
  // Elementor e kit di default
  '#6ec1e4 #54595f #7a7a7a #61ce70 #4054b2 #23a455 #93003c #92003b #d30c5c #61ce70 ' +
  // link/azzurri e verdi/rossi di sistema molto comuni nei plugin
  '#0000ee #551a8b #1e73be #0085ba #2ea44f #cb2431'
).split(/\s+/).filter(Boolean));

export function cleanFontName(raw) {
  return String(raw).replace(/!important/i, '').trim().replace(/^['"]|['"]$/g, '').trim();
}

export function hexNorm(h) {
  h = h.toLowerCase();
  if (h.length === 4 || h.length === 5) return '#' + [...h.slice(1, 4)].map((c) => c + c).join('');
  return h.slice(0, 7);
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

export function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

export function isNeutral(hex) {
  const { s, l } = hexToHsl(hex);
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return Math.max(r, g, b) - Math.min(r, g, b) <= 16 || s < 0.1 || l < 0.05 || l > 0.965;
}

/** Estrae i colori da un valore CSS (hex, rgb[a], hsl[a]). Ignora i trasparenti. */
export function colorsInValue(value) {
  const out = [];
  const re = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+%?))?\s*\)|hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)/gi;
  let m;
  while ((m = re.exec(value))) {
    if (m[1]) {
      if (m[1].length === 8 && m[1].slice(6).toLowerCase() === '00') continue;
      if (m[1].length === 4 && m[1][3] === '0') continue;
      out.push(hexNorm('#' + m[1]));
    } else if (m[2] !== undefined) {
      if (m[5] !== undefined && parseFloat(m[5]) === 0) continue;
      const to = (v) => Math.max(0, Math.min(255, Number(v)));
      out.push('#' + [m[2], m[3], m[4]].map((v) => to(v).toString(16).padStart(2, '0')).join(''));
    } else {
      if (m[9] !== undefined && parseFloat(m[9]) === 0) continue;
      const h = (parseFloat(m[6]) % 360 + 360) % 360, s = parseFloat(m[7]) / 100, l = parseFloat(m[8]) / 100;
      const a = s * Math.min(l, 1 - l);
      const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
      out.push('#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join(''));
    }
  }
  return out;
}

/**
 * Analizza testo CSS. Variabili CSS (--x) contate solo se poi referenziate con var(--x):
 * evita di contare le palette predefinite di WordPress/Elementor che nessuno usa.
 */
export function analyzeCss(css, acc = { fonts: new Map(), colors: new Map(), varFonts: new Map(), varColors: new Map(), usedVars: new Set() }) {
  // via commenti e regole di WordPress/blocchi (.has-*, .wp-block-*, .wp-element-*): usano i colori predefiniti anche se il sito non li adopera
  const text = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[^{}]*\.(?:has-[\w-]+|wp-block-[\w-]+|wp-element-[\w-]+)[^{}]*\{[^{}]*\}/g, '');

  for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) acc.usedVars.add(m[1]);

  const declRe = /([\w-]+)\s*:\s*([^;{}]+)(?=[;}]|$)/g;
  let d;
  while ((d = declRe.exec(text))) {
    const prop = d[1].toLowerCase();
    const value = d[2];
    if (prop.startsWith('--')) {
      if (/font-family/.test(prop) || (/font/.test(prop) && /^["']?[A-Za-z]/.test(value.trim()) && !/size|weight|style|line|height|spacing|transform|decoration/.test(prop))) {
        const fam = firstFamily(value);
        if (fam) acc.varFonts.set(prop, fam);
      } else if (!/font|size|width|height|radius|spacing|shadow|duration|gap|margin|padding|opacity/.test(prop)) {
        const cs = colorsInValue(value);
        if (cs.length) acc.varColors.set(prop, cs);
      }
      continue;
    }
    if (prop === 'font-family') {
      const fam = firstFamily(value);
      if (fam) acc.fonts.set(fam, (acc.fonts.get(fam) || 0) + 1);
    } else if (COLOR_PROPS.test(prop)) {
      for (const c of colorsInValue(value)) acc.colors.set(c, (acc.colors.get(c) || 0) + 1);
    }
  }

  for (const m of text.matchAll(/@font-face\s*{[^}]*?font-family\s*:\s*([^;}]+)/gi)) {
    const fam = firstFamily(m[1]);
    if (fam) acc.fonts.set(fam, acc.fonts.get(fam) || 0.5); // dichiarato ma non per forza usato
  }
  return acc;
}

function firstFamily(value) {
  if (/var\(/.test(value)) return null;
  const name = cleanFontName(value.split(',')[0]);
  if (!name) return null;
  if (SYSTEM_ONLY.has(name.toLowerCase()) || ICON_FONT.test(name)) return null;
  return name;
}

export function finalizeCss(acc) {
  const fonts = new Map(acc.fonts);
  for (const [prop, fam] of acc.varFonts) if (acc.usedVars.has(prop)) fonts.set(fam, (fonts.get(fam) || 0) + 1);
  const colors = new Map(acc.colors);
  for (const [prop, cs] of acc.varColors) if (acc.usedVars.has(prop)) for (const c of cs) colors.set(c, (colors.get(c) || 0) + 1);
  for (const hex of DEFAULT_PALETTE) colors.delete(hex);
  return { fonts, colors };
}

/** Raggruppa i colori significativi in "famiglie" di tinta. */
export function colorFamilies(colors) {
  const sig = [...colors.entries()].filter(([hex, n]) => n >= 2 && !isNeutral(hex)).map(([hex, n]) => ({ hex, n, h: hexToHsl(hex).h }));
  if (!sig.length) return { families: 0, top: [] };
  const sorted = [...sig].sort((a, b) => a.h - b.h);
  const clusters = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = clusters[clusters.length - 1];
    if (sorted[i].h - last[last.length - 1].h <= 28) last.push(sorted[i]);
    else clusters.push([sorted[i]]);
  }
  if (clusters.length > 1) {
    const first = clusters[0], last = clusters[clusters.length - 1];
    if (360 - last[last.length - 1].h + first[0].h <= 28) { first.unshift(...last); clusters.pop(); }
  }
  const top = [...sig].sort((a, b) => b.n - a.n).slice(0, 6).map(({ hex, n }) => ({ hex, n }));
  return { families: clusters.length, top };
}

/** Famiglie Google Fonts dichiarate nell'URL di un <link> (css / css2). */
export function googleFontFamilies(href) {
  try {
    const u = new URL(href, 'https://x.invalid/');
    if (!/fonts\.googleapis\.com$/.test(u.hostname)) return [];
    const names = [];
    for (const f of u.searchParams.getAll('family')) names.push(f.split(':')[0].replace(/\+/g, ' ').trim());
    return names.filter(Boolean);
  } catch { return []; }
}
