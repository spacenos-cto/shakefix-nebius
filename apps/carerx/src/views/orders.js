import { el } from '../dom.js';
import { api } from '../api.js';
import { formatDay } from '../lib/dates.js';

function orderRow(o) {
  return el('a', { class: 'rx-row', href: `/orders/${o.id}`, 'data-link': true, testid: `order-row-${o.id}` },
    el('span', { class: 'rx-main' },
      el('span', { class: 'rx-name' }, o.drug),
      el('span', { class: 'muted' }, formatDay(o.createdAt)),
    ),
    el('span', { class: 'chip chip-ok' }, o.status),
  );
}

export async function renderOrders() {
  const orders = await api.orders();
  return [
    el('section', { class: 'hero' }, el('h1', {}, 'Your orders')),
    orders.length
      ? el('div', { class: 'card list' }, orders.map(orderRow))
      : el('p', { class: 'muted empty', testid: 'no-orders' }, 'No orders yet.'),
  ];
}
