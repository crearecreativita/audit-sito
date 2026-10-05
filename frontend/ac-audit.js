/* Analisi sito web gratis — Creare Creatività
   JavaScript autonomo (nessuna dipendenza). Tutto vive dentro #ac-audit. */
(function () {
  'use strict';

  var root = document.getElementById('ac-audit');
  if (!root || root.getAttribute('data-ac-ready')) return;
  root.setAttribute('data-ac-ready', '1');

  var API = (root.getAttribute('data-ac-api') || '').replace(/\/$/, '');
  var CONTACT = root.getAttribute('data-ac-contact') || '';
  var MAIL = root.getAttribute('data-ac-mail') || '';
  var TURNSTILE_KEY = root.getAttribute('data-ac-turnstile') || '';

  var form = root.querySelector('.ac-form');
  var urlInput = root.querySelector('#ac-url');
  var emailInput = root.querySelector('#ac-email');
  var consentInput = root.querySelector('#ac-consent');
  var hpInput = root.querySelector('.ac-hp input');
  var errorBox = root.querySelector('.ac-error');
  var submitBtn = form.querySelector('button[type="submit"]');
  var progress = root.querySelector('.ac-progress');
  var bar = root.querySelector('.ac-bar');
  var barFill = root.querySelector('.ac-bar-fill');
  var barNum = root.querySelector('.ac-bar-num');
  var stepsList = root.querySelector('.ac-steps');
  var failBox = root.querySelector('.ac-fail');
  var reportBox = root.querySelector('.ac-report');
  // Browser integrati (Instagram, Facebook, TikTok...): lì stampare e scaricare file non funziona
  var UA = navigator.userAgent || '';
  var IN_APP = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|Messenger|Line\/|MicroMessenger|TikTok|musical_ly|Snapchat|LinkedInApp|Pinterest|Twitter|; wv\)/i.test(UA) ||
    (/iPhone|iPad|iPod/.test(UA) && !/Safari\//.test(UA));
  var shareUrl = '';
  var noticeBox = null;
  var loadedAt = (window.performance && performance.now) ? performance.now() : 0;

  /* ───────── utilità ───────── */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }
  function show(node, on) { if (on) node.removeAttribute('hidden'); else node.setAttribute('hidden', ''); }
  function showError(msg) { errorBox.textContent = msg; show(errorBox, true); }

  /* ───────── Turnstile (facoltativo) ───────── */
  var turnstileId = null;
  var turnstileToken = '';
  if (TURNSTILE_KEY) {
    window.acTurnstileReady = function () {
      if (!window.turnstile) return;
      turnstileId = window.turnstile.render(root.querySelector('.ac-turnstile'), {
        sitekey: TURNSTILE_KEY,
        callback: function (t) { turnstileToken = t; },
        'expired-callback': function () { turnstileToken = ''; }
      });
    };
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=acTurnstileReady';
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }

  /* ───────── chiamate al Worker ───────── */
  function api(path, body, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 30000) : null;
    return fetch(API + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () { return { ok: false, error: { code: 'bad_response', message: 'Risposta non valida dal server.' } }; });
    }).then(function (data) {
      if (!data || data.ok === false) {
        var err = new Error((data && data.error && data.error.message) || 'Errore imprevisto.');
        err.code = data && data.error && data.error.code;
        throw err;
      }
      return data;
    }, function (e) {
      var err = new Error(e && e.name === 'AbortError'
        ? "L'analisi sta impiegando troppo tempo. Riprova tra qualche minuto."
        : 'Non riesco a collegarmi al servizio. Controlla la connessione e riprova.');
      err.code = e && e.name === 'AbortError' ? 'timeout' : 'network';
      throw err;
    }).then(function (d) { if (timer) clearTimeout(timer); return d; }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  /* ───────── avanzamento ───────── */
  var STEP_DEFS = [
    { id: 'psiMobile', label: 'Misuro la velocità da telefono', share: 0.34, eta: 30 },
    { id: 'psiDesktop', label: 'Misuro la velocità da computer', share: 0.18, eta: 25 },
    { id: 'site', label: 'Leggo titolo, descrizione e struttura della pagina', share: 0.2, eta: 7 },
    { id: 'ssl', label: 'Controllo il certificato di sicurezza', share: 0.06, eta: 5 },
    { id: 'style', label: 'Guardo font, colori e segnali di manutenzione', share: 0.17, eta: 9, after: 'site' }
  ];
  var FINISH_SHARE = 0.05;

  function Tracker() {
    this.state = {}; // id → 'pending' | 'running' | 'done' | 'fail'
    this.t0 = {};
    this.finishing = false;
    this.pct = 0;
    var self = this;
    this.items = {};
    stepsList.textContent = '';
    STEP_DEFS.forEach(function (d) {
      self.state[d.id] = 'pending';
      var li = el('li', { text: d.label });
      self.items[d.id] = li;
      stepsList.appendChild(li);
    });
    this.timer = setInterval(function () { self.render(); }, 250);
    this.render();
  }
  Tracker.prototype.start = function (id) { this.state[id] = 'running'; this.t0[id] = Date.now(); };
  Tracker.prototype.end = function (id, ok) { this.state[id] = ok ? 'done' : 'fail'; this.render(); };
  Tracker.prototype.render = function () {
    var total = 0, self = this, firstActive = false;
    STEP_DEFS.forEach(function (d) {
      var st = self.state[d.id];
      if (st === 'done' || st === 'fail') total += d.share;
      else if (st === 'running') {
        var f = Math.min(0.92, (Date.now() - self.t0[d.id]) / 1000 / d.eta);
        total += d.share * (1 - Math.pow(1 - f, 2));
      }
      var li = self.items[d.id];
      li.className = st === 'done' ? 'is-done' : st === 'fail' ? 'is-fail' : st === 'running' ? 'is-active' : '';
    });
    if (this.finishing) total += FINISH_SHARE * 0.6;
    var pct = Math.max(this.pct, Math.min(98, Math.round(total * 100)));
    this.pct = pct;
    barFill.style.width = pct + '%';
    barNum.textContent = pct + '%';
    bar.setAttribute('aria-valuenow', String(pct));
  };
  Tracker.prototype.complete = function () {
    clearInterval(this.timer);
    this.pct = 100; barFill.style.width = '100%'; barNum.textContent = '100%'; bar.setAttribute('aria-valuenow', '100');
  };
  Tracker.prototype.stop = function () { clearInterval(this.timer); };

  /* ───────── flusso principale ───────── */
  var running = false;

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (running) return;
    show(errorBox, false);

    var url = urlInput.value.trim();
    var email = emailInput.value.trim();
    if (!url) { showError("Scrivi l'indirizzo del tuo sito."); urlInput.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { showError("L'indirizzo email non sembra corretto."); emailInput.focus(); return; }
    if (!consentInput.checked) { showError("Per procedere serve spuntare il consenso al trattamento dell'email."); consentInput.focus(); return; }
    if (TURNSTILE_KEY && !turnstileToken) { showError('Completa la verifica anti-robot qui sopra.'); return; }

    running = true;
    submitBtn.disabled = true;
    var elapsed = (window.performance && performance.now) ? performance.now() - loadedAt : 99999;

    api('/api/start', { url: url, email: email, consent: true, hp: hpInput.value, elapsed: Math.round(elapsed), turnstile: turnstileToken }, 20000)
      .then(function (start) { runAnalysis(start, url); })
      .catch(function (e) {
        running = false; submitBtn.disabled = false;
        showError(e.message);
        if (window.turnstile && turnstileId !== null) { window.turnstile.reset(turnstileId); turnstileToken = ''; }
      });
  });

  function runAnalysis(start, typedUrl) {
    show(form, false); show(progress, true); show(failBox, false); show(reportBox, false);
    progress.scrollIntoView && progress.scrollIntoView({ behavior: 'smooth', block: 'start' });

    var tracker = new Tracker();
    var results = {};
    var screenshot = null;
    var abort = null;

    function step(id, extra) {
      tracker.start(id);
      var body = { token: start.token, step: id };
      if (extra) for (var k in extra) body[k] = extra[k];
      return api('/api/step', body, 110000).then(function (r) {
        results[id] = { payload: r.payload, sig: r.sig };
        if (r.screenshot) screenshot = r.screenshot;
        var ok = true;
        try { ok = JSON.parse(r.payload).ok; } catch (e) { ok = false; }
        tracker.end(id, ok);
      }, function (e) {
        tracker.end(id, false);
        if (e.code === 'token_invalid' || e.code === 'token_expired') abort = e;
      });
    }

    // Prima si legge il sito (1-4 secondi), poi partono i test di Google: così il tuo server non riceve tutto insieme
    // e non rifiuta richieste. Se il sito non si legge, i test di Google non partono nemmeno.
    var siteP = step('site').then(function () {
      var siteOk = false;
      try { siteOk = results.site && JSON.parse(results.site.payload).ok; } catch (e) { siteOk = false; }
      if (!siteOk || abort) {
        ['psiMobile', 'psiDesktop', 'style'].forEach(function (id) { tracker.end(id, false); });
        return;
      }
      return Promise.all([step('psiMobile'), step('psiDesktop'), step('style', { site: results.site })]);
    });
    Promise.all([siteP, step('ssl')]).then(function () {
      if (abort) throw abort;
      tracker.finishing = true;
      return api('/api/finish', { token: start.token, steps: results }, 30000);
    }).then(function (fin) {
      tracker.complete();
      setTimeout(function () {
        show(progress, false);
        rememberShare(fin.shareId);
        renderReport(fin.report, screenshot);
        running = false;
      }, 400);
    }).catch(function (e) {
      tracker.stop();
      show(progress, false);
      showFail(e.message || 'Non sono riuscito a completare l\'analisi.', typedUrl);
      running = false;
    });
  }

  function resetForm() {
    shareUrl = '';
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignora */ }
    show(failBox, false); show(reportBox, false); show(progress, false); show(form, true);
    submitBtn.disabled = false; running = false; show(errorBox, false);
    if (window.turnstile && turnstileId !== null) { window.turnstile.reset(turnstileId); turnstileToken = ''; }
    form.scrollIntoView && form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    urlInput.focus();
  }

  function showFail(message, typedUrl) {
    failBox.textContent = '';
    failBox.appendChild(el('h2', { text: "Non sono riuscito a completare l'analisi" }));
    failBox.appendChild(el('p', { text: message }));
    var actions = el('div', { 'class': 'ac-fail-actions' },
      el('button', { 'class': 'ac-btn ac-btn--small', type: 'button', text: 'Riprova con un altro indirizzo' }),
      MAIL ? el('a', { 'class': 'ac-btn ac-btn--ghost ac-btn--small', href: 'mailto:' + MAIL + '?subject=' + encodeURIComponent('Analisi del sito ' + (typedUrl || '')), text: 'Scrivimi, lo guardiamo insieme' }) : null);
    actions.firstChild.addEventListener('click', resetForm);
    failBox.appendChild(actions);
    show(failBox, true);
    failBox.scrollIntoView && failBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ───────── report ───────── */
  var AREA_NAMES = { speed: 'Velocità', mobile: 'Mobile', seo: 'SEO', trust: 'Sicurezza', identity: 'Identità visiva', care: 'Manutenzione' };
  var SEV_TEXT = { alta: 'Priorità alta', media: 'Priorità media', bassa: 'Priorità bassa' };

  function tone(score) { return score >= 80 ? 'buona' : score >= 50 ? 'rinforzare' : 'rifare'; }

  function rowsList(rows) {
    var ul = el('ul', { 'class': 'ac-rows' });
    (rows || []).forEach(function (r) {
      var li = el('li', { 'class': 'ac-row ac-row--' + (r.status || 'na') },
        el('span', { 'class': 'ac-row-label', text: r.label }),
        el('span', { 'class': 'ac-row-value', text: String(r.value) }));
      if (r.hint) li.appendChild(el('span', { 'class': 'ac-row-hint', text: r.hint }));
      if (r.swatches && r.swatches.length) {
        var sw = el('span', { 'class': 'ac-swatches ac-row-hint' });
        r.swatches.forEach(function (c) {
          var chip = el('i'); chip.style.background = /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#ccc';
          sw.appendChild(el('span', { 'class': 'ac-swatch' }, chip, c.hex.toUpperCase()));
        });
        li.appendChild(sw);
      }
      ul.appendChild(li);
    });
    return ul;
  }

  function areaCard(a, shot) {
    var hasScore = typeof a.score === 'number';
    var top = el('div', { 'class': 'ac-area-top' },
      a.name ? el('h3', { text: a.name }) : null,
      hasScore ? el('span', { 'class': 'ac-area-score' }, String(a.score), el('small', { text: ' / 100' })) : null);
    var card = el('div', { 'class': 'ac-area' }, (a.name || hasScore) ? top : null, a.intro ? el('p', { 'class': 'ac-area-intro', text: a.intro }) : null);
    if (hasScore) {
      var m = el('div', { 'class': 'ac-meter ac-meter--' + tone(a.score), role: 'img', 'aria-label': 'Punteggio ' + a.score + ' su 100' }, el('i'));
      m.firstChild.style.width = a.score + '%';
      card.appendChild(m);
    }
    var grid = el('div', { 'class': 'ac-area-grid' + (shot ? ' ac-area-grid--shot' : '') }, rowsList(a.rows));
    if (shot) {
      grid.appendChild(el('figure', { 'class': 'ac-shot' },
        el('img', { src: shot, alt: 'Come appare il tuo sito su un telefono', loading: 'lazy' }),
        el('figcaption', { text: 'Il tuo sito da telefono' })));
    }
    card.appendChild(grid);
    return card;
  }

  function issueCard(i) {
    return el('article', { 'class': 'ac-issue ac-issue--' + i.severity },
      el('div', { 'class': 'ac-issue-top' },
        el('span', { 'class': 'ac-sev ac-sev--' + i.severity, text: SEV_TEXT[i.severity] || i.severity }),
        el('span', { 'class': 'ac-issue-area', text: AREA_NAMES[i.area] || '' })),
      el('h3', { text: i.title }),
      el('p', null, el('strong', { text: 'Cosa significa. ' }), i.meaning),
      el('p', null, el('strong', { text: 'Perché conta per la tua attività. ' }), i.why),
      el('p', null, el('strong', { text: 'Come si risolve. ' }), i.fix));
  }

  function renderReport(rep, screenshot) {
    reportBox.textContent = '';
    var date = new Date(rep.generatedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
    var kids = [];

    function actionsRow() {
      var printBtn = el('button', { 'class': 'ac-btn ac-btn--ghost ac-btn--small', type: 'button', text: 'Stampa o salva in PDF' });
      printBtn.addEventListener('click', startPrint);
      var againBtn = el('button', { 'class': 'ac-btn ac-btn--ghost ac-btn--small', type: 'button', text: 'Analizza un altro sito' });
      againBtn.addEventListener('click', resetForm);
      return el('div', { 'class': 'ac-r-actions ac-no-print' }, printBtn, againBtn);
    }
    kids.push(el('div', { 'class': 'ac-r-head' },
      el('div', null, el('h2', { text: 'Analisi di ' + (rep.host || rep.url) }), el('p', { 'class': 'ac-r-date', text: 'Eseguita il ' + date + ' · Analisi gratuita di Creare Creatività' })),
      actionsRow()));

    noticeBox = el('div', { 'class': 'ac-notice ac-no-print', role: 'status', hidden: '' });
    kids.push(noticeBox);

    var t = tone(rep.score);
    var counts = [];
    if (rep.counts.alta) counts.push(rep.counts.alta + ' ad alta priorità');
    if (rep.counts.media) counts.push(rep.counts.media + ' a media priorità');
    if (rep.counts.bassa) counts.push(rep.counts.bassa + ' a bassa priorità');
    var ring = el('div', { 'class': 'ac-ring ac-ring--' + t, role: 'img', 'aria-label': 'Voto ' + rep.score + ' su 100' },
      el('div', { 'class': 'ac-ring-num' }, String(rep.score), el('small', { text: 'su 100' })));
    ring.style.setProperty('--p', String(rep.score));
    kids.push(el('section', { 'class': 'ac-score' }, ring,
      el('div', null,
        el('span', { 'class': 'ac-label ac-label--' + t, text: rep.label.text }),
        el('p', { text: rep.summary }),
        counts.length ? el('p', { 'class': 'ac-counts', text: 'Punti da sistemare: ' + counts.join(', ') + '.' }) : null)));

    var areas = el('div', { 'class': 'ac-areas' });
    rep.areas.forEach(function (a) { areas.appendChild(areaCard(a, a.id === 'mobile' ? screenshot : null)); });
    kids.push(el('section', null,
      el('h2', { 'class': 'ac-section-title', text: 'Le quattro aree' }),
      el('p', { 'class': 'ac-section-sub', text: 'Ogni area ha un voto da 0 a 100, calcolato su misure reali.' }), areas));

    (rep.sections || []).forEach(function (s) {
      kids.push(el('section', null,
        el('h2', { 'class': 'ac-section-title', text: s.name }),
        s.intro ? el('p', { 'class': 'ac-section-sub', text: s.intro }) : null,
        el('div', { 'class': 'ac-areas' }, areaCard(Object.assign({}, s, { name: '', score: undefined, intro: '' })))));
    });

    if (rep.issues.length) {
      var list = el('div', { 'class': 'ac-issues' });
      rep.issues.forEach(function (i) { list.appendChild(issueCard(i)); });
      kids.push(el('section', null,
        el('h2', { 'class': 'ac-section-title', text: 'Cosa sistemerei, in ordine di urgenza' }),
        el('p', { 'class': 'ac-section-sub', text: 'Sono occasioni di miglioramento: partendo dall’alto si ottiene di più con meno lavoro.' }), list));
    }

    if (rep.passed.length) {
      var good = el('ul', { 'class': 'ac-good' });
      rep.passed.forEach(function (p) { good.appendChild(el('li', { text: p })); });
      kids.push(el('section', null, el('h2', { 'class': 'ac-section-title', text: 'Cosa va già bene' }), good));
    }

    kids.push(el('div', { 'class': 'ac-r-foot' }, actionsRow()));

    var mailBody = 'Ciao Alessandro,\nho fatto l’analisi del mio sito ' + rep.url + ' (voto ' + rep.score + '/100) e vorrei parlarne.\n';
    var ctaActions = el('div', { 'class': 'ac-cta-actions' },
      CONTACT ? el('a', { 'class': 'ac-btn ac-btn--brand', href: CONTACT, text: 'Vai alla pagina contatti' }) : null,
      MAIL ? el('a', { 'class': 'ac-btn ac-btn--ghost', href: 'mailto:' + MAIL + '?subject=' + encodeURIComponent('Analisi del sito ' + (rep.host || '')) + '&body=' + encodeURIComponent(mailBody), text: 'Scrivimi una mail' }) : null);
    kids.push(el('section', { 'class': 'ac-cta' },
      el('h2', { text: 'Vuoi migliorare il tuo sito web?' }),
      el('p', { text: 'Sono Alessandro, grafico e web designer a Padova. Se vuoi, guardiamo insieme questo report e ti dico cosa farei per primo, senza impegno.' }),
      ctaActions,
      el('p', { 'class': 'ac-cta-print', text: [MAIL, CONTACT].filter(Boolean).join(' · ') })));

    kids.push(el('p', { 'class': 'ac-note', text: 'Analisi automatica della home page, fatta con gli strumenti di Google (PageSpeed Insights) e con controlli propri. È un punto di partenza, non una perizia: alcuni dettagli vanno guardati a mano.' }));

    kids.forEach(function (k) { reportBox.appendChild(k); });
    show(reportBox, true);
    reportBox.scrollIntoView && reportBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    reportBox.focus({ preventScroll: true });
  }

  /* ───────── browser integrati: il report si riapre nel browser vero ───────── */
  function rememberShare(id) {
    if (!id || !/^[a-f0-9]{32}$/.test(id)) return;
    shareUrl = location.origin + location.pathname + location.search + '#r=' + id;
    // se l'utente sceglie "Apri nel browser" dal menu dell'app, l'indirizzo corrente contiene già il codice
    try { history.replaceState(null, '', '#r=' + id); } catch (e) { /* ignora */ }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = el('textarea', { 'aria-hidden': 'true' }); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); } finally { document.body.removeChild(ta); }
    });
  }

  function showInAppNotice() {
    if (!noticeBox) return;
    noticeBox.textContent = '';
    noticeBox.appendChild(el('h3', { text: 'Per salvare il PDF apri la pagina nel browser' }));
    noticeBox.appendChild(el('p', { text: 'Stai guardando questa pagina dentro un’app (Instagram, Facebook, TikTok…). Lì non si può stampare né scaricare. Tocca i tre puntini (o l’icona della bussola) e scegli “Apri nel browser”: troverai lo stesso report, senza rifare l’analisi. Resta disponibile per 6 ore.' }));
    if (shareUrl) {
      var status = el('span', { 'class': 'ac-notice-ok', role: 'status' });
      var copy = el('button', { 'class': 'ac-btn ac-btn--small', type: 'button', text: 'Copia il link del report' });
      copy.addEventListener('click', function () {
        copyText(shareUrl).then(function () { status.textContent = 'Link copiato: incollalo in Safari o Chrome.'; },
          function () { status.textContent = 'Non riesco a copiarlo. Tieni premuto sul link qui sotto per copiarlo.'; });
      });
      noticeBox.appendChild(el('p', { 'class': 'ac-notice-row' }, copy, status));
      noticeBox.appendChild(el('p', { 'class': 'ac-notice-link', text: shareUrl }));
    }
    show(noticeBox, true);
    noticeBox.scrollIntoView && noticeBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Link con #r=codice: riapre un report già fatto (per 6 ore)
  (function openSharedReport() {
    var m = /^#r=([a-f0-9]{32})$/.exec(location.hash || '');
    if (!m || !API) return;
    show(form, false); show(progress, false);
    fetch(API + '/api/report?id=' + m[1]).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.ok === false) throw new Error((d && d.error && d.error.message) || 'Report non disponibile.');
      shareUrl = location.origin + location.pathname + location.search + location.hash;
      renderReport(d.report, null);
    }).catch(function (e) {
      showFail((e && e.message) || 'Report non disponibile.', '');
    });
  })();

  /* ───────── stampa: nasconde tutto tranne il report ───────── */
  var hiddenForPrint = [];
  function preparePrint() {
    if (hiddenForPrint.length || reportBox.hasAttribute('hidden')) return;
    var node = reportBox;
    while (node && node !== document.body && node.parentElement) {
      var p = node.parentElement;
      for (var i = 0; i < p.children.length; i++) {
        var sib = p.children[i];
        if (sib !== node && !sib.classList.contains('ac-print-hide')) { sib.classList.add('ac-print-hide'); hiddenForPrint.push(sib); }
      }
      node = p;
    }
  }
  function cleanupPrint() {
    hiddenForPrint.forEach(function (n) { n.classList.remove('ac-print-hide'); });
    hiddenForPrint = [];
  }
  // Il ripristino avviene solo a stampa finita (afterprint): alcuni browser compongono l'anteprima DOPO il ritorno di window.print()
  function startPrint() {
    if (IN_APP) { showInAppNotice(); return; }
    preparePrint();
    setTimeout(function () {
      try { window.print(); } catch (e) { cleanupPrint(); }
      // rete di sicurezza: se il browser non invia mai afterprint, dopo 2 minuti la pagina torna normale
      setTimeout(cleanupPrint, 120000);
    }, 80);
  }
  window.addEventListener('beforeprint', preparePrint);
  window.addEventListener('afterprint', cleanupPrint);
})();
