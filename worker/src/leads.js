// Salvataggio del contatto: il Worker chiama una Web App di Google Apps Script (foglio + email di notifica).

export async function saveLead(env, lead, { fetchImpl = fetch } = {}) {
  if (!env.LEAD_WEBHOOK_URL) return { saved: false, reason: 'no_webhook' };
  try {
    const res = await fetchImpl(env.LEAD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' }, // evita il preflight lato Apps Script
      body: JSON.stringify({ secret: env.LEAD_WEBHOOK_SECRET || '', ...lead }),
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text();
    let ok = res.ok;
    try { ok = ok && JSON.parse(text).ok === true; } catch { ok = false; }
    if (ok) return { saved: true };
    return { saved: false, reason: 'webhook_rejected' };
  } catch {
    return { saved: false, reason: 'webhook_unreachable' };
  }
}

/** Se il salvataggio fallisce, il contatto non va perso: lo teniamo 30 giorni in KV. */
export async function parkLead(env, jobId, lead) {
  try {
    await env.AUDIT_KV?.put(`lead:${jobId}`, JSON.stringify(lead), { expirationTtl: 30 * 86400 });
  } catch { /* ultimo tentativo fallito: resta il log */ }
  console.error('LEAD_NON_SALVATO', JSON.stringify(lead));
}
