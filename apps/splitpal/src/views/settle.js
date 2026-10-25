import { el } from '../dom.js';
import { api } from '../api.js';
import { formatMoney } from '../lib/currency.js';

export async function renderSettle({ params }) {
  const bill = await api.getBill(params.id);
  const paid = new Set(bill.settled ? bill.paid : []);

  const banner = el('div', { class: 'banner banner-ok', testid: 'settled-banner', role: 'status', hidden: !bill.settled }, 'Settled ✓ Everyone is square.');
  const status = el('p', { class: 'muted settle-status', role: 'status' });

  const rows = bill.shares.map((s) => {
    const btn = el('button', {
      type: 'button', class: 'btn btn-small', testid: `pay-${s.name}-btn`,
      'aria-pressed': String(paid.has(s.name)),
      onclick: () => {
        if (paid.has(s.name)) paid.delete(s.name);
        else paid.add(s.name);
        sync();
      },
    });
    const row = el('li', { class: 'share' },
      el('span', { class: 'share-name' }, s.name),
      el('span', { class: 'amount' }, formatMoney(s.amount, bill.currency)),
      btn,
    );
    return { s, btn, row };
  });

  const confirm = el('button', {
    type: 'button', class: 'btn btn-primary btn-block', testid: 'confirm-settle-btn',
    onclick: async () => {
      confirm.disabled = true;
      try {
        const result = await api.settleBill(bill.id, [...paid]);
        if (result.ok) {
          banner.hidden = false;
          status.textContent = '';
        } else if (!result.everyonePaid) {
          status.textContent = 'Mark everyone as paid first.';
        } else {
          status.textContent = `Collected ${formatMoney(result.paidTotal, bill.currency)} of ${formatMoney(result.total, bill.currency)}. Not settled yet.`;
        }
      } finally {
        confirm.disabled = false;
      }
    },
  }, 'Confirm settlement');

  function sync() {
    for (const { s, btn, row } of rows) {
      const isPaid = paid.has(s.name);
      btn.textContent = isPaid ? 'Paid ✓' : 'Mark paid';
      btn.setAttribute('aria-pressed', String(isPaid));
      row.classList.toggle('is-paid', isPaid);
    }
  }
  sync();

  return [
    el('section', { class: 'hero' },
      el('p', { class: 'eyebrow' }, bill.title),
      el('h1', {}, 'Settle up'),
      el('p', { class: 'muted' }, `${formatMoney(bill.grandTotal, bill.currency)} including tip`),
    ),
    banner,
    el('div', { class: 'card' }, el('ul', { class: 'shares' }, rows.map((r) => r.row))),
    status,
    confirm,
  ];
}
