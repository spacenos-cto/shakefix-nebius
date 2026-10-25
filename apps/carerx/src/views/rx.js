import { el } from '../dom.js';
import { api } from '../api.js';
import { formatDay } from '../lib/dates.js';

const REFILL_ICON = '<svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true"><rect x="12" y="10" width="24" height="30" rx="6" fill="currentColor" opacity=".18"/><rect x="15" y="6" width="18" height="7" rx="2" fill="currentColor"/><path d="M17 27a7 7 0 0 1 12-5l2-2v7h-7l2.5-2.5A4.5 4.5 0 0 0 19.6 27Z" fill="currentColor"/></svg>';

export async function renderRx({ params, navigate }) {
  const rx = await api.prescription(params.id);
  const canRefill = rx.refillsLeft > 0;

  const refill = el('button', { type: 'button', class: 'refill-tile', testid: 'refill-btn', 'aria-label': `Refill ${rx.drug}`, onclick: () => navigate(`/rx/${rx.id}/refill`) });
  refill.innerHTML = REFILL_ICON;

  return [
    el('a', { href: '/', 'data-link': true, class: 'back', testid: 'back-link' }, '← Your prescriptions'),
    el('section', { class: 'hero' },
      el('h1', { testid: 'rx-name' }, rx.drug),
      el('p', { class: 'strength', testid: 'rx-strength' }, `${rx.strengthLabel} ${rx.form}`),
      el('p', { class: 'muted' }, rx.purpose),
    ),
    el('div', { class: 'card' },
      el('p', { testid: 'rx-directions' }, rx.directions),
      el('dl', { class: 'facts' },
        el('dt', {}, 'Refills left'), el('dd', { testid: 'refills-left' }, String(rx.refillsLeft)),
        el('dt', {}, 'Last filled'), el('dd', {}, formatDay(rx.lastFilled)),
        el('dt', {}, 'Supply'), el('dd', {}, `${rx.daysSupply} days`),
      ),
    ),
    canRefill
      ? el('div', { class: 'refill-wrap' }, refill)
      : el('p', { class: 'notice', testid: 'no-refills' }, 'No refills left. Ask your doctor for a new prescription.'),
  ];
}
