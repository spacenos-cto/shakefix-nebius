// Public README badge: GET /v1/badge.svg → "ShakeFix | Discharged N · 👍 X%". Pure.

const LIVE = new Set(['deployed', 'verified']);

/**
 * @param {Array<object>} records  primary report records
 * @param {(r: object) => 'confirmed'|'rejected'|null} verdictOf  current-round verdict
 */
export function badgeStats(records, verdictOf) {
  const primaries = (records ?? []).filter((r) => r && r.primary !== false);
  const discharged = primaries.filter((r) => LIVE.has(r.state)).length;
  let confirmed = 0;
  let rejected = 0;
  for (const r of primaries) {
    const v = verdictOf(r);
    if (v === 'confirmed') confirmed += 1;
    else if (v === 'rejected') rejected += 1;
  }
  const judged = confirmed + rejected;
  return { discharged, confirmed, rejected, confirmedPct: judged ? Math.round((100 * confirmed) / judged) : null };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Rough text width for Verdana 11px (shields.io style) so the badge sizes itself without a font. */
function textWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    if (/[ilI.,:;'|!]/.test(ch)) w += 3.5;
    else if (/[mwMW%]/.test(ch)) w += 10;
    else if (/[A-Z0-9#]/.test(ch)) w += 7.5;
    else if (ch.codePointAt(0) > 0x2000) w += 12; // emoji / symbols
    else w += 6.3;
  }
  return Math.ceil(w);
}

/** shields.io-style flat badge. `message` e.g. "Discharged 3 · 👍 100%". */
export function renderBadge({ label = 'ShakeFix', message, color = '#2da160' }) {
  const lw = textWidth(label) + 12;
  const mw = textWidth(message) + 12;
  const w = lw + mw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(message)}">
<title>${esc(label)}: ${esc(message)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#111110"/><rect x="${lw}" width="${mw}" height="20" fill="${esc(color)}"/><rect width="${w}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="14">${esc(label)}</text>
<text x="${lw + mw / 2}" y="14">${esc(message)}</text>
</g>
</svg>
`;
}

export function badgeMessage(stats, { demo = false } = {}) {
  const pct = stats.confirmedPct == null ? '—' : `${stats.confirmedPct}%`;
  return `${demo ? 'DEMO · ' : ''}Discharged ${stats.discharged} · 👍 ${pct}`;
}

export function badgeColor(stats) {
  if (stats.confirmedPct == null) return '#6b6b6b';
  if (stats.confirmedPct >= 80) return '#2da160';
  if (stats.confirmedPct >= 50) return '#d9902a';
  return '#d6493b';
}
