// Dai fatti raccolti al report: punteggi, problemi, testi in italiano.
// Tutta la "voce" del report sta qui, così le due versioni del frontend mostrano gli stessi testi.

const SEV = { alta: 3, media: 2, bassa: 1 };

const sec = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' s';
const mb = (bytes) => (bytes / 1048576).toFixed(1).replace('.', ',') + ' MB';
const kb = (bytes) => Math.round(bytes / 1024) + ' KB';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

/** Media pesata che ignora i valori mancanti (null). */
export function wavg(items) {
  let w = 0;
  let s = 0;
  for (const { w: weight, v } of items) {
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    w += weight;
    s += weight * v;
  }
  return w ? clamp(s / w) : null;
}

function issue(id, area, severity, title, meaning, why, fix, impact = 0) {
  return { id, area, severity, title, meaning, why, fix, impact };
}

const row = (label, value, status, hint) => ({ label, value, status, ...(hint ? { hint } : {}) });

/* ───────────────────────── VELOCITÀ ───────────────────────── */

function speedArea(mobile, desktop) {
  const issues = [];
  const passed = [];
  const rows = [];
  const m = mobile.scores.performance;
  const d = desktop ? desktop.scores.performance : null;
  const score = wavg([{ w: 0.7, v: m }, { w: 0.3, v: d }]);

  rows.push(row('Velocità da telefono', `${m}/100`, m >= 90 ? 'ok' : m >= 50 ? 'warn' : 'bad', 'Il punteggio che Google dà alla velocità da smartphone.'));
  if (d !== null) rows.push(row('Velocità da computer', `${d}/100`, d >= 90 ? 'ok' : d >= 50 ? 'warn' : 'bad'));

  if (m < 90) {
    const sev = m < 50 ? 'alta' : m < 75 ? 'media' : 'bassa';
    issues.push(issue('speed-mobile', 'speed', sev,
      m < 50 ? 'Il sito è lento da telefono' : 'Da telefono il sito potrebbe essere più veloce',
      `Nel test di Google la velocità da smartphone è ${m} su 100. Sopra 90 si considera buona.`,
      'Quasi tutte le visite arrivano da telefono, e chi aspetta qualche secondo di troppo se ne va. Google, inoltre, tiene conto della velocità per posizionare il sito.',
      'Di solito si risolve alleggerendo le immagini, togliendo script e plugin inutili e attivando una cache.',
      100 - m));
  } else passed.push('Velocità da telefono buona');

  if (d !== null && d < 75) {
    issues.push(issue('speed-desktop', 'speed', d < 50 ? 'media' : 'bassa',
      'Anche da computer il sito è meno rapido del dovuto',
      `Nel test da computer il punteggio è ${d} su 100.`,
      'Chi cerca da ufficio o da casa si aspetta una pagina istantanea. Se esita, apre il sito del concorrente.',
      'Gli interventi sono gli stessi del telefono: immagini più leggere, meno script, una buona cache.',
      (100 - d) / 2));
  }

  const { lcp, cls, tbt, ttfb } = mobile.metrics;
  if (lcp !== null) {
    rows.push(row('Quando compare il contenuto principale (LCP)', sec(lcp), lcp <= 2500 ? 'ok' : lcp <= 4000 ? 'warn' : 'bad',
      "Dopo quanto tempo si vede l'elemento più grande della pagina, di solito la foto in alto. Meglio sotto i 2,5 secondi."));
    if (lcp > 2500) {
      issues.push(issue('lcp', 'speed', lcp > 4000 ? 'alta' : 'media',
        `Il contenuto principale compare dopo ${sec(lcp)}`,
        "È il tempo che passa prima di vedere l'elemento più grande della pagina, in genere l'immagine in alto. Google lo chiama LCP e considera buono un valore sotto i 2,5 secondi.",
        'Nei primi secondi il visitatore decide se restare. Una pagina che resta vuota o a metà lo perde prima ancora che legga la tua offerta.',
        "Si comprime l'immagine principale, si evita di caricarla in ritardo e si sceglie un hosting più veloce.",
        Math.min(60, lcp / 100)));
    } else passed.push('Il contenuto principale compare in fretta');
  }
  if (cls !== null) {
    rows.push(row('La pagina si muove mentre carica (CLS)', cls.toFixed(2).replace('.', ','), cls <= 0.1 ? 'ok' : cls <= 0.25 ? 'warn' : 'bad',
      'Misura quanto gli elementi si spostano da soli durante il caricamento. Meglio sotto 0,1.'));
    if (cls > 0.1) {
      issues.push(issue('cls', 'speed', cls > 0.25 ? 'alta' : 'media',
        'La pagina si sposta mentre si carica',
        `Testi e pulsanti cambiano posizione mentre la pagina compare (valore ${cls.toFixed(2).replace('.', ',')}; sotto 0,1 è buono). Google lo chiama CLS.`,
        'È il motivo per cui a volte tocchi un pulsante e finisci su un altro. Infastidisce chi visita e può costare un contatto.',
        'Si risolve dando a immagini, banner e caratteri uno spazio riservato fin dall’inizio.',
        cls * 40));
    } else passed.push('La pagina non si sposta durante il caricamento');
  }
  if (tbt !== null && tbt > 300) {
    issues.push(issue('tbt', 'speed', tbt > 600 ? 'media' : 'bassa',
      'Il telefono resta "bloccato" per un attimo prima di rispondere ai tocchi',
      `Per circa ${Math.round(tbt)} millisecondi la pagina è occupata a eseguire script e non risponde.`,
      'Se tocchi un menu e non succede nulla, pensi che il sito sia rotto.',
      'Si riducono i plugin e gli script di terze parti (chat, widget, tracciamenti) che non servono davvero.',
      Math.min(30, tbt / 40)));
  }
  if (ttfb !== null && ttfb > 800) {
    issues.push(issue('ttfb', 'speed', ttfb > 1800 ? 'media' : 'bassa',
      'Il server impiega un po\' a rispondere',
      `Il server impiega circa ${sec(ttfb)} a mandare la prima risposta. Sotto 0,8 secondi è buono.`,
      "È il tempo perso prima che la pagina cominci a caricarsi: tutto il resto parte in ritardo.",
      'Aiutano una cache di pagina, un hosting più reattivo e meno plugin che lavorano a ogni visita.',
      Math.min(25, ttfb / 100)));
  }

  // Immagini
  const im = mobile.images;
  if (im) {
    rows.push(row('Immagini pesanti (oltre 200 KB)', String(im.heavyCount), im.heavyCount === 0 ? 'ok' : 'warn',
      im.heavy.length ? 'Le più grandi: ' + im.heavy.slice(0, 3).map((i) => `${i.name} (${kb(i.bytes)})`).join(', ') : undefined));
    const biggest = im.heavy[0]?.bytes || 0;
    if (im.heavyCount > 0 || im.wastedBytes > 300 * 1024) {
      const sev = biggest >= 1024 * 1024 || im.wastedBytes > 1.5 * 1048576 ? 'alta' : biggest >= 300 * 1024 || im.wastedBytes > 300 * 1024 ? 'media' : 'bassa';
      const list = im.heavy.slice(0, 3).map((i) => `${i.name} (${kb(i.bytes)})`).join(', ');
      issues.push(issue('images', 'speed', sev,
        im.heavyCount > 0 ? `${plural(im.heavyCount, 'immagine troppo pesante', 'immagini troppo pesanti')}` : 'Immagini più pesanti del necessario',
        `${list ? 'Le più pesanti: ' + list + '. ' : ''}${im.wastedBytes > 0 ? `Si potrebbero risparmiare circa ${mb(im.wastedBytes)} senza perdere qualità visibile.` : 'Una foto per il web raramente deve superare i 200 KB.'}`,
        'Le immagini sono la causa più comune di un sito lento. Sul telefono, con la rete mobile, pesano ancora di più.',
        'Si ridimensionano alle misure reali e si convertono in formati moderni come WebP o AVIF, anche in automatico con un plugin.',
        Math.min(50, (im.wastedBytes || biggest) / 40000)));
    } else passed.push('Immagini ben ottimizzate');
  }

  return {
    area: { id: 'speed', name: 'Velocità', score, intro: 'Quanto ci mette la pagina a comparire e a essere utilizzabile.', rows },
    issues,
    passed,
  };
}

