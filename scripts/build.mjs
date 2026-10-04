// Assembla: frontend/index.html (GitHub Pages) e wordpress/blocco-wordpress.html (incolla-e-via).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const tidy = (s) => s.split('\n').filter((l) => l.trim() !== '').join('\n'); // niente righe vuote: WordPress non le trasforma in <p>

const cfg = JSON.parse(read('config.json'));
if (process.env.AC_API_URL) cfg.apiUrl = process.env.AC_API_URL; // utile per le prove in locale
const fill = (s) => s
  .replaceAll('{{API_URL}}', cfg.apiUrl)
  .replaceAll('{{CONTACT_URL}}', cfg.contactUrl)
  .replaceAll('{{MAIL}}', cfg.mail)
  .replaceAll('{{THEME}}', cfg.theme === 'light' ? 'light' : 'dark')
  .replaceAll('{{TURNSTILE_SITE_KEY}}', cfg.turnstileSiteKey || '');
const block = fill(read('frontend/block.html')).trim();
if (cfg.apiUrl.includes('TUO-ACCOUNT')) console.warn('ATTENZIONE: in config.json "apiUrl" è ancora il segnaposto. Metti l\'indirizzo del tuo Worker.');
const css = tidy(read('frontend/ac-audit.css'));
const js = tidy(read('frontend/ac-audit.js'));

// 1) pagina GitHub Pages
const tpl = read('frontend/index.template.html');
writeFileSync(join(root, 'frontend/index.html'), tpl.replace('<!--AC_BLOCK-->', block));

// 2) blocco per WordPress / Elementor ("HTML personalizzato")
mkdirSync(join(root, 'wordpress'), { recursive: true });
const wp = `<!-- Analisi sito web gratis — Creare Creatività. Incolla tutto in un blocco "HTML personalizzato". -->
<style>
${css}
</style>
${tidy(block)}
<script>
${js}
</script>
`;
writeFileSync(join(root, 'wordpress/blocco-wordpress.html'), wp);
console.log('Generati frontend/index.html e wordpress/blocco-wordpress.html');
