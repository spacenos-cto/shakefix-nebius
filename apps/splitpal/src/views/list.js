import { el } from '../dom.js';
import { api } from '../api.js';
import { formatMoney } from '../lib/currency.js';
import { evalBug } from '../evalBugs.js';

/** "Last settled: Dinner at Toit" or the empty state. */
export function recentSettledText(bills) {
  const settled = bills.filter((b) => b.settled).sort((a, b) => b.id - a.id);
  // EVAL BUG E5 (off unless EVAL_BUG=E5): the empty state is missing, so with no settled bill
  // `settled[0]` is undefined and the whole list view crashes.
  if (evalBug('E5')) return `Last settled: ${settled[0].title}`;
  return settled.length ? `Last settled: ${settled[0].title}` : 'Nothing settled yet.';
}

export async function renderList({ navigate }) {
  const bills = await api.listBills();
  const rows = bills
    .slice()
    .sort((a, b) => b.id - a.id)
    .map((b) =>
      el(
        'a',
        { class: 'bill-row', href: `/bill/${b.id}`, testid: `bill-row-${b.id}`, 'data-link': true },
        el('span', { class: 'bill-row-main' },
          el('span', { class: 'bill-row-title' }, b.title),
          el('span', { class: 'muted' }, `${b.peopleCount} ${b.peopleCount === 1 ? 'person' : 'people'}`),
        ),
        el('span', { class: 'bill-row-side' },
          el('span', { class: 'amount' }, formatMoney(b.total, b.currency)),
          b.settled ? el('span', { class: 'chip chip-ok' }, 'Settled') : null,
        ),
      ),
    );

  return [
    el('section', { class: 'hero' },
      el('h1', {}, 'Your bills'),
      el('p', { class: 'muted' }, 'Split it, tip it, settle it.'),
      el('p', { class: 'muted small', testid: 'bill-count' }, `${bills.length} ${bills.length === 1 ? 'bill' : 'bills'}`),
      el('p', { class: 'muted small', testid: 'recent-settled' }, recentSettledText(bills)),
    ),
    el('button', { class: 'btn btn-primary btn-block', testid: 'new-bill-btn', type: 'button', onclick: () => navigate('/bill/new') }, '+ New bill'),
    rows.length ? el('div', { class: 'card list' }, rows) : el('p', { class: 'muted empty' }, 'No bills yet.'),
  ];
}