/* ───────────────────────── MOBILE ───────────────────────── */

function mobileArea(psiMobile, site) {
  const issues = [];
  const passed = [];
  const rows = [];
  const pm = psiMobile?.mobile;

  const viewportOk = site ? site.seo.viewportOk : pm?.viewport ?? null;
  if (viewportOk !== null) {
    rows.push(row('Pagina adattata allo schermo del telefono', viewportOk ? 'Sì' : 'No', viewportOk ? 'ok' : 'bad',
      'Serve un\'istruzione ("viewport") che dice al telefono di non rimpicciolire la pagina.'));
    if (!viewportOk) {
      issues.push(issue('viewport', 'mobile', 'alta',
        'Il sito non è pensato per gli schermi dei telefoni',
        'Manca l’istruzione che dice al telefono di adattare la pagina allo schermo: si vede la versione da computer rimpicciolita.',
        'Chi arriva da telefono deve ingrandire e scorrere in orizzontale. La maggior parte se ne va.',
        'Si aggiunge l’istruzione viewport e si verifica che il tema sia davvero adattabile (responsive).',
        60));
    } else passed.push('Pagina adattata ai telefoni');
  }

  const zoom = pm?.zoomBlocked ?? (site ? site.seo.zoomBlocked : null);
  if (zoom) {
    rows.push(row('Zoom con le dita consentito', 'No', 'warn'));
    issues.push(issue('zoom', 'mobile', 'bassa',
      'Il sito impedisce di ingrandire con le dita',
      'Nella pagina c’è un blocco allo zoom (pizzica per ingrandire).',
      'Chi vede poco non riesce a leggere i testi piccoli, e il sito risulta meno accessibile.',
      'Si toglie "user-scalable=no" e "maximum-scale" dall’istruzione viewport.',
      8));
  }

  const fails = pm?.targetSizeFails;
  if (fails !== null && fails !== undefined) {
    rows.push(row('Pulsanti e link abbastanza distanziati', fails === 0 ? 'Sì' : `${plural(fails, 'punto', 'punti')} troppo ${fails === 1 ? 'vicino' : 'vicini'}`, fails === 0 ? 'ok' : fails > 3 ? 'bad' : 'warn',
      'Con il dito servono almeno 24 pixel di spazio per toccare senza sbagliare.'));
    if (fails > 0) {
      issues.push(issue('tap-targets', 'mobile', fails > 3 ? 'media' : 'bassa',
        'Alcuni pulsanti e link sono troppo vicini tra loro',
        `Ho trovato ${plural(fails, 'punto', 'punti')} dove è facile toccare l’elemento sbagliato con il dito.`,
        'Un tocco sbagliato su telefono è fastidioso, e una persona infastidita non compila il modulo di contatto.',
        'Si aumentano spazio e dimensione di pulsanti, voci di menu e link ravvicinati.',
        Math.min(25, fails * 3)));
    } else passed.push('Pulsanti ben distanziati');
  }

  const fs = pm?.fontSize;
  if (fs) {
    const good = fs.score >= 0.9;
    rows.push(row('Testo abbastanza grande per il telefono', good ? 'Sì' : 'No', good ? 'ok' : 'warn', fs.displayValue || undefined));
    if (!good) {
      issues.push(issue('font-size', 'mobile', fs.score < 0.6 ? 'media' : 'bassa',
        'Parte del testo è troppo piccola da leggere sul telefono',
        fs.displayValue ? `Google segnala: ${fs.displayValue.replace(/legible text/i, 'testo leggibile')}.` : 'Una parte dei testi è sotto i 12 pixel, la soglia minima di leggibilità sul telefono.',
        'Se bisogna ingrandire per leggere, molti smettono di leggere.',
        'Si porta il testo corrente ad almeno 16 pixel e le note a non meno di 12.',
        Math.min(25, (1 - fs.score) * 40)));
    } else passed.push('Testo leggibile da telefono');
  }

  if (psiMobile?.finalUrl) {
    // niente: lo screenshot è gestito dal frontend
  }

  const targetScore = fails === null || fails === undefined ? null : fails === 0 ? 100 : fails <= 3 ? 65 : fails <= 10 ? 35 : 10;
  const score = wavg([
    { w: 40, v: viewportOk === null ? null : viewportOk ? 100 : 0 },
    { w: 10, v: zoom === null || zoom === undefined ? null : zoom ? 0 : 100 },
    { w: 25, v: targetScore },
    { w: 25, v: fs ? clamp(fs.score * 100) : null },
  ]);

  return {
    area: { id: 'mobile', name: 'Mobile e usabilità', score, intro: 'Come si presenta e come si usa il sito da smartphone.', rows },
    issues,
    passed,
  };
}

