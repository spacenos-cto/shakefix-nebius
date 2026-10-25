// Mission Control tab bar: which tabs exist, ?tab= in the URL, arrow-key movement. Pure, no DOM.

export const TABS = [
  { id: 'patients', label: 'Patients', hint: 'The board and the patient journey' },
  { id: 'feed', label: 'Live feed', hint: 'Every stage event as it happens' },
  { id: 'opinion', label: 'Second Opinion', hint: 'Intended vs unintended changes, and control runs' },
  { id: 'receipts', label: 'Receipts', hint: 'Every discharged case, with links and certificate' },
  { id: 'numbers', label: 'Numbers', hint: 'The headline numbers' },
];

export const DEFAULT_TAB = 'patients';
const IDS = TABS.map((t) => t.id);

/** ?tab=feed → 'feed'; unknown or missing → 'patients'. */
export function tabFromSearch(search) {
  const id = new URLSearchParams(search ?? '').get('tab');
  return IDS.includes(id) ? id : DEFAULT_TAB;
}

/** Query string with ?tab= set (dropped for the default tab), other params kept. Returns '' or '?…'. */
export function searchWithTab(search, id) {
  const q = new URLSearchParams(search ?? '');
  if (!IDS.includes(id) || id === DEFAULT_TAB) q.delete('tab');
  else q.set('tab', id);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Roving-focus target for a key on the tab list (WAI-ARIA tabs pattern), or null for other keys. */
export function tabKeyTarget(current, key) {
  const i = Math.max(0, IDS.indexOf(current));
  switch (key) {
    case 'ArrowRight': return IDS[(i + 1) % IDS.length];
    case 'ArrowLeft': return IDS[(i - 1 + IDS.length) % IDS.length];
    case 'Home': return IDS[0];
    case 'End': return IDS[IDS.length - 1];
    default: return null;
  }
}
