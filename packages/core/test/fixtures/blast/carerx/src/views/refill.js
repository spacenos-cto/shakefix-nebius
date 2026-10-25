import { el } from '../dom.js';
import { api } from '../api.js';
import { formatUsd } from '../lib/money.js';

export async function renderRefill({ params, navigate }) {
  const [rx, me] = await Promise.all([api.prescription(params.id), api.me()]);
  const error = el('p', { class: 'inline-error', role: 'alert', hidden: true });

  async function pay(event) {
    event?.preventDefault();
    error.hidden = true;
    try {
      const { order } = await api.refill(rx.id);
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  }

  const form = el('form', { class: 'card form', onsubmit: pay, novalidate: true },
    el('dl', { class: 'facts' },
      el('dt', {}, 'Medicine'), el('dd', { testid: 'refill-drug' }, `${rx.drug} ${rx.strengthLabel}`),
      el('dt', {}, 'Supply'), el('dd', {}, `${rx.daysSupply} days`),
      el('dt', {}, 'Pick up at'), el('dd', {}, me.pharmacy),
      el('dt', {}, 'Pay with'), el('dd', { testid: 'card' }, `${me.card.brand} •••• ${me.card.last4}`),
      el('dt', {}, 'Copay'), el('dd', { testid: 'copay' }, formatUsd(rx.copay)),
    ),
    error,
    el('button', {
      class: 'btn btn-primary btn-block', type: 'submit', testid: 'pay-btn',
      // SEEDED BUG C3 (billing): a click handler that also pays, on top of the form's submit
      // handler. One tap sends two refill requests, so the patient's copay is charged twice.
      onclick: () => { pay(); },
    }, `Pay ${formatUsd(rx.copay)} and refill`),
  );

  return [
    el('a', { href: `/rx/${rx.id}`, 'data-link': true, class: 'back' }, `← ${rx.drug}`),
    el('section', { class: 'hero' }, el('h1', {}, 'Refill'), el('p', { class: 'muted' }, 'Ready for pickup tomorrow after 10 am.')),
    form,
  ];
}
