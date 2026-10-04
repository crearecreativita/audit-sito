// Prova end-to-end contro un Worker in esecuzione (locale o online): node scripts/e2e.mjs <sito> [api] [origin]
const [site = 'www.crearecreativita.it', api = 'http://localhost:8787', origin = 'http://localhost:8080'] = process.argv.slice(2);
const post = async (path, body) => {
  const r = await fetch(api + path, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { console.log(`Risposta non JSON da ${path} (HTTP ${r.status}):`, t.replace(/\s+/g, ' ').slice(0, 400)); process.exit(1); }
};
const t0 = Date.now();
const start = await post('/api/start', { url: site, email: 'test@example.com', consent: true, hp: '', elapsed: 9000 });
if (!start.ok) { console.log('START', start); process.exit(1); }
const out = {};
const run = async (id, extra) => {
  const r = await post('/api/step', { token: start.token, step: id, ...extra });
  const p = JSON.parse(r.payload);
  console.log(id.padEnd(11), p.ok ? 'ok' : 'ERRORE ' + JSON.stringify(p.error), `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  out[id] = { payload: r.payload, sig: r.sig };
  return p;
};
await Promise.all([run('psiMobile'), run('psiDesktop'), run('ssl'), run('site').then(() => run('style', { site: out.site }))]);
const fin = await post('/api/finish', { token: start.token, steps: out });
if (!fin.ok) { console.log('FINISH', fin); process.exit(1); }
const r = fin.report;
console.log(`\nVOTO ${r.score}/100 — ${r.label.text}\n${r.summary}\n`);
for (const a of r.areas) console.log(`  ${a.name}: ${a.score}`);
console.log('\nProblemi:'); for (const i of r.issues) console.log(`  [${i.severity}] ${i.title}`);
console.log('\nBene:', r.passed.join('; '));
for (const s of r.sections || []) { console.log('\n' + s.name); for (const x of s.rows) console.log('  -', x.label + ':', x.value); }
