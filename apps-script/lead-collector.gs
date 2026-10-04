/**
 * Raccolta contatti: riceve i dati dal Worker, li scrive nel foglio Google e ti manda una email.
 *
 * Installazione (5 minuti): vedi README, sezione "Salvataggio contatti".
 * Proprietà script da impostare (Impostazioni progetto > Proprietà script):
 *   SECRET        una stringa lunga a caso, uguale al secret LEAD_WEBHOOK_SECRET del Worker
 *   NOTIFY_EMAIL  l'indirizzo che riceve la notifica per ogni nuovo contatto
 */

const HEADERS = ['Data', 'Email', 'Sito analizzato', 'Voto', 'Etichetta', 'Esito', 'Consenso del', 'Versione informativa'];

function doPost(e) {
  try {
    const props = PropertiesService.getScriptProperties();
    const d = JSON.parse(e.postData.contents);
    if (!props.getProperty('SECRET') || d.secret !== props.getProperty('SECRET')) return out_({ ok: false, error: 'unauthorized' });

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);

    sheet.appendRow([
      safe_(d.date), safe_(d.email), safe_(d.url),
      d.score === null || d.score === undefined ? '' : Number(d.score),
      safe_(d.label), safe_(d.outcome), safe_(d.consentAt), safe_(d.consentVersion),
    ]);

    const to = props.getProperty('NOTIFY_EMAIL');
    if (to) {
      const voto = d.score === null || d.score === undefined ? 'analisi non riuscita' : d.score + '/100 (' + d.label + ')';
      MailApp.sendEmail({
        to: to,
        replyTo: String(d.email),
        subject: 'Nuovo contatto dall\'analisi sito: ' + String(d.url).replace(/^https?:\/\//, '') + ' — ' + voto,
        body: [
          'Una persona ha chiesto l\'analisi del suo sito.',
          '',
          'Email: ' + d.email,
          'Sito: ' + d.url,
          'Voto: ' + voto,
          'Esito: ' + d.outcome,
          'Data: ' + d.date,
          '',
          'Puoi rispondere direttamente a questa email. Consenso al trattamento registrato il ' + d.consentAt + '.',
        ].join('\n'),
      });
    }
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

// Evita che un valore che inizia con = + - @ venga eseguito come formula nel foglio.
function safe_(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
