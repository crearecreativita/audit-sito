// Genera da content/faq.json: testo della pagina (HTML), JSON-LD e controlli di lunghezza per Yoast.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const faq = JSON.parse(readFileSync(join(root, 'content/faq.json'), 'utf8'));
const PAGE_URL = 'https://www.crearecreativita.it/analisi-sito-web-gratis/';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const SEO = {
  title: 'Analisi sito web gratis a Padova: report con voto',
  titleAlt: 'Analisi sito web gratis: voto e report in 30 secondi',
  meta: "Analisi sito web gratis: scrivi l'indirizzo e ricevi un report con voto su velocità, mobile, SEO e sicurezza. Da un web designer di Padova.",
};

const part1 = `<h1>Analisi sito web gratis: scopri cosa frena il tuo sito</h1>
<p>Hai un sito e non sai se funziona davvero? Spesso te ne accorgi solo quando il telefono smette di squillare.</p>
<p>Scrivi qui sotto l’indirizzo del tuo sito e la tua email. In circa 30 secondi ricevi un report con un <strong>voto da 0 a 100</strong>, scritto in italiano normale, senza sigle. Ogni problema ha tre righe: cosa significa, perché conta per la tua attività, come si risolve.</p>
<p>Sono Alessandro, web designer a Padova. Ho costruito questo strumento sulle domande che mi fanno i clienti quando mi mostrano il loro sito.</p>`;

const part2 = `<h2>Cosa controlla l’analisi</h2>
<p>Il controllo parte dalla home page e misura cose verificabili, non opinioni.</p>
<p><strong>Velocità.</strong> Uso PageSpeed Insights, lo strumento di Google, da telefono e da computer. Ti dico quanto ci mette a comparire il contenuto principale, se la pagina si sposta mentre carica e quali immagini pesano troppo.</p>
<p><strong>Mobile.</strong> Guardo se il sito si adatta allo schermo, se il testo è leggibile e se i pulsanti sono troppo vicini. Nel report vedi anche come appare da telefono.</p>
<p><strong>SEO di base.</strong> Titolo, descrizione, titolo principale, immagini senza descrizione, sitemap, file robots e anteprima quando condividi il link.</p>
<p><strong>Sicurezza.</strong> Connessione HTTPS, scadenza del certificato, cookie banner.</p>
<p><strong>Identità visiva e cura.</strong> Quanti font e quanti colori usa il sito, se c’è la favicon, se l’anno nel footer è fermo e se WordPress e il tema sono datati.</p>

<h2>Come leggere il risultato</h2>
<p>Il voto finale è la media di quattro aree: velocità, mobile, SEO, accessibilità e sicurezza. Sopra 80 il sito è in buona forma. Tra 50 e 79 va rinforzato. Sotto 50 conviene capire se sistemarlo punto per punto o rifarlo.</p>
<p>I problemi sono in ordine di urgenza, con tre livelli: alta, media, bassa. Parti dall’alto: di solito pochi interventi fanno la differenza.</p>
<p>E ti dico la verità: è un’analisi automatica. Trova quello che si può misurare, ma non giudica se i testi convincono o se la grafica ti somiglia. Non tutto quello che segnala è un guaio, e un 100 non garantisce clienti. Il report si può stampare o salvare in PDF.</p>

<h2>Domande frequenti</h2>
${faq.map((f) => `<h3>${esc(f.q)}</h3>\n<p>${esc(f.a)}</p>`).join('\n')}

<p>Vuoi che lo sistemi? Se hai un’attività a Padova o in provincia, <a href="https://www.crearecreativita.it/parliamo/">scrivimi</a>: guardiamo il report insieme. Se invece il sito va rifatto, trovi come lavoro nella pagina sulla <a href="https://www.crearecreativita.it/realizzazione-siti-internet-padova/">realizzazione di siti internet a Padova</a>, e per la manutenzione c’è l’<a href="https://www.crearecreativita.it/assistenza-wordpress/">assistenza WordPress</a>.</p>`;