/* ───────────────────────── SEO BASE ───────────────────────── */

function seoArea(site) {
  const s = site.seo;
  const issues = [];
  const passed = [];
  const rows = [];
  const pts = [];

  // indicizzazione
  const noindex = s.noindex || s.noindexHeader || s.robotsBlocksAll;
  if (noindex) {
    const why = s.robotsBlocksAll ? 'Il file robots.txt vieta ai motori di ricerca di visitare il sito.' : 'La pagina contiene l’istruzione "noindex".';
    rows.push(row('Visibile ai motori di ricerca', 'No', 'bad'));
    issues.push(issue('noindex', 'seo', 'alta',
      'Il sito chiede a Google di non mostrarlo',
      why,
      'Con questa istruzione il sito non compare nei risultati di ricerca, per quanto sia ben fatto.',
      'In WordPress: Impostazioni > Lettura, togli la spunta a "Scoraggia i motori di ricerca dall’indicizzare questo sito".',
      80));
  } else {
    rows.push(row('Visibile ai motori di ricerca', 'Sì', 'ok'));
    passed.push('Il sito può essere indicizzato da Google');
  }
  pts.push({ w: 15, v: noindex ? 0 : 100 });

  // title
  const tl = s.title.length;
  rows.push(row('Titolo della pagina (title)', s.title ? `${tl} caratteri` : 'Mancante', !s.title ? 'bad' : tl >= 30 && tl <= 65 ? 'ok' : 'warn', s.title ? `“${s.title.slice(0, 90)}${tl > 90 ? '…' : ''}”` : undefined));
  if (!s.title) {
    issues.push(issue('title-missing', 'seo', 'alta', 'La pagina non ha un titolo',
      'Manca il titolo che compare nella scheda del browser e come riga blu su Google.',
      'È la prima cosa che una persona legge nei risultati di ricerca. Senza, Google ne inventa uno e il clic va a qualcun altro.',
      'Si scrive un titolo di 50-60 caratteri con il nome dell’attività e ciò che offri (in WordPress, con Yoast o simili).', 50));
    pts.push({ w: 15, v: 0 });
  } else if (tl < 30 || tl > 65) {
    issues.push(issue('title-length', 'seo', 'bassa',
      tl < 30 ? 'Il titolo della pagina è troppo corto' : 'Il titolo della pagina è troppo lungo',
      `Il titolo è di ${tl} caratteri; Google ne mostra circa 60.${tl > 65 ? ' La parte finale viene tagliata.' : ' Resta spazio per dire di più.'}`,
      'Il titolo è lo spazio più importante nei risultati di ricerca: tagliato o vago, convince meno.',
      'Si riscrive con 50-60 caratteri, mettendo all’inizio ciò che cerca chi ti vuole trovare.', 12));
    pts.push({ w: 15, v: 55 });
  } else { passed.push('Titolo della pagina scritto bene'); pts.push({ w: 15, v: 100 }); }

  // description
  const dl = s.description.length;
  rows.push(row('Descrizione per Google (meta description)', s.description ? `${dl} caratteri` : 'Mancante', !s.description ? 'warn' : dl >= 70 && dl <= 165 ? 'ok' : 'warn'));
  if (!s.description) {
    issues.push(issue('desc-missing', 'seo', 'media', 'Manca la descrizione per Google',
      'La pagina non ha la breve descrizione che Google mostra sotto il titolo.',
      'Senza, Google pesca un pezzo di testo a caso. Una descrizione scritta bene fa cliccare di più.',
      'Si scrivono 120-155 caratteri che spiegano cosa offri e a chi.', 25));
    pts.push({ w: 15, v: 0 });
  } else if (dl < 70 || dl > 165) {
    issues.push(issue('desc-length', 'seo', 'bassa', 'La descrizione per Google è da sistemare',
      `La descrizione è di ${dl} caratteri; l’ideale è tra 120 e 155.`,
      'Troppo corta spreca spazio, troppo lunga viene tagliata a metà frase.',
      'Si riscrive in 120-155 caratteri, con un invito chiaro a cliccare.', 8));
    pts.push({ w: 15, v: 60 });
  } else { passed.push('Descrizione per Google presente'); pts.push({ w: 15, v: 100 }); }

  // H1
  rows.push(row('Titolo principale in pagina (H1)', s.h1Count === 0 ? 'Mancante' : s.h1Count === 1 ? 'Uno solo' : `${s.h1Count} titoli`, s.h1Count === 1 ? 'ok' : 'warn',
    s.h1Texts[0] ? `“${s.h1Texts[0].slice(0, 90)}”` : undefined));
  if (s.h1Count === 0) {
    issues.push(issue('h1-missing', 'seo', 'media', 'Manca il titolo principale della pagina',
      'Nel testo della pagina non c’è un titolo di primo livello (H1).',
      'È il titolo che dice a chi arriva, e a Google, di cosa parla la pagina.',
      'Si imposta un solo titolo principale, con la parola che i clienti cercano davvero.', 25));
    pts.push({ w: 12, v: 0 });
  } else if (s.h1Count > 1) {
    issues.push(issue('h1-many', 'seo', 'bassa', `Ci sono ${s.h1Count} titoli principali invece di uno`,
      'La pagina ha più titoli di primo livello (H1). Capita spesso con i temi che usano il titolo anche per logo o sezioni.',
      'La pagina dovrebbe avere un solo argomento chiaro. Con più titoli principali il messaggio si confonde.',
      'Si lascia un solo H1 e gli altri diventano titoli di secondo livello (H2).', 10));
    pts.push({ w: 12, v: 50 });
  } else { passed.push('Un solo titolo principale (H1)'); pts.push({ w: 12, v: 100 }); }

  // alt immagini
  if (s.imgTotal > 0) {
    const ratio = s.imgNoAlt / s.imgTotal;
    rows.push(row('Immagini con testo alternativo', `${s.imgTotal - s.imgNoAlt} su ${s.imgTotal}`, s.imgNoAlt === 0 ? 'ok' : ratio > 0.3 ? 'bad' : 'warn'));
    if (s.imgNoAlt > 0) {
      issues.push(issue('img-alt', 'seo', ratio > 0.3 ? 'media' : 'bassa',
        `${plural(s.imgNoAlt, 'immagine senza descrizione', 'immagini senza descrizione')} (su ${s.imgTotal})`,
        'Alle immagini manca il testo alternativo (alt): la breve frase che descrive cosa si vede.',
        'Google lo usa per capire le foto e per mostrarle in Google Immagini. Chi usa un lettore di schermo, senza, non sa cosa c’è.',
        'Si scrive una descrizione breve per ogni immagine che porta informazione, dalla libreria media di WordPress.',
        Math.min(30, 8 + ratio * 25)));
    } else passed.push('Tutte le immagini hanno il testo alternativo');
    pts.push({ w: 12, v: s.imgNoAlt === 0 ? 100 : ratio <= 0.1 ? 75 : ratio <= 0.3 ? 40 : 0 });
  } else pts.push({ w: 12, v: 100 });

  // sitemap & robots
  rows.push(row('Mappa del sito (sitemap)', s.sitemap ? 'Presente' : 'Non trovata', s.sitemap ? 'ok' : 'warn'));
  if (!s.sitemap) {
    issues.push(issue('sitemap', 'seo', 'media', 'Non ho trovato la mappa del sito (sitemap)',
      'Manca il file che elenca le pagine del sito per i motori di ricerca.',
      'Aiuta Google a scoprire tutte le pagine, soprattutto quelle nuove.',
      'Con Yoast, Rank Math o WordPress stesso si attiva in un clic; poi si segnala a Google Search Console.', 20));
  } else passed.push('Mappa del sito presente');
  pts.push({ w: 10, v: s.sitemap ? 100 : 0 });

  rows.push(row('File robots.txt', s.robotsTxt ? 'Presente' : 'Non trovato', s.robotsTxt ? 'ok' : 'warn'));
  if (!s.robotsTxt) {
    issues.push(issue('robots', 'seo', 'bassa', 'Manca il file robots.txt',
      'Non ho trovato il file che indica ai motori di ricerca cosa visitare.',
      'Non è obbligatorio, ma è il posto giusto per indicare dov’è la sitemap e per tenere fuori le aree private.',
      'WordPress ne crea uno automatico; si può completare con Yoast o a mano.', 6));
  }
  pts.push({ w: 6, v: s.robotsTxt ? 100 : 40 });

  // Open Graph
  const ogCount = ['title', 'description', 'image'].filter((k) => s.og[k]).length;
  rows.push(row('Anteprima sui social (Open Graph)', ogCount === 3 ? 'Completa' : ogCount === 0 ? 'Assente' : 'Incompleta', ogCount === 3 ? 'ok' : 'warn',
    'L’immagine e il testo che compaiono quando condividi il link su WhatsApp, Facebook o LinkedIn.'));
  if (ogCount < 3) {
    const missing = [!s.og.title && 'titolo', !s.og.description && 'descrizione', !s.og.image && 'immagine'].filter(Boolean).join(', ');
    issues.push(issue('og', 'seo', 'bassa', ogCount === 0 ? 'Il sito non ha un’anteprima per i social' : 'L’anteprima sui social è incompleta',
      `Quando il link viene condiviso su WhatsApp o sui social, ${ogCount === 0 ? 'non c’è un’anteprima curata' : 'manca: ' + missing}.`,
      'Un link con anteprima curata viene aperto più spesso e dà un’impressione più professionale.',
      'Si impostano titolo, descrizione e immagine di condivisione (Yoast lo permette pagina per pagina).', 10));
  } else passed.push('Anteprima social completa');
  pts.push({ w: 10, v: ogCount === 3 ? 100 : ogCount === 0 ? 0 : 50 });

  // canonical
  if (!s.canonical) {
    issues.push(issue('canonical', 'seo', 'bassa', 'Manca l’indirizzo "canonico" della pagina',
      'Non c’è l’indicazione che dice a Google qual è l’indirizzo ufficiale della pagina.',
      'Evita che la stessa pagina, raggiungibile con più indirizzi, venga contata come più pagine uguali.',
      'Yoast e Rank Math lo aggiungono da soli; di solito basta attivarli.', 5));
  }
  pts.push({ w: 5, v: s.canonical ? 100 : 50 });

  return {
    area: { id: 'seo', name: 'SEO base', score: wavg(pts), intro: 'Quanto è chiaro, per Google e per chi cerca, di cosa parla il sito.', rows },
    issues,
    passed,
  };
}

