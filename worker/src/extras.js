// Fase 2: identità visiva (font, colori, favicon) e segnali di abbandono (anno nel footer, WordPress, tema).
import { safeFetch } from './fetcher.js';
import { parseTargetUrl } from './validate.js';
import { copyrightYear, detectWordPress, styleSources, feedLinks } from './html.js';
import { analyzeCss, finalizeCss, colorFamilies, googleFontFamilies } from './css.js';

const MAX_CSS_FILES = 6;
const MAX_CSS_BYTES = 300_000;
const MAX_INLINE_BYTES = 600_000;

/** Data dell'articolo più recente in un feed RSS o Atom (ISO), o null. Ignora lastBuildDate: cambia anche con un commento. */
export function parseFeedLatest(xml, now = Date.now()) {
  const text = String(xml || '');
  const blocks = [...text.matchAll(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/gi)].slice(0, 8).map((m) => m[0]);
  let best = null;
  for (const b of blocks) {
    const m = /<(?:pubDate|dc:date|published|updated)\b[^>]*>\s*([^<]+?)\s*<\/(?:pubDate|dc:date|published|updated)>/i.exec(b);
    const t = m ? Date.parse(m[1]) : NaN;
    if (Number.isFinite(t) && t <= now + 86400000 && t > Date.UTC(1995, 0, 1) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

const parseVer = (v) => {
  const p = String(v || '').split('.').map(Number);
  return p.length >= 2 && p.every(Number.isFinite) ? { major: p[0], minor: p[1], patch: p[2] || 0 } : null;
};
/** Distanza approssimata in "rilasci" (le versioni minori vanno da 0 a 9 dentro ogni numero maggiore). */
export function releasesBehind(found, latest) {
  const a = parseVer(found), b = parseVer(latest);
  if (!a || !b) return null;
  return (b.major - a.major) * 10 + (b.minor - a.minor);
}

/** Passo "style": rilegge la home e analizza gli stili. L'URL arriva da un passo firmato. */
export async function collectExtras(site, { fetchImpl = fetch } = {}) {
  const out = { fonts: [], googleFonts: [], colors: { distinct: 0, families: 0, top: [] }, cssFiles: 0, favicon: { ok: !!site.seo?.hasIconLink, via: site.seo?.hasIconLink ? 'link' : null }, year: null, wp: { detected: false } };

  const home = await safeFetch(site.finalUrl, { fetchImpl, timeoutMs: 15000, maxBytes: 1_500_000 });
  const html = home.text;

  out.year = copyrightYear(html);
  out.wp = detectWordPress(html);

  const { inline, links } = styleSources(html, home.finalUrl);
  let state = analyzeCss('');
  let inlineBytes = 0;
  for (const css of inline) {
    if (inlineBytes > MAX_INLINE_BYTES) break;
    const piece = css.slice(0, MAX_INLINE_BYTES - inlineBytes);
    inlineBytes += piece.length;
    state = analyzeCss(piece, state);
  }

  const googleFamilies = new Set();
  const cssUrls = [];
  for (const href of links) {
    const g = googleFontFamilies(href);
    if (g.length) { g.forEach((f) => googleFamilies.add(f)); continue; }
    // su WordPress i CSS dei plugin e del core non dicono nulla sull'identità del sito
    if (out.wp.detected && /\/wp-content\/plugins\/|\/wp-includes\//i.test(href)) continue;
    try { cssUrls.push(parseTargetUrl(href).url); } catch { /* host non ammesso */ }
  }
  // sito ammesso solo http/https pubblici; massimo MAX_CSS_FILES file
  const files = await Promise.all(cssUrls.slice(0, MAX_CSS_FILES).map((u) =>
    safeFetch(u, { fetchImpl, timeoutMs: 8000, maxBytes: MAX_CSS_BYTES, headers: { accept: 'text/css,*/*;q=0.1' } }).catch(() => null)));
  for (const f of files) {
    if (f && f.status === 200) { out.cssFiles++; state = analyzeCss(f.text, state); }
  }

  const { fonts, colors } = finalizeCss(state);
  for (const g of googleFamilies) fonts.set(g, (fonts.get(g) || 0) + 1);
  out.googleFonts = [...googleFamilies];
  out.fonts = [...fonts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, n]) => ({ name, n: Math.round(n) }));
  const fam = colorFamilies(colors);
  out.colors = { distinct: [...colors.keys()].length, families: fam.families, top: fam.top };

  // Data dell'ultimo articolo: dal feed del sito, poi (solo WordPress) dall'API REST
  out.lastModified = site.lastModified || null;
  out.php = site.php || null;
  out.lastPost = { date: null, source: null };
  const origin = new URL(home.finalUrl).origin;
  const feeds = [];
  for (const u of [...feedLinks(html, home.finalUrl), origin + '/feed/', origin + '/feed', origin + '/rss.xml', origin + '/atom.xml']) {
    try { const v = parseTargetUrl(u).url; if (!feeds.includes(v)) feeds.push(v); } catch { /* non ammesso */ }
  }
  for (const u of feeds.slice(0, 3)) {
    const r = await safeFetch(u, { fetchImpl, timeoutMs: 6000, maxBytes: 300_000, headers: { accept: 'application/rss+xml, application/atom+xml, text/xml, */*;q=0.5' } }).catch(() => null);
    const d = r && r.status === 200 ? parseFeedLatest(r.text) : null;
    if (d) { out.lastPost = { date: d, source: 'feed' }; break; }
  }
  if (!out.lastPost.date && out.wp.detected) {
    const r = await safeFetch(origin + '/wp-json/wp/v2/posts?per_page=1&_fields=date_gmt', { fetchImpl, timeoutMs: 6000, maxBytes: 20_000, headers: { accept: 'application/json' } }).catch(() => null);
    try {
      const t = r && r.status === 200 ? Date.parse(JSON.parse(r.text)[0].date_gmt + 'Z') : NaN;
      if (Number.isFinite(t) && t < Date.now() + 86400000) out.lastPost = { date: new Date(t).toISOString(), source: 'rest' };
    } catch { /* risposta non valida */ }
  }

  // Favicon: se non c'è <link>, proviamo /favicon.ico
  if (!out.favicon.ok) {
    const r = await safeFetch(new URL('/favicon.ico', home.finalUrl).href, { fetchImpl, timeoutMs: 6000, maxBytes: 2048 }).catch(() => null);
    if (r && r.status === 200 && /image|icon|octet/i.test(r.headers.get('content-type') || '')) out.favicon = { ok: true, via: 'favicon.ico' };
  }

  // WordPress: ultima versione e info sui temi (gratuiti, da wordpress.org)
  if (out.wp.detected) {
    const tasks = [];
    if (out.wp.version) {
      tasks.push(fetchImpl('https://api.wordpress.org/core/version-check/1.7/', { signal: AbortSignal.timeout(6000) })
        .then((r) => r.json()).then((j) => { out.wp.latest = j?.offers?.[0]?.current || null; }).catch(() => {}));
    }
    for (const t of out.wp.themes.slice(0, 2)) {
      const u = 'https://api.wordpress.org/themes/info/1.2/?action=theme_information&request%5Bslug%5D=' + encodeURIComponent(t.slug) + '&request%5Bfields%5D%5Blast_updated%5D=1';
      tasks.push(fetchImpl(u, { signal: AbortSignal.timeout(6000) }).then((r) => r.json()).then((j) => {
        if (j && j.version) { t.latest = j.version; t.lastUpdated = j.last_updated || null; t.name = j.name || t.slug; t.org = true; }
      }).catch(() => {}));
    }
    await Promise.all(tasks);
  }
  return out;
}

/** Fine del supporto di sicurezza per ogni ramo di PHP (date ufficiali di php.net: da aggiornare ogni anno). */
const PHP_SUPPORT_END = { '8.0': '2023-11-26', '8.1': '2025-12-31', '8.2': '2026-12-31', '8.3': '2027-12-31', '8.4': '2028-12-31', '8.5': '2029-12-31' };

export function phpSupportEnd(version) {
  const m = /^(\d+)\.(\d+)/.exec(version || '');
  if (!m) return null;
  const branch = `${m[1]}.${m[2]}`;
  if (PHP_SUPPORT_END[branch]) return PHP_SUPPORT_END[branch];
  if (Number(m[1]) < 8 || (m[1] === '8' && Number(m[2]) < 0)) return '2022-11-28'; // 7.x e precedenti: fuori supporto da tempo
  return null; // ramo più recente di quelli che conosco
}

/* ───────── dai fatti al report ───────── */

const row = (label, value, status, hint, extra) => ({ label, value, status, ...(hint ? { hint } : {}), ...(extra || {}) });

export function buildExtras(x, site, now = Date.now()) {
  const nowDate = new Date(now);
  const year = nowDate.getUTCFullYear();

  /* Identità visiva */
  const id = { issues: [], passed: [], section: null };
  const fontNames = x.fonts.map((f) => f.name);
  const fonts = fontNames.length;
  const fam = x.colors.families;
  const faviconOk = x.favicon.ok;
  const noData = x.cssFiles === 0 && fonts === 0 && x.colors.distinct === 0;

  const rows = [];
  if (!noData) {
    rows.push(row('Font diversi usati', String(fonts), fonts <= 2 ? 'ok' : fonts === 3 ? 'warn' : 'bad', fonts ? fontNames.slice(0, 6).join(', ') + (fonts > 6 ? '…' : '') : 'Il sito usa i caratteri di sistema.'));
    rows.push(row('Famiglie di colore (esclusi bianco, nero e grigi)', String(fam), fam <= 3 ? 'ok' : fam <= 5 ? 'warn' : 'bad',
      `${x.colors.distinct} colori diversi nel CSS; qui i più usati.`, { swatches: x.colors.top.map((c) => ({ hex: c.hex })) }));
  }
  rows.push(row('Icona del sito (favicon)', faviconOk ? 'Presente' : 'Mancante', faviconOk ? 'ok' : 'bad', 'La piccola icona nella scheda del browser e nei preferiti.'));

  const bad = (fonts >= 4 ? 1 : 0) + (fam >= 6 ? 1 : 0) + (faviconOk ? 0 : 1);
  const warn = (fonts === 3 ? 1 : 0) + (fam >= 4 && fam <= 5 ? 1 : 0);
  const coherence = noData ? null : bad + warn === 0 ? 'Coerente' : bad >= 2 || bad + warn >= 3 ? 'Dispersiva' : 'Da ordinare';
  if (coherence) rows.push(row('Coerenza generale', coherence, coherence === 'Coerente' ? 'ok' : coherence === 'Da ordinare' ? 'warn' : 'bad', 'Sintesi dei tre controlli qui sopra.'));

  if (!noData) {
    if (fonts >= 3) {
      id.issues.push({
        id: 'fonts', area: 'identity', severity: fonts >= 4 ? 'media' : 'bassa',
        title: `Il sito usa ${fonts} font diversi`,
        meaning: `Nel CSS ho contato ${fonts} famiglie di caratteri: ${fontNames.slice(0, 5).join(', ')}. Una parte può arrivare da plugin che caricano font anche se poco usati.`,
        why: 'Troppi caratteri danno un aspetto improvvisato. Un marchio riconoscibile ne usa uno o due, sempre quelli.',
        fix: 'Si scelgono due font, uno per i titoli e uno per i testi, e si impostano una volta sola nello stile globale del sito.',
        impact: fonts * 3,
      });
    } else id.passed.push('Pochi font, scelti con criterio');
    if (fam >= 4) {
      id.issues.push({
        id: 'palette', area: 'identity', severity: fam >= 6 ? 'media' : 'bassa',
        title: `La palette ha ${fam} famiglie di colore`,
        meaning: `Nel CSS compaiono ${fam} tinte diverse usate più volte (${x.colors.distinct} colori in totale, esclusi bianco, nero e grigi). È una stima: temi e plugin possono aggiungere colori.`,
        why: 'Con troppi colori il sito perde carattere e non resta in mente. Una palette ristretta fa riconoscere il marchio a colpo d’occhio.',
        fix: 'Si definiscono un colore principale, uno di accento e i neutri, e si usano solo quelli, anche come colori globali di Elementor.',
        impact: fam * 3,
      });
    } else if (fam > 0) id.passed.push('Palette di colori contenuta');
  }
  if (!faviconOk) {
    id.issues.push({
      id: 'favicon', area: 'identity', severity: 'media',
      title: 'Manca l’icona del sito (favicon)',
      meaning: 'Nella scheda del browser e nei preferiti il sito appare con un’icona generica.',
      why: 'È il dettaglio più piccolo del marchio, ma compare in ogni scheda aperta. Il suo vuoto fa sembrare il sito non finito.',
      fix: 'Si carica un’icona quadrata (almeno 512 px) da Aspetto > Personalizza > Identità del sito.',
      impact: 14,
    });
  } else id.passed.push('Icona del sito (favicon) presente');

  id.section = {
    id: 'identity', name: 'Identità visiva',
    intro: 'Misurata leggendo il CSS del sito: numeri, non opinioni. È una stima, perché temi e plugin possono aggiungere regole che non si vedono a occhio.',
    rows,
  };

  /* Segnali di abbandono */
  const care = { issues: [], passed: [], section: null };
  const crows = [];
  if (x.year) {
    const old = year - x.year;
    crows.push(row('Anno nel footer', String(x.year), old <= 0 ? 'ok' : old === 1 ? 'warn' : 'bad'));
    if (old >= 1) {
      care.issues.push({
        id: 'copyright', area: 'care', severity: old >= 2 ? 'media' : 'bassa',
        title: `Il footer è fermo al ${x.year}`,
        meaning: `In fondo alla pagina c’è scritto © ${x.year}, ma siamo nel ${year}.`,
        why: 'Chi vede un anno vecchio pensa che il sito sia abbandonato, e che anche l’attività lo sia. È un piccolo segnale con un effetto sproporzionato.',
        fix: 'Si sostituisce l’anno scritto a mano con uno automatico, che si aggiorna da solo ogni gennaio.',
        impact: old * 8,
      });
    } else care.passed.push('Anno nel footer aggiornato');
  } else crows.push(row('Anno nel footer', 'Non trovato', 'na'));

  const monthsAgo = (iso) => (now - Date.parse(iso)) / (30.44 * 86400000);
  const fmtMonth = (iso) => new Date(iso).toLocaleDateString('it-IT', { month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });
  const ago = (m) => (m >= 24 ? `circa ${Math.floor(m / 12)} anni` : `circa ${Math.round(m)} mesi`);

  if (x.lastPost && x.lastPost.date) {
    const m = monthsAgo(x.lastPost.date);
    crows.push(row('Ultimo articolo pubblicato', fmtMonth(x.lastPost.date), m >= 24 ? 'bad' : m >= 12 ? 'warn' : 'ok', 'Letto dal feed del sito.'));
    if (m >= 12) {
      care.issues.push({
        id: 'last-post', area: 'care', severity: m >= 24 ? 'media' : 'bassa',
        title: `L’ultimo articolo del blog risale a ${fmtMonth(x.lastPost.date)}`,
        meaning: `Il blog del sito non riceve nuovi articoli da ${ago(m)}.`,
        why: 'Un blog fermo fa pensare che anche l’attività si sia fermata: chi arriva guarda la data dell’ultimo articolo prima ancora di leggerlo. E Google preferisce i siti che vede vivi.',
        fix: 'Si pubblica ogni tanto, anche solo un articolo a trimestre. Se non c’è tempo per curarlo, meglio togliere il blog dal menu o nascondere le date.',
        impact: Math.min(30, m / 2),
      });
    } else care.passed.push('Blog aggiornato di recente');
  }

  if (x.lastModified) {
    const m = monthsAgo(x.lastModified);
    crows.push(row('Ultima modifica dichiarata dal server', fmtMonth(x.lastModified), m >= 24 ? 'warn' : 'ok',
      'Dato fornito dal server: sui siti WordPress con cache può essere la data di creazione della cache, quindi è solo un indizio.'));
    if (m >= 24) {
      care.issues.push({
        id: 'last-modified', area: 'care', severity: 'bassa',
        title: `Il server dichiara che la home non cambia da ${fmtMonth(x.lastModified)}`,
        meaning: `Nell’intestazione della pagina il server indica come ultima modifica ${fmtMonth(x.lastModified)}, cioè ${ago(m)} fa.`,
        why: 'È un indizio, non una prova: ma se è vero, significa che nessuno tocca la home da anni, e i visitatori se ne accorgono dai contenuti datati.',
        fix: 'Si rivedono testi, foto, prezzi e contatti della home almeno una volta l’anno, anche senza cambiare la grafica.',
        impact: 6,
      });
    }
  }

  if (x.php) {
    const end = phpSupportEnd(x.php);
    const monthsLeft = end ? (Date.parse(end) - now) / (30.44 * 86400000) : null;
    const status = monthsLeft === null ? 'na' : monthsLeft < 0 ? 'bad' : monthsLeft < 6 ? 'warn' : 'ok';
    crows.push(row('Versione di PHP', 'PHP ' + x.php, status, 'Dichiarata dal server.'));
    if (monthsLeft !== null && monthsLeft < 6) {
      const endTxt = fmtMonth(end);
      const expired = monthsLeft < 0;
      care.issues.push({
        id: 'php-version', area: 'care', severity: expired ? 'media' : 'bassa',
        title: expired ? `PHP ${x.php} è fuori dal supporto ufficiale` : `PHP ${x.php} smette di essere aggiornato a ${endTxt}`,
        meaning: expired
          ? `Il sito dichiara di girare su PHP ${x.php}, la cui assistenza di sicurezza ufficiale è finita a ${endTxt}.`
          : `Il sito gira su PHP ${x.php}, che riceverà correzioni di sicurezza solo fino a ${endTxt}.`,
        why: 'Una versione di PHP fuori supporto lascia aperte falle che il progetto PHP non chiuderà più, e prima o poi plugin e tema smettono di funzionare con essa. Alcuni hosting offrono correzioni proprie anche per le versioni vecchie (supporto esteso): se è il tuo caso, il rischio è minore.',
        fix: 'Chiedi al tuo hosting se la versione è ancora aggiornata da loro, oppure cambiala dal pannello (di solito è un menu). Prima si prova su una copia, perché plugin molto vecchi possono non reggere.',
        impact: expired ? 22 : 8,
      });
    } else if (monthsLeft !== null) care.passed.push('Versione di PHP supportata');
  }

  if (x.wp.detected) {
    if (x.wp.version) {
      const behind = x.wp.latest ? releasesBehind(x.wp.version, x.wp.latest) : null;
      crows.push(row('Versione di WordPress', x.wp.version, behind === null ? 'na' : behind >= 4 ? 'bad' : behind >= 2 ? 'warn' : 'ok', x.wp.latest ? `L’ultima disponibile è la ${x.wp.latest}.` : undefined));
      if (behind !== null && behind >= 2) {
        care.issues.push({
          id: 'wp-version', area: 'care', severity: behind >= 4 ? 'alta' : 'media',
          title: `WordPress è fermo alla versione ${x.wp.version}`,
          meaning: `Il sito usa la ${x.wp.version}; l’ultima disponibile è la ${x.wp.latest}. Le versioni vecchie smettono di ricevere gli aggiornamenti di sicurezza.`,
          why: 'Un sito non aggiornato è il bersaglio preferito di chi cerca falle da sfruttare. Il rischio è trovarsi il sito bloccato, o con pubblicità non sua, proprio quando serve.',
          fix: 'Si fa un backup, si aggiornano WordPress, tema e plugin (meglio prima su una copia di prova) e si programmano gli aggiornamenti periodici.',
          impact: behind * 5,
        });
      } else if (behind !== null) care.passed.push('WordPress aggiornato');
    } else crows.push(row('Versione di WordPress', 'Nascosta', 'na', 'Il sito usa WordPress ma non ne dichiara la versione, ed è una buona pratica.'));

    for (const t of x.wp.themes.slice(0, 1)) {
      const label = t.name || t.slug;
      const behind = t.version && t.latest ? releasesBehind(t.version, t.latest) : null;
      let years = null;
      if (t.lastUpdated) { const d = Date.parse(t.lastUpdated); if (Number.isFinite(d)) years = (now - d) / (365.25 * 86400000); }
      crows.push(row('Tema', t.version ? `${label} ${t.version}` : label, (behind > 0 || years >= 2) ? 'warn' : 'ok',
        t.latest ? `Ultima versione sul repository di WordPress: ${t.latest}.` : 'Tema personalizzato o a pagamento: non posso confrontarlo con la versione più recente.'));
      if (years !== null && years >= 2) {
        care.issues.push({
          id: 'theme-stale', area: 'care', severity: 'media',
          title: `Il tema “${label}” non riceve aggiornamenti da ${Math.floor(years)} anni`,
          meaning: `L’ultimo aggiornamento del tema sul repository di WordPress risale a più di ${Math.floor(years)} anni fa.`,
          why: 'Un tema abbandonato dal suo autore non viene più corretto: errori e falle di sicurezza restano lì, e prima o poi smette di funzionare con le nuove versioni di WordPress.',
          fix: 'Conviene valutare un tema mantenuto, o un tema su misura: il passaggio si fa senza perdere i contenuti.',
          impact: 20,
        });
      } else if (behind !== null && behind > 0) {
        care.issues.push({
          id: 'theme-outdated', area: 'care', severity: 'bassa',
          title: `Il tema “${label}” non è aggiornato`,
          meaning: `Il sito usa la versione ${t.version}; l’ultima è la ${t.latest}.`,
          why: 'Gli aggiornamenti del tema correggono errori e falle e tengono il sito compatibile con WordPress.',
          fix: 'Dopo un backup, si aggiorna il tema dalla bacheca di WordPress (o da un tema figlio, se ne usi uno).',
          impact: 8,
        });
      } else if (t.org && behind === 0) care.passed.push('Tema aggiornato');
    }
  }
  if (crows.length) {
    care.section = {
      id: 'care', name: 'Segnali di abbandono',
      intro: 'Piccoli indizi che dicono a chi visita (e a Google) se dietro al sito c’è qualcuno che se ne occupa.',
      rows: crows,
    };
  }
  return [id, care];
}
