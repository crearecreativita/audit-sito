# Analisi sito web gratis — Creare Creatività

Strumento gratuito che analizza un sito e restituisce un report con voto da 0 a 100 (velocità, mobile, SEO base, accessibilità e sicurezza, identità visiva, segnali di abbandono). Chi lo usa lascia l'email: finisce in un foglio Google e ti arriva una notifica.

Costo: zero. Tutto gira su servizi gratuiti (Cloudflare Workers, Google PageSpeed Insights, Google Apps Script, GitHub Pages).

## Com'è fatto

```
Browser (WordPress o GitHub Pages)
   │  frontend statico: ac-audit.css + ac-audit.js (classi "ac-", nessun framework)
   ▼
Cloudflare Worker  ── /api/start   valida form, honeypot, Turnstile (opz.), rate limit → token firmato
   │               ── /api/step    5 passi in parallelo: psiMobile, psiDesktop, site, ssl, style
   │               ── /api/finish  verifica le firme, calcola il report, salva il contatto
   ├─▶ PageSpeed Insights (chiave API nel Worker)
   ├─▶ home e file del sito analizzato (HTML, CSS, robots.txt, sitemap)
   ├─▶ Cert Spotter (scadenza SSL) e api.wordpress.org (ultima versione di WordPress e dei temi)
   └─▶ Google Apps Script ─▶ foglio Google + email di notifica
```

Perché i passi sono separati: il piano gratuito dei Worker concede pochissimo tempo di CPU per richiesta (10 ms). Ogni passo è una richiesta a sé, con poco lavoro; l'attesa della rete (che è lunga) non conta come CPU. Un vantaggio in più: la barra di avanzamento si muove con dati veri.

Perché i risultati non si possono falsificare: ogni passo restituisce dati firmati (HMAC) dal Worker. `/api/finish` accetta solo dati firmati per quella sessione, quindi il voto salvato nel foglio è sempre quello calcolato dal Worker.

I risultati non hanno URL: il report esiste solo nel browser di chi ha fatto l'analisi. Non c'è nulla da indicizzare. In più, ogni risposta del Worker ha `X-Robots-Tag: noindex`.

```
audit-sito/
├── config.json                  indirizzo del Worker, pagina contatti, email (unico posto da modificare)
├── frontend/                    ac-audit.css, ac-audit.js, block.html, index.html (GitHub Pages), CNAME
├── wordpress/blocco-wordpress.html   blocco già pronto da incollare (CSS + HTML + JS)
├── content/                     testo SEO, FAQ, JSON-LD, impostazioni Yoast, informativa privacy
├── worker/                      Cloudflare Worker + test
├── apps-script/lead-collector.gs     salva i contatti nel foglio e ti manda la mail
└── scripts/                     build.mjs, build-content.mjs, e2e.mjs, mock-psi.mjs
```

Dopo ogni modifica a `frontend/`, `config.json` o `content/faq.json` riesegui:

```bash
node scripts/build.mjs          # rigenera frontend/index.html e wordpress/blocco-wordpress.html
node scripts/build-content.mjs  # rigenera testo pagina, JSON-LD e Yoast
```

---

## Cosa devi configurare tu a mano

- [ ] **Chiave API PageSpeed Insights** (Google Cloud Console → crea un progetto → abilita "PageSpeed Insights API" → Credenziali → Crea chiave API; limitala alla sola API PageSpeed). Senza chiave Google rifiuta quasi tutte le chiamate.
- [ ] **Account Cloudflare** (gratuito) e `npx wrangler login`.
- [ ] **Namespace KV** `AUDIT_KV` (serve per i limiti giornalieri) e il suo id in `worker/wrangler.toml`.
- [ ] **Secret del Worker**: `PSI_API_KEY`, `SIGNING_SECRET`, `LEAD_WEBHOOK_URL`, `LEAD_WEBHOOK_SECRET` (e, se vuoi, `TURNSTILE_SECRET`).
- [ ] **Foglio Google + Apps Script** con l'**indirizzo di notifica** (`NOTIFY_EMAIL`).
- [ ] **`config.json`**: indirizzo del Worker (`apiUrl`), pagina contatti e email.
- [ ] **Repository GitHub** `audit-sito` e GitHub Pages attivo (Settings → Pages → Source: GitHub Actions).
- [ ] **DNS del sottodominio**: record `CNAME` `audit` → `TUO-USERNAME.github.io` (dal pannello DNS di chi gestisce crearecreativita.it).
- [ ] **Pagina WordPress** `analisi-sito-web-gratis`: testo, blocco del tool, JSON-LD, Yoast.
- [ ] **Informativa privacy**: incolla `content/informativa-privacy.html` nella pagina privacy, completando i campi tra parentesi quadre (titolare, email, tempi di conservazione).
- [ ] Verifica che nei domini ammessi del Worker (`ALLOWED_ORIGINS` in `wrangler.toml`) ci siano i tuoi tre indirizzi: `https://crearecreativita.it`, `https://www.crearecreativita.it`, `https://audit.crearecreativita.it`.