/* ───────────────────── ACCESSIBILITÀ E SICUREZZA ───────────────────── */

const A11Y_CONTRAST = ['color-contrast'];
const A11Y_NAMES = ['button-name', 'link-name', 'label', 'aria-input-field-name', 'select-name', 'input-image-alt', 'aria-command-name'];
const A11Y_LANG = ['html-has-lang', 'html-lang-valid'];

function trustArea(psiMobile, site, ssl) {
  const issues = [];
  const passed = [];
  const rows = [];

  // accessibilità (da Lighthouse)
  const a11y = psiMobile?.scores?.accessibility ?? null;
  if (a11y !== null) {
    rows.push(row('Accessibilità (punteggio Google)', `${a11y}/100`, a11y >= 90 ? 'ok' : a11y >= 70 ? 'warn' : 'bad',
      'Quanto il sito è utilizzabile da chi vede poco, usa lo screen reader o naviga da tastiera.'));
    const fails = psiMobile.a11yFails || [];
    const has = (ids) => fails.filter((f) => ids.includes(f.id));
    const contrast = has(A11Y_CONTRAST);
    const names = has(A11Y_NAMES);
    const lang = has(A11Y_LANG);
    const rest = fails.filter((f) => ![...A11Y_CONTRAST, ...A11Y_NAMES, ...A11Y_LANG, 'image-alt'].includes(f.id));

    if (contrast.length) {
      const n = contrast.reduce((s, f) => s + f.n, 0);
      issues.push(issue('a11y-contrast', 'trust', 'media', 'Alcuni testi si leggono male per il poco contrasto',
        `Il colore del testo è troppo simile a quello dello sfondo in ${plural(n, 'punto', 'punti')}.`,
        'Non solo chi vede poco: anche chiunque legga da telefono sotto il sole fa fatica. Testo illeggibile, offerta persa.',
        'Si scurisce il testo o si schiarisce lo sfondo: spesso bastano pochi ritocchi ai colori.', 30));
    }
    if (names.length) {
      issues.push(issue('a11y-names', 'trust', 'media', 'Pulsanti, link o campi dei moduli senza un nome comprensibile',
        'Per chi usa uno screen reader, alcuni pulsanti o campi non hanno un’etichetta: sa che c’è qualcosa, ma non cosa fa.',
        'Se un modulo di contatto non è comprensibile per tutti, perdi contatti. In alcuni casi l’accessibilità è anche un obbligo di legge.',
        'Si aggiungono etichette testuali (o l’attributo aria-label) a pulsanti, link e campi.', 22));
    }
    if (lang.length) {
      issues.push(issue('a11y-lang', 'trust', 'bassa', 'La lingua della pagina non è indicata',
        'Nel codice manca l’indicazione che il sito è in italiano.',
        'Browser, traduttori e lettori vocali la usano per pronunciare e proporre il testo giusto.',
        'In WordPress: Impostazioni > Generale > Lingua del sito: Italiano.', 6));
    }
    if (rest.length && a11y < 90) {
      issues.push(issue('a11y-other', 'trust', a11y < 70 ? 'media' : 'bassa', `Altri ${plural(rest.length, 'controllo di accessibilità', 'controlli di accessibilità')} da rivedere`,
        'Google segnala altri punti che rendono il sito meno comodo per chi ha difficoltà visive o motorie.',
        'Un sito accessibile si legge meglio per tutti, ed è più solido per Google.',
        'Si correggono caso per caso: con il report completo di Google è un lavoro di qualche ora.', Math.min(20, rest.length * 3)));
    }
    if (a11y >= 90) passed.push('Buona accessibilità');
  }

  // sicurezza
  const https = site.https;
  rows.push(row('Connessione sicura (HTTPS)', https ? 'Attiva' : 'Non attiva', https ? 'ok' : 'bad'));
  if (!https) {
    issues.push(issue('https', 'trust', 'alta', 'Il sito non usa una connessione sicura (HTTPS)',
      'L’indirizzo comincia con http invece di https: il browser scrive "Non sicuro" accanto al nome del sito.',
      'Chi visita vede un avviso prima ancora di leggere, e a un modulo di contatto "non sicuro" nessuno dà la propria email.',
      'Si attiva il certificato SSL dal pannello dell’hosting (spesso è gratuito) e si imposta il reindirizzamento.', 70));
  } else passed.push('Connessione sicura (HTTPS) attiva');

  if (https && site.httpToHttps === false) {
    rows.push(row('Il vecchio indirizzo http porta a https', 'No', 'warn'));
    issues.push(issue('http-redirect', 'trust', 'media', 'Il sito è raggiungibile anche nella versione non sicura',
      'Chi scrive l’indirizzo con http:// resta sulla versione senza protezione, invece di essere portato su https://.',
      'Alcune persone arrivano da vecchi link o segnalibri: meglio che trovino sempre la versione sicura. Per Google sono due siti diversi.',
      'Si imposta il reindirizzamento permanente da http a https (di solito basta un’opzione del plugin di sicurezza o dell’hosting).', 25));
  } else if (https && site.httpToHttps === true) {
    rows.push(row('Il vecchio indirizzo http porta a https', 'Sì', 'ok'));
  }

  let certScore = null;
  if (https && ssl && ssl.known && !(ssl.daysLeft < 0)) {
    // se il sito si apre in https il certificato è valido oggi: un valore "scaduto" sarebbe un dato obsoleto del registro
    const d = ssl.daysLeft;
    certScore = d > 30 ? 100 : d > 14 ? 60 : 20;
    rows.push(row('Scadenza del certificato SSL', `tra ${plural(d, 'giorno', 'giorni')}`, d > 30 ? 'ok' : d > 14 ? 'warn' : 'bad',
      `Scade il ${new Date(ssl.notAfter).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' })}.`));
    if (d <= 30) {
      issues.push(issue('ssl-expiry', 'trust', d <= 14 ? 'alta' : 'media', `Il certificato di sicurezza scade tra ${plural(d, 'giorno', 'giorni')}`,
        'Il certificato SSL è quello che permette la connessione sicura, e ha una scadenza. Dopo, i browser bloccano il sito con un avviso a tutta pagina.',
        'Un sito che mostra "connessione non privata" smette di ricevere visite e richieste.',
        'Controlla che il rinnovo automatico sia attivo sull’hosting, oppure rinnovalo a mano.', d <= 14 ? 65 : 30));
    } else passed.push('Certificato SSL lontano dalla scadenza');
  } else if (https) {
    rows.push(row('Scadenza del certificato SSL', 'Non verificabile', 'na', 'Non sono riuscito a leggerla dai registri pubblici: nessun problema evidente, il sito si apre in modo sicuro.'));
  }

  if (https && site.mixedContent > 0) {
    issues.push(issue('mixed', 'trust', 'media', 'Alcuni elementi della pagina arrivano da una connessione non sicura',
      `Ho trovato ${plural(site.mixedContent, 'elemento', 'elementi')} (immagini, script o altro) caricati con http:// dentro una pagina https.`,
      'Il browser può bloccarli o togliere il lucchetto, e il sito sembra meno affidabile.',
      'Si aggiornano i link da http:// a https:// (un plugin di ricerca e sostituzione fa il lavoro in pochi minuti).', 25));
  }

  const { trackers, banner } = site.cookies;
  const cookieOk = banner || !trackers;
  rows.push(row('Avviso sui cookie', banner ? 'Presente' : trackers ? 'Non rilevato' : 'Non necessario', cookieOk ? 'ok' : 'warn',
    banner ? undefined : trackers ? 'Il sito usa strumenti di tracciamento (come Google Analytics o Meta Pixel).' : 'Non ho trovato strumenti di tracciamento.'));
  if (!cookieOk) {
    issues.push(issue('cookie', 'trust', 'media', 'Non ho trovato un avviso sui cookie, ma il sito usa strumenti di tracciamento',
      'Nel codice ci sono strumenti come Google Analytics o Meta Pixel, e non ho rilevato un sistema per chiedere il consenso. Se il tuo banner si carica in modo insolito, potrei non averlo visto.',
      'In Europa il consenso va chiesto prima di attivare questi strumenti. È un tema di legge, ma anche di fiducia: un sito in regola è un sito più credibile.',
      'Si installa un sistema di gestione del consenso (cookie banner) configurato per bloccare gli script finché l’utente non accetta.', 28));
  } else if (banner) passed.push('Avviso sui cookie presente');

  const score = wavg([
    { w: 50, v: a11y },
    { w: 50, v: wavg([
      { w: 40, v: https ? 100 : 0 },
      { w: 10, v: https && site.httpToHttps !== null ? (site.httpToHttps ? 100 : 30) : null },
      { w: 20, v: certScore },
      { w: 20, v: cookieOk ? 100 : 30 },
      { w: 10, v: https ? (site.mixedContent > 0 ? 40 : 100) : null },
    ]) },
  ]);

  return {
    area: { id: 'trust', name: 'Accessibilità e sicurezza', score, intro: 'Se il sito è utilizzabile da tutti e se chi lo visita può fidarsi.', rows },
    issues,
    passed,
  };
}

