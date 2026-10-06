/**
 * Raccolta contatti: riceve i dati dal Worker, li scrive nel foglio Google e ti manda una email.
 *
 * Installazione (5 minuti): vedi README, sezione "Salvataggio contatti".
 * Proprietà script da impostare (Impostazioni progetto > Proprietà script):
 *   SECRET        una stringa lunga a caso, uguale al secret LEAD_WEBHOOK_SECRET del Worker
 *   NOTIFY_EMAIL  l'indirizzo che riceve la notifica per ogni nuovo contatto
 *
 * Se aggiorni lo script: Esegui il deployment > Gestisci deployment > modifica (matita) > Versione: Nuova versione.
 */

const HEADERS = [
  'Data', 'Email', 'Sito analizzato', 'Voto', 'Etichetta', 'Esito', 'Consenso del', 'Versione informativa',
  'Piattaforma', 'Velocità', 'Mobile', 'SEO', 'Accessibilità e sicurezza', 'Problemi alta priorità', 'Priorità principali',
];

function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const d = JSON.parse(e.postData.contents);
    if (!props.getProperty('SECRET') || d.secret !== props.getProperty('SECRET')) return out_({ ok: false, error: 'unauthorized' });

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    ensureHeaders_(sheet);

    const sc = d.scores || {};
    const top = Array.isArray(d.top) ? d.top : [];
    sheet.appendRow([
      safe_(d.date), safe_(d.email), safe_(d.url),
      d.score === null || d.score === undefined ? '' : Number(d.score),
      safe_(d.label), safe_(d.outcome), safe_(d.consentAt), safe_(d.consentVersion),
      safe_(d.platform), num_(sc.speed), num_(sc.mobile), num_(sc.seo), num_(sc.trust),
      d.counts ? Number(d.counts.alta || 0) : '',
      safe_(top.join(' | ')),
    ]);

    const to = props.getProperty('NOTIFY_EMAIL');
    if (to) {
      const voto = d.score === null || d.score === undefined ? 'analisi non riuscita' : d.score + '/100 (' + d.label + ')';
      const righe = [
        'Una persona ha chiesto l\'analisi del suo sito.',
        '',
        'Email: ' + d.email,
        'Sito: ' + d.url,
        'Voto: ' + voto,
      ];
      if (d.platform) righe.push('Piattaforma: ' + d.platform);
      if (d.scores) righe.push('Aree: velocità ' + show_(sc.speed) + ' · mobile ' + show_(sc.mobile) + ' · SEO ' + show_(sc.seo) + ' · sicurezza ' + show_(sc.trust));
      if (top.length) righe.push('Da dove partire: ' + top.join('; '));
      righe.push('Esito: ' + d.outcome, 'Data: ' + d.date, '',
        'Puoi rispondere direttamente a questa email. Consenso al trattamento registrato il ' + d.consentAt + '.');
      MailApp.sendEmail({
        to: to,
        replyTo: String(d.email),
        subject: 'Nuovo contatto dall\'analisi sito: ' + String(d.url).replace(/^https?:\/\//, '') + ' — ' + voto,
        body: righe.join('\n'),
      });
    }
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

// Aggiunge le colonne nuove all'intestazione, senza toccare i dati già presenti.
function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0) { sheet.appendRow(HEADERS); return; }
  const first = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  if (first[0] === 'Data' && first.length < HEADERS.length) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
}

// Evita che un valore che inizia con = + - @ venga eseguito come formula nel foglio.
function safe_(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function num_(v) { return v === null || v === undefined || v === '' ? '' : Number(v); }
function show_(v) { return v === null || v === undefined ? 'n/d' : v; }

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
