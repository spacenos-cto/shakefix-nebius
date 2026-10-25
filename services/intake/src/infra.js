// Infra triage: is this report a code bug, or is the platform hurting (no compute, network down,
// expired secrets, 5xx)? Agents can fix code; they must never "fix" a platform problem with a code
// change. When the platform looks sick, the issue is labelled infra::suspected + needs-human and the
// on-call human is paged.
//
// Two sources: signals in the replay the user sent (network + console), and a live health probe of the
// app (only for origins in ALLOWED_ORIGINS, so a report can't make the intake call arbitrary URLs).

export const INFRA_LABEL = 'infra::suspected';

const SLOW_MS = 10_000;
// Messages that point at the platform, not the app's own logic.
const PLATFORM_RE = /(failed to fetch|networkerror|load failed|net::err_|err_(connection|name_not_resolved|internet_disconnected|timed_out)|econnrefused|etimedout|enotfound|socket hang up|\b50[234]\b|service unavailable|bad gateway|gateway time-?out|quota|resource[_ ]exhausted|out of memory|oom|enospc|no space left|permission[_ ]denied|unauthenticated|invalid[_ ]grant|expired (token|credential|secret)|secret .*not found)/i;

/** Platform signals in a replay: [{kind: 'server-error'|'network'|'slow'|'platform-error', detail}] */
export function infraSignalsFromReplay(replay) {
  const out = [];
  for (const n of replay?.network ?? []) {
    const where = `${n.method} ${n.path}`;
    if (n.status === 0) out.push({ kind: 'network', detail: `${where} never got a response` });
    else if (n.status >= 500) out.push({ kind: 'server-error', detail: `${where} → ${n.status}` });
    else if (n.ms >= SLOW_MS) out.push({ kind: 'slow', detail: `${where} took ${Math.round(n.ms / 1000)}s` });
  }
  for (const c of replay?.console ?? []) {
    if (c.level === 'error' && PLATFORM_RE.test(c.msg ?? '')) out.push({ kind: 'platform-error', detail: String(c.msg).slice(0, 160) });
  }
  return out.slice(0, 8);
}

/**
 * Probe the app's health endpoint right now. Only probes origins on the allowlist.
 * @returns {Promise<{probed: boolean, ok?: boolean, status?: number, ms?: number, error?: string, url?: string}>}
 */
export async function probeApp({ baseUrl, allowedOrigins = [], fetchImpl = fetch, path = '/api/health', timeoutMs = 4000, now = () => Date.now() }) {
  let origin;
  try { origin = new URL(baseUrl).origin; } catch { return { probed: false }; }
  if (!allowedOrigins.includes(origin)) return { probed: false };
  const url = `${origin}${path}`;
  const t0 = now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    return { probed: true, url, ok: res.ok, status: res.status, ms: now() - t0 };
  } catch (err) {
    return { probed: true, url, ok: false, ms: now() - t0, error: err?.name === 'AbortError' ? `no answer in ${timeoutMs / 1000}s` : String(err?.message ?? err).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

/** Decide. A failing probe alone is enough; replay signals need a server/network/platform kind. */
export function assessInfra({ signals = [], probe = { probed: false } }) {
  const reasons = [];
  if (probe.probed && !probe.ok) reasons.push(`health check ${probe.url} failed (${probe.status ?? probe.error})`);
  for (const s of signals) if (s.kind !== 'slow') reasons.push(s.detail);
  const slow = signals.filter((s) => s.kind === 'slow');
  if (slow.length >= 2) reasons.push(`${slow.length} slow requests (${slow[0].detail})`);
  return { suspected: reasons.length > 0, reasons: reasons.slice(0, 6), probe, signals };
}

/** Markdown section for the issue body. */
export function infraSection(a, { maintainer } = {}) {
  if (!a?.suspected) return '';
  const health = a.probe?.probed
    ? `Live health check: \`${a.probe.url}\` → ${a.probe.ok ? `OK ${a.probe.status}` : `FAILED (${a.probe.status ?? a.probe.error})`} in ${a.probe.ms} ms.`
    : 'Live health check: not run (app origin not on the allowlist).';
  return [
    '## 🚨 Infra triage: this may not be a code bug',
    '',
    ...a.reasons.map((r) => `- ${r}`),
    '',
    health,
    '',
    `Agents will not change code to work around a platform problem. ${maintainer ? `Paged @${String(maintainer).replace(/^@/, '')}.` : 'Paged the on-call human.'}`,
    'Check: Cloud Run revisions and quotas, Secret Manager versions, recent infra changes, network.',
  ].join('\n');
}

/** Body + headers for the page, shaped for the receiving service. */
export function pageRequest(webhookUrl, { title, text, url }) {
  let host = '';
  try { host = new URL(webhookUrl).hostname; } catch { /* invalid */ }
  if (host === 'ntfy.sh' || host.endsWith('.ntfy.sh')) {
    // ntfy: free phone push, no account. Subscribe to the topic in the ntfy app.
    return { headers: { 'content-type': 'text/plain', title: title.replace(/[^ -~]/g, ''), priority: 'urgent', tags: 'rotating_light', ...(url ? { click: url } : {}) }, body: text };
  }
  if (host === 'hooks.slack.com') return { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `*${title}*
${text}${url ? `
${url}` : ''}` }) };
  if (host === 'discord.com' || host === 'discordapp.com') return { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: `**${title}**
${text}${url ? `
${url}` : ''}` }) };
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, text, url }) };
}

/** Page the on-call human through PAGER_WEBHOOK_URL (ntfy, Slack, Discord or any JSON endpoint). Never throws. */
export async function pageHuman({ webhookUrl, fetchImpl = fetch, title, text, url, log = () => {} }) {
  if (!webhookUrl) return { sent: false };
  try {
    const { headers, body } = pageRequest(webhookUrl, { title, text, url });
    const res = await fetchImpl(webhookUrl, { method: 'POST', headers, body });
    return { sent: res.ok, status: res.status };
  } catch (err) {
    log(`page webhook failed: ${err?.message ?? err}`);
    return { sent: false, error: String(err?.message ?? err) };
  }
}