/* ───────────────────────── REPORT COMPLETO ───────────────────────── */

const WEIGHTS = { speed: 0.3, mobile: 0.2, seo: 0.25, trust: 0.25 };

export function labelFor(score) {
  if (score >= 80) return { key: 'buona', text: 'Sito in buona forma' };
  if (score >= 50) return { key: 'rinforzare', text: 'Sito da rinforzare' };
  return { key: 'rifare', text: 'Sito da rifare' };
}

function summaryFor(label, score, issues) {
  const top = issues.filter((i) => i.severity !== 'bassa').slice(0, 2).map((i) => i.title.charAt(0).toLowerCase() + i.title.slice(1));
  const tops = top.length ? top.join('; ') : null;
  const urgent = issues.some((i) => i.severity === 'alta');
  if (label.key === 'buona' && urgent) {
    return `Nel complesso il sito è in buona forma, ma ${tops ? `c’è almeno un punto da sistemare presto: ${tops}` : 'c’è almeno un punto da sistemare presto'}. Il resto sono rifiniture.`;
  }
  if (label.key === 'buona') {
    return issues.length
      ? `Il sito è in buona forma: le basi ci sono. Restano ${plural(issues.length, 'dettaglio', 'dettagli')} da rifinire, elencati qui sotto in ordine di utilità.`
      : 'Il sito è in buona forma e non ho trovato problemi rilevanti. Complimenti: è una cosa meno comune di quanto sembri.';
  }
  if (label.key === 'rinforzare') {
    return `Il sito funziona, ma ci sono margini di miglioramento concreti${tops ? `. Partirei da qui: ${tops}` : ''}. Sono interventi che si fanno, e che si notano.`;
  }
  return `Oggi il sito fa fatica su più fronti${tops ? `, in particolare: ${tops}` : ''}. Non è una condanna: con gli interventi giusti si recupera molto. Conviene capire se sistemarlo punto per punto o rifarlo.`;
}

