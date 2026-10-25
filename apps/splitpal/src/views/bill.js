import { el } from '../dom.js';
import { api } from '../api.js';
import { formatMoney, formatHeaderTotal, CURRENCIES } from '../lib/currency.js';
import { TIP_OPTIONS, MAX_CUSTOM_TIP, isValidCustomTip } from '../lib/tip.js';
import { formatBillDate } from '../lib/dates.js';

function initials(name) {
  // A blank name has no first character: fall back to an empty avatar.
  return (name.trim()[0] || '').toUpperCase();
}

export async function renderBill({ params, navigate, rerender }) {
  const bill = await api.getBill(params.id);

  async function patch(change) {
    await api.updateBill(bill.id, change);
    rerender();
  }

  const isPreset = TIP_OPTIONS.includes(bill.tipPct);
  const tipSelect = el('select', {
    id: 'tip', testid: 'tip-select', 'data-shakefix-allow': true,
    onchange: (e) => { if (e.target.value !== '') patch({ tipPct: Number(e.target.value) }); },
  }, [
    ...TIP_OPTIONS.map((p) => el('option', { value: String(p), selected: p === bill.tipPct }, `${p}%`)),
    el('option', { value: '', selected: !isPreset, disabled: true }, isPreset ? 'Custom' : `${bill.tipPct}%`),
  ]);

  const tipError = el('p', { class: 'inline-error', role: 'alert', testid: 'tip-error', hidden: true });
  const customTip = el('input', {
    id: 'tip-custom', type: 'number', inputmode: 'decimal', step: '0.01', testid: 'tip-custom-input',
    placeholder: 'Custom %', 'aria-label': 'Custom tip percent', 'data-shakefix-allow': true,
  });
  const applyTip = el('button', {
    type: 'button', class: 'btn btn-small', testid: 'tip-apply-btn',
    onclick: () => {
      const raw = customTip.value;
      if (!isValidCustomTip(raw)) {
        tipError.textContent = `Tip must be between 0 and ${MAX_CUSTOM_TIP}%.`;
        tipError.hidden = false;
        return;
      }
      tipError.hidden = true;
      patch({ tipPct: Number(raw) });
    },
  }, 'Apply');

  const currencySelect = el('select', {
    id: 'currency', testid: 'currency-select', 'data-shakefix-allow': true,
    onchange: (e) => patch({ currency: e.target.value }),
  }, CURRENCIES.map((c) => el('option', { value: c, selected: c === bill.currency }, c)));

  const shares =bill.shares.map((s) =>
    el('li', { class: 'share' },
      el('span', { class: 'avatar', 'aria-hidden': 'true' }, initials(s.name)),
      el('span', { class: 'share-name' }, s.name),
      el('span', { class: 'amount', testid: `share-${s.name}` }, formatMoney(s.amount, bill.currency)),
    ),
  );

  return [
    el('section', { class: 'hero' },
      el('p', { class: 'eyebrow' }, bill.title),
      el('p', { class: 'muted small' }, 'Bill total'),
      el('h1', { class: 'total', testid: 'bill-total' }, formatHeaderTotal(bill.total, bill.currency)),
      el('p', { class: 'muted small', testid: 'bill-date' }, `Added ${formatBillDate(bill.createdAt)}`),
      bill.settled ? el('span', { class: 'chip chip-ok' }, 'Settled') : null,
    ),
    el('div', { class: 'card controls' },
      el('label', { for: 'tip' }, 'Tip', tipSelect),
      el('label', { for: 'tip-custom' }, 'Custom tip %', el('span', { class: 'row' }, customTip, applyTip)),
      tipError,
      el('label', { for: 'currency' }, 'Currency', currencySelect),
      el('div', { class: 'row' },
        el('span', { class: 'muted' }, 'Tip amount'),
        el('span', { class: 'amount', testid: 'tip-total' }, formatMoney(bill.tip, bill.currency)),
      ),
    ),
    el('div', { class: 'card' },
      el('h2', {}, 'Each person pays'),
      el('ul', { class: 'shares' }, shares),
    ),
    el('button', {
      class: 'btn btn-primary btn-block', type: 'button', testid: 'settle-btn',
      onclick: () => navigate(`/bill/${bill.id}/settle`),
    }, bill.settled ? 'View settlement' : 'Settle up'),
  ];
}