writeFileSync(join(root, 'content/testo-pagina.html'),
`<!-- TESTO DELLA PAGINA "Analisi sito web gratis" — HTML puro, leggibile da Google senza JavaScript.
     Se il tema stampa già il titolo della pagina come H1, togli l'<h1> qui sotto e metti lo stesso testo come titolo della pagina. -->

<!-- ===== PARTE 1: sopra il tool ===== -->
${part1}

<!-- ===== QUI VA IL BLOCCO DEL TOOL: wordpress/blocco-wordpress.html ===== -->

<!-- ===== PARTE 2: sotto il tool ===== -->
${part2}
`);

const jsonld = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      '@id': PAGE_URL + '#strumento',
      name: 'Analisi sito web gratis',
      url: PAGE_URL,
      description: "Strumento gratuito che analizza velocità, mobile, SEO di base e sicurezza di un sito web e restituisce un report con voto da 0 a 100, spiegato in italiano semplice.",
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Qualsiasi (nel browser)',
      browserRequirements: 'Richiede JavaScript',
      inLanguage: 'it',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      creator: { '@type': 'Person', name: 'Alessandro Minotto', url: 'https://www.crearecreativita.it/' },
      provider: { '@type': 'Organization', name: 'Creare Creatività', url: 'https://www.crearecreativita.it/' },
    },
    {
      '@type': 'FAQPage',
      '@id': PAGE_URL + '#faq',
      mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
  ],
};
writeFileSync(join(root, 'content/json-ld.html'),
`<!-- Incolla in un blocco "HTML personalizzato" della pagina (o in Yoast > Schema, o nelle impostazioni di Elementor). Le risposte coincidono con il testo visibile. -->
<script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
</script>
`);

const yoast = [
  '# Impostazioni Yoast per la pagina "Analisi sito web gratis"',
  '',
  '(Generato da scripts/build-content.mjs: non modificare a mano, cambia lo script.)',
  '',
  '| Campo | Valore |',
  '|---|---|',
  '| **Frase chiave principale** | analisi sito web gratis |',
  '| **Frasi chiave correlate** | analisi sito web padova, controllo sito web gratis, verifica velocità sito web |',
  `| **SEO title** (${SEO.title.length}/60) | ${SEO.title} |`,
  `| **Meta description** (${SEO.meta.length}/155) | ${SEO.meta} |`,
  '| **Slug** | analisi-sito-web-gratis |',
  `| **URL finale** | ${PAGE_URL} |`,
  `| **Canonical della versione su GitHub Pages** | punta a ${PAGE_URL} (già impostato in frontend/index.html) |`,
  '',
  `## Alternativa senza località (${SEO.titleAlt.length}/60)`,
  '',
  SEO.titleAlt,
  '',
  'Usala se preferisci un titolo nazionale. La variante locale ("a Padova") resta comunque nel testo, nella meta description e nel link alla pagina sui siti web a Padova.',
  '',
  '## Note',
  '',
  '- La frase chiave "analisi sito web gratis" è nell\'H1, nel primo paragrafo, nel title, nella meta description e nello slug.',
  '- Il testo sta in HTML normale: Google lo legge anche senza JavaScript. Solo il tool è in JavaScript.',
  '- Imposta la pagina su index, follow e inseriscila nella sitemap. I risultati delle analisi non hanno URL, quindi non c\'è nulla da escludere.',
  '',
].join('\n');
writeFileSync(join(root, 'content/yoast.md'), yoast);

// controlli
const words = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').split(/\s+/).filter(Boolean).length;
const total = words(part1) + words(part2);
const check = (label, s, max) => console.log(`${s.length <= max ? 'OK ' : 'TROPPO LUNGO'} ${label}: ${s.length}/${max}  «${s}»`);
check('Title SEO', SEO.title, 60);
check('Title alternativo', SEO.titleAlt, 60);
check('Meta description', SEO.meta, 155);
console.log(`Parole nel testo (H1, intro, sezioni, FAQ, chiusura): ${total}`);
JSON.parse(JSON.stringify(jsonld)); // sintassi valida
console.log('JSON-LD generato:', jsonld['@graph'].map((n) => n['@type']).join(' + '), `(${faq.length} domande)`);