/**
 * @param steps  { psiMobile, psiDesktop, site, ssl }  ognuno {ok:true,data} | {ok:false,error}
 */
export function buildReport({ steps, now = Date.now(), extras = [] }) {
  const mobile = steps.psiMobile?.ok ? steps.psiMobile.data : null;
  const desktop = steps.psiDesktop?.ok ? steps.psiDesktop.data : null;
  const site = steps.site?.ok ? steps.site.data : null;
  const ssl = steps.ssl?.ok ? steps.ssl.data : null;

  const parts = [];
  if (mobile) parts.push(speedArea(mobile, desktop));
  if (site || mobile) parts.push(mobileArea(mobile, site));
  if (site) parts.push(seoArea(site));
  if (site) parts.push(trustArea(mobile, site, ssl));

  const areas = parts.map((p) => p.area);
  const scored = areas.filter((a) => a.score !== null);
  const score = scored.length
    ? clamp(scored.reduce((s, a) => s + a.score * WEIGHTS[a.id], 0) / scored.reduce((s, a) => s + WEIGHTS[a.id], 0))
    : null;

  let issues = parts.flatMap((p) => p.issues);
  let passed = parts.flatMap((p) => p.passed);
  const extraAreas = [];
  for (const ex of extras) {
    if (!ex) continue;
    issues = issues.concat(ex.issues || []);
    passed = passed.concat(ex.passed || []);
    if (ex.section) extraAreas.push(ex.section);
  }
  issues.sort((a, b) => SEV[b.severity] - SEV[a.severity] || b.impact - a.impact);

  const label = score === null ? null : labelFor(score);
  return {
    generatedAt: new Date(now).toISOString(),
    url: site?.finalUrl || mobile?.finalUrl || '',
    host: site?.host || '',
    score,
    label,
    summary: label ? summaryFor(label, score, issues) : '',
    areas,
    sections: extraAreas,
    issues: issues.map(({ impact, ...rest }) => rest),
    passed,
    counts: {
      alta: issues.filter((i) => i.severity === 'alta').length,
      media: issues.filter((i) => i.severity === 'media').length,
      bassa: issues.filter((i) => i.severity === 'bassa').length,
    },
    partial: {
      speedMissing: !mobile,
      desktopMissing: !desktop,
    },
  };
}
