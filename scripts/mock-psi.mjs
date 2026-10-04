// Server finto di PageSpeed Insights per provare il flusso in locale senza chiave API.
import http from 'node:http';
import { psiFixture } from '../worker/test/helpers.js';
const delay = Number(process.env.DELAY || 4000);
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const strategy = u.searchParams.get('strategy');
  setTimeout(() => {
    res.setHeader('content-type', 'application/json');
    const j = psiFixture({ perf: strategy === 'mobile' ? 0.52 : 0.81 });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="640"><rect width="360" height="640" fill="#1b1a1c"/><rect x="24" y="60" width="200" height="22" rx="4" fill="#bff747"/><rect x="24" y="110" width="300" height="14" rx="4" fill="#fff"/><rect x="24" y="136" width="260" height="14" rx="4" fill="#fff"/><rect x="24" y="200" width="312" height="200" rx="12" fill="#f92273"/></svg>';
    j.lighthouseResult.audits['final-screenshot'] = { details: { data: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') } };
    res.end(JSON.stringify(j));
  }, delay);
}).listen(8799, () => console.log('mock PSI su :8799'));