---

## 1. Salvataggio contatti (Google Apps Script)

Ho scelto **Google Sheet + Apps Script** invece di Formspree: ti dà un archivio dei contatti che resta tuo, nessun tetto di invii (Formspree gratis ne concede 50 al mese, e uno strumento che funziona bene li brucia in fretta) e la notifica email arriva dallo stesso script. Il Worker chiama lo script dal server, quindi l'indirizzo dello script non compare mai nel frontend. Il prezzo: 5 minuti di configurazione una tantum.

1. Crea un nuovo foglio Google (nome a piacere, es. "Contatti analisi sito").
2. **Estensioni → Apps Script**. Cancella il contenuto e incolla [apps-script/lead-collector.gs](apps-script/lead-collector.gs).
3. **Impostazioni progetto (ingranaggio) → Proprietà script → Aggiungi**:
   - `SECRET` = una stringa lunga a caso (es. `openssl rand -hex 24`)
   - `NOTIFY_EMAIL` = l'indirizzo dove vuoi ricevere le notifiche
4. **Esegui il deployment → Nuovo deployment → Tipo: Applicazione web**. Esegui come: *Me*. Chi ha accesso: *Chiunque*. Autorizza i permessi (foglio e invio email) quando richiesto.
5. Copia l'URL dell'app web (finisce con `/exec`): è il valore di `LEAD_WEBHOOK_URL`. `SECRET` è `LEAD_WEBHOOK_SECRET`.

Se modifichi lo script, devi creare una **nuova versione** del deployment (Gestisci deployment → modifica → Nuova versione), altrimenti resta attiva la vecchia.

Se il salvataggio dovesse fallire, il contatto non va perso: il Worker lo tiene 30 giorni nel KV (chiavi `lead:…`) e lo scrive nei log.

## 2. Deploy del Worker

```bash
cd worker
npm install
npx wrangler login

# 1) KV per i limiti giornalieri: copia l'id stampato in wrangler.toml
npx wrangler kv namespace create AUDIT_KV

# 2) Secret (ti chiede il valore di ognuno)
npx wrangler secret put PSI_API_KEY
npx wrangler secret put SIGNING_SECRET        # una stringa lunga a caso: openssl rand -hex 32
npx wrangler secret put LEAD_WEBHOOK_URL
npx wrangler secret put LEAD_WEBHOOK_SECRET
# facoltativo (vedi "Turnstile")
npx wrangler secret put TURNSTILE_SECRET

# 3) Pubblica
npx wrangler deploy
```

Wrangler stampa l'indirizzo, qualcosa come `https://audit-sito.TUO-ACCOUNT.workers.dev`. Mettilo in `config.json` (`apiUrl`) e riesegui `node scripts/build.mjs`. Usare `workers.dev` evita di spostare il DNS di crearecreativita.it su Cloudflare.

Verifica rapida: `curl https://audit-sito.TUO-ACCOUNT.workers.dev/api/health` deve rispondere `{"ok":true}`. Poi, per provare tutto il flusso con un sito vero:

```bash
node scripts/e2e.mjs www.tuosito.it https://audit-sito.TUO-ACCOUNT.workers.dev https://www.crearecreativita.it
```

