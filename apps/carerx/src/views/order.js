import { el } from '../dom.js';
import { api } from '../api.js';
import { formatUsd } from '../lib/money.js';

export async function renderOrder({ params }) {
  const order = await api.order(params.id);
  return [
    el('section', { class: 'hero' },
      el('div', { class: 'tick', 'aria-hidden': 'true' }, '✓'),
      el('h1', { testid: 'order-confirmed' }, 'Refill ordered'),
      el('p', { class: 'muted' }, `${order.drug} · order #${order.id}`),
    ),
    el('div', { class: 'card' },
      el('h2', {}, 'Charged today'),
      el('ul', { class: 'charges', testid: 'charges-today' },
        order.chargesToday.map((c) => el('li', { testid: 'charge-row' }, el('span', {}, c.card), el('span', {}, formatUsd(c.amount))))),
      el('p', { class: 'total' }, 'Total ', el('strong', { testid: 'charged-total' }, formatUsd(order.chargedToday))),
    ),
    el('a', { href: '/', 'data-link': true, class: 'btn btn-block', testid: 'done-btn' }, 'Done'),
  ];
}
