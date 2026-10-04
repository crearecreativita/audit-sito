// Scadenza del certificato SSL. Un Worker non può leggere il certificato di un altro sito,
// quindi usiamo i registri pubblici di Certificate Transparency (Cert Spotter, gratuito).

const covers = (names, host) =>
  names.some((n) => {
    n = String(n).toLowerCase();
    if (n === host) return true;
    if (n.startsWith('*.')) {
      const base = n.slice(2);
      return host.endsWith('.' + base) && host.split('.').length === base.split('.').length + 1;
    }
    return false;
  });

export function pickCertificate(issuances, host, now = Date.now()) {
  const list = (Array.isArray(issuances) ? issuances : [])
    .filter((c) => c && c.not_after && c.not_before && covers(c.dns_names || [], host))
    .map((c) => ({ from: Date.parse(c.not_before), to: Date.parse(c.not_after), issuer: c.issuer?.friendly_name || c.issuer?.name || '' }))
    .filter((c) => Number.isFinite(c.to) && Number.isFinite(c.from) && c.from <= now);
  if (!list.length) return null;
  list.sort((a, b) => b.from - a.from); // il più recente emesso è quasi sempre quello servito
  const cert = list[0];
  return { notAfter: new Date(cert.to).toISOString(), daysLeft: Math.floor((cert.to - now) / 86400000), issuer: cert.issuer };
}

export async function checkCertificate(host, { fetchImpl = fetch, now = Date.now() } = {}) {
  const qs = new URLSearchParams({ domain: host, include_subdomains: 'false', match_wildcards: 'true' });
  qs.append('expand', 'dns_names');
  qs.append('expand', 'issuer');
  try {
    const res = await fetchImpl('https://api.certspotter.com/v1/issuances?' + qs.toString(), {
      signal: AbortSignal.timeout(9000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return { known: false };
    const cert = pickCertificate(await res.json(), host, now);
    return cert ? { known: true, ...cert } : { known: false };
  } catch {
    return { known: false };
  }
}