**Limiti e variabili** (in `wrangler.toml`, sezione `[vars]`): `RATE_LIMIT_PER_DAY` (3 analisi al giorno per IP e per dominio), `GLOBAL_DAILY_LIMIT` (tetto totale giornaliero, 200). Il KV gratuito consente 1.000 scritture al giorno e ogni analisi ne usa 4: oltre le 250 analisi giornaliere dovresti passare al piano a pagamento, ma a quel punto lo strumento sta funzionando benissimo.

**Se vuoi provare di più di 3 volte in un giorno** (per fare test): metti temporaneamente `RATE_LIMIT_PER_DAY = "50"` e ripubblica, oppure cancella le chiavi `rl:…` dal KV.

### Turnstile (facoltativo)

Il form ha già un campo trappola (honeypot) e un tempo minimo di compilazione; insieme ai limiti giornalieri bastano per iniziare. Se arrivano troppi bot: Cloudflare → Turnstile → crea un widget per i tuoi tre domini, metti la *site key* in `config.json` (`turnstileSiteKey`), la *secret key* nel secret `TURNSTILE_SECRET`, e aggiungi una riga all'informativa privacy (Turnstile tratta dati tecnici del browser).

## 3. GitHub Pages con sottodominio (audit.crearecreativita.it)

1. Crea il repository `audit-sito` su GitHub e caricaci questa cartella:
   ```bash
   git init && git add . && git commit -m "Primo commit" 
   git branch -M main
   git remote add origin git@github.com:TUO-USERNAME/audit-sito.git
   git push -u origin main
   ```
2. Su GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Il workflow [.github/workflows/pages.yml](.github/workflows/pages.yml) pubblica la cartella `frontend/` a ogni push.
3. Sempre in **Settings → Pages → Custom domain**: scrivi `audit.crearecreativita.it` e salva (il file `frontend/CNAME` lo contiene già). Spunta *Enforce HTTPS* quando diventa disponibile.
4. Nel pannello DNS del dominio crea un record **CNAME**: nome `audit`, valore `TUO-USERNAME.github.io`. La propagazione richiede da pochi minuti a qualche ora.

La pagina su GitHub Pages ha `<link rel="canonical">` che punta a `https://www.crearecreativita.it/analisi-sito-web-gratis/`, quindi Google considera quella principale. Se la tua pagina WordPress ha uno slug diverso, cambia il canonical in `frontend/index.template.html` (e `PAGE_URL` in `scripts/build-content.mjs`).

### Font

La pagina su GitHub Pages carica Be Vietnam Pro (pesi 400 e 700, sottoinsieme latino) da `frontend/fonts/`: sono gli stessi file che il tuo sito serve con il plugin OMGF, quindi nessuna chiamata a Google. Nel blocco WordPress il font è quello del tema.

## 4. Incollare lo strumento in WordPress

1. Crea la pagina **Analisi sito web gratis** con slug `analisi-sito-web-gratis`.
2. Apri `content/testo-pagina.html`: contiene la parte sopra il tool, il segnaposto per il tool e la parte sotto. Con Elementor usa i widget *Titolo* e *Editor di testo* (o un widget *HTML*) per le due parti.
3. Nel punto del segnaposto inserisci un widget **HTML** (Elementor) o un blocco **HTML personalizzato** (Gutenberg) e incolla tutto il contenuto di `wordpress/blocco-wordpress.html`. Contiene CSS, markup e JavaScript; le classi hanno prefisso `ac-` e tutti i selettori partono da `.ac-audit`, quindi non toccano il tema.
4. In fondo alla pagina aggiungi un altro widget HTML con `content/json-ld.html` (schema WebApplication + FAQPage).
5. Yoast: frase chiave, title e meta description sono in `content/yoast.md`.
6. Se un plugin di cache/minificazione rompe lo script, escludi la pagina dalla minificazione JS.

Il testo attorno al tool è HTML normale: Google lo legge anche senza JavaScript.

## Browser integrati (Instagram, Facebook, TikTok…)

