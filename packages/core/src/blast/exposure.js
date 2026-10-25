// Exposure model: bug category -> formula over the (SYNTHETIC) insights numbers + plain text.
//
// Honesty rules:
//   - every number comes from /api/insights/affected, which is a synthetic demo population;
//   - the only money figure is billing's "refills x avg copay" upper bound, labelled as such;
//   - legal exposure is qualitative text only. No fines or damages are computed for this app.
//     `CONTEXT` lists public facts a human verified on the source page (docs/STATS.md); they give
//     real-world context, they are not an estimate for this bug.

const usd = (n) => `$${Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const fmt = (n) => Number(n).toLocaleString('en-US');

export const CATEGORIES = {
  billing: {
    label: 'Billing',
    keywords: ['charge', 'charged', 'charges', 'pay', 'paid', 'payment', 'copay', 'refund', 'bill', 'billed', 'twice', 'double', 'duplicate', 'price', 'card', 'receipt', 'overcharge'],
    segment: null,
    formula: 'affected refills × avg copay = potential overcharge (upper bound)',
    compute(d) {
      if (!Number.isFinite(d?.patients)) return { value: null, text: 'Patients affected unknown (app insights not reachable), so no overcharge estimate.' };
      const refills = Number.isFinite(d.refills) ? Math.min(d.patients, d.refills) : d.patients;
      const copay = Number(d.avgCopay) || 0;
      const value = Math.round(refills * copay * 100) / 100;
      return {
        value,
        text: `Up to ${fmt(refills)} refills × ${usd(copay)} avg copay = up to ${usd(value)} in possible duplicate charges over ${d.windowDays ?? '?'} days (synthetic demo population; upper bound that assumes every refill was charged twice).`,
      };
    },
    legal: 'Duplicate charges usually mean refunds owed to patients and can raise consumer-protection and card-dispute questions. A human should confirm which rules apply.',
  },
  accessibility: {
    label: 'Accessibility',
    keywords: ['screen reader', 'screenreader', 'voiceover', 'talkback', 'keyboard', 'focus', 'tab key', 'label', 'a11y', 'accessib', 'blind', 'cannot reach', "can't reach", 'announce', 'aria'],
    segment: 'screen-reader',
    formula: 'patients in the screen-reader segment who used this route/component',
    compute(d) {
      if (!Number.isFinite(d?.patients)) return { value: null, text: 'Patients affected unknown (app insights not reachable).' };
      return { value: d.patients, text: `${fmt(d.patients)} patients who use a screen reader could not complete this action in the last ${d.windowDays ?? '?'} days (synthetic demo population).` };
    },
    legal: 'Controls that assistive technology cannot use in a health app may raise disability-access obligations (for example WCAG-based requirements). Jurisdiction-specific; needs human review.',
  },
  privacy: {
    label: 'Privacy',
    keywords: ['privacy', 'share', 'sharing', 'health data', 'partners', 'consent', 'opt out', 'opt-out', 'data', 'tracking'],
    segment: null,
    formula: 'patients who used the privacy control',
    compute(d) {
      if (!Number.isFinite(d?.patients)) return { value: null, text: 'Patients affected unknown (app insights not reachable).' };
      return { value: d.patients, text: `${fmt(d.patients)} patients used this privacy control in the last ${d.windowDays ?? '?'} days; their choice may not have been saved (synthetic demo population).` };
    },
    legal: 'Ignoring a patient\'s choice about sharing health data may be a reportable privacy issue. Rules differ by jurisdiction; needs human review.',
  },
  'medication-info': {
    label: 'Medication info',
    keywords: ['dose', 'dosage', 'strength', 'mg', 'mcg', 'microgram', 'milligram', 'directions', 'label', 'wrong medicine', 'levothyroxine', 'units'],
    segment: null,
    formula: 'patients who viewed the medication information',
    compute(d) {
      if (!Number.isFinite(d?.patients)) return { value: null, text: 'Patients affected unknown (app insights not reachable).' };
      return { value: d.patients, text: `${fmt(d.patients)} patients saw this medication information in the last ${d.windowDays ?? '?'} days and may have read a wrong value (synthetic demo population).` };
    },
    legal: 'Wrong dose information is a patient-safety issue first; it may also carry regulatory reporting duties. Needs human review.',
  },
  general: {
    label: 'General',
    keywords: [],
    segment: null,
    formula: 'patients who used this route/component',
    compute(d) {
      if (!Number.isFinite(d?.patients)) return { value: null, text: 'Patients affected unknown (app insights not reachable).' };
      return { value: d.patients, text: `${fmt(d.patients)} patients used this in the last ${d.windowDays ?? '?'} days (synthetic demo population).` };
    },
    legal: 'No specific legal exposure identified automatically.',
  },
};

// Human-verified context (docs/STATS.md, VERIFIED rows only).
export const CONTEXT = {
  accessibility: [
    { text: '3,117 federal website-accessibility lawsuits were filed in 2025 (Seyfarth Shaw)', url: 'https://www.adatitleiii.com/2026/03/federal-court-website-accessibility-lawsuit-filings-bounce-back-in-2025/' },
    { text: '13.6M US adults 65+ have trouble seeing even with glasses (AFB, from CDC NHIS)', url: 'https://afb.org/research-and-initiatives/statistics/older-vision-loss/estimates-nhis' },
  ],
  privacy: [
    { text: 'FTC: GoodRx paid a $1.5M civil penalty after sharing health data it promised never to share (2023)', url: 'https://www.ftc.gov/news-events/news/press-releases/2023/02/ftc-enforcement-action-bar-goodrx-sharing-consumers-sensitive-health-info-advertising' },
    { text: 'FTC: BetterHelp to pay $7.8M to consumers over health-data sharing (2023)', url: 'https://www.ftc.gov/news-events/news/press-releases/2023/03/ftc-ban-betterhelp-revealing-consumers-data-including-sensitive-mental-health-information-facebook' },
  ],
  'medication-info': [
    { text: 'ISMP: the microgram symbol is "mistaken as mg"; write "mcg"', url: 'https://online.ecri.org/hubfs/ISMP/Resources/ISMP_ErrorProneAbbreviation_List.pdf' },
    { text: '43% of US adults 65+ take five or more prescription drugs (CDC NCHS)', url: 'https://www.cdc.gov/nchs/hus/topics/rx-drug-use.htm' },
  ],
  billing: [],
  general: [],
};

// Tie-break: most severe first.
const ORDER = ['medication-info', 'privacy', 'billing', 'accessibility'];
const FILE_HINTS = [[/dosing\//, 'medication-info'], [/privacy/i, 'privacy'], [/money|billing|charge|refill/i, 'billing']];
const TESTID_HINTS = [[/pay|charge|copay/i, 'billing'], [/privacy|share/i, 'privacy'], [/strength|dose|directions/i, 'medication-info']];

/** Pick a category from the replay note, testids and changed files. */
export function detectCategory({ note = '', testids = [], files = [] } = {}) {
  const text = ` ${String(note).toLowerCase()} `;
  const score = Object.fromEntries(ORDER.map((c) => [c, 0]));
  for (const c of ORDER) {
    for (const k of CATEGORIES[c].keywords) {
      const re = new RegExp(`(^|[^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      if (re.test(text)) score[c] += 2;
    }
  }
  for (const t of testids) for (const [re, c] of TESTID_HINTS) if (re.test(t)) score[c] += 1;
  for (const f of files) for (const [re, c] of FILE_HINTS) if (re.test(f)) score[c] += 1;
  const best = ORDER.reduce((a, c) => (score[c] > score[a] ? c : a), ORDER[0]);
  return score[best] > 0 ? best : 'general';
}

/** Exposure for a category over an insights response (or null when offline). */
export function exposureFor(category, data) {
  const cat = CATEGORIES[category] ?? CATEGORIES.general;
  const { value, text } = cat.compute(data);
  return {
    category: CATEGORIES[category] ? category : 'general',
    formula: cat.formula,
    value,
    text,
    legal: {
      text: cat.legal,
      // Verified public context only (see CONTEXT). Never add dollar amounts for this app's legal exposure.
      sources: CONTEXT[CATEGORIES[category] ? category : 'general'] ?? [],
    },
  };
}