In questi browser `window.print()` e il download dei file non funzionano. Il tool li riconosce dall'user agent: il pulsante "Stampa o salva in PDF" mostra un avviso che spiega come aprire la pagina nel browser vero. Per non far rifare l'analisi, a fine analisi il Worker salva il report nel KV per 6 ore (chiave `rep:<codice casuale>`, solo il report: niente email) e l'indirizzo della pagina diventa `…#r=<codice>`. Aprendo quel link (dal menu "Apri nel browser" o con "Copia il link del report") il report si ricarica da `GET /api/report?id=…`. Il codice sta dopo il `#`, quindi non esiste come pagina indicizzabile.

## Come ragiona il punteggio

| Area | Peso | Da cosa nasce |
|---|---|---|
| Velocità | 30% | PageSpeed mobile (70%) e desktop (30%) |
| Mobile e usabilità | 20% | viewport, zoom, dimensione dei punti toccabili, testo leggibile |
| SEO base | 25% | indicizzabilità, title, description, H1, alt, sitemap, robots, Open Graph, canonical |
| Accessibilità e sicurezza | 25% | accessibilità (PageSpeed), HTTPS, redirect, scadenza SSL, cookie banner, contenuti misti |

Le aree che non si riesce a misurare sono escluse e il voto si ricalcola sulle altre. Identità visiva e segnali di abbandono non entrano nel voto: compaiono nel report e tra i problemi.
Etichette: 80 o più "Sito in buona forma", 50-79 "Sito da rinforzare", sotto 50 "Sito da rifare".

## Test

```bash
cd worker && npm test       # 28 test: validazione URL, parsing, punteggi, firme, rate limit, flusso completo con rete finta
```

Prova in locale con un PageSpeed finto (senza chiave API):

```bash
node scripts/mock-psi.mjs &                 # server finto su :8799
cd worker && cp .dev.vars.example .dev.vars # poi: npx wrangler dev --port 8787
AC_API_URL=http://localhost:8787 node scripts/build.mjs
python3 -m http.server 8080 -d frontend     # apri http://localhost:8080
```

Ricordati di rigenerare con l'`apiUrl` vero (`node scripts/build.mjs`) prima di pubblicare.

## Limiti da conoscere

- **Scadenza SSL**: un Worker non può leggere il certificato di un altro sito, quindi la data arriva dai registri pubblici di Certificate Transparency (Cert Spotter, gratuito, con limiti di richieste). Se il registro non risponde, il report scrive "non verificabile" e non penalizza.
- **Cookie banner**: si cerca nel codice della home (gestori noti, testi tipici). Un banner caricato in modo insolito può sfuggire; per questo il problema compare solo se ci sono anche strumenti di tracciamento.
- **Colori e font**: letti dal CSS. Le palette predefinite di WordPress, Elementor e Bootstrap sono escluse; i CSS dei plugin vengono saltati quando è possibile, ma le cache che uniscono tutto in un file li rendono indistinguibili. Il report dice che è una stima.
- **Siti dietro protezioni anti-bot**: il report spiega che il sito blocca l'analisi e il contatto viene salvato lo stesso, con l'esito nel foglio.
- **Ultimo articolo e ultima modifica**: la data dell'ultimo articolo si legge dal feed RSS/Atom del sito (con l'API REST come ripiego su WordPress); `Last-Modified` è quello dichiarato dal server, che sui siti con cache indica spesso la data della cache. Per questo l'ultima modifica è solo un indizio, con gravità bassa, e se il server non la dichiara non compare nulla.
- **Plugin e PHP**: i plugin si riconoscono dai file che la home carica (`/wp-content/plugins/<nome>/…?ver=`) e si confrontano con il repository di WordPress (massimo 8, quelli a pagamento o personalizzati restano fuori). Un plugin è "indietro" solo da 3 versioni minori in su. La versione di PHP si legge solo se il server la dichiara (`X-Powered-By`); le date di fine supporto sono in `worker/src/extras.js` (`PHP_SUPPORT_END`) e vanno riviste ogni anno.
- **Solo la home page**.
- **Accessibilità e screenshot** arrivano da Lighthouse (PageSpeed): se Google cambia i nomi dei controlli, il Worker salta quello che non trova invece di fallire.
