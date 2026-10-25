import { el } from '../dom.js';
import { api } from '../api.js';
import { getPrefs } from '../prefs.js';
import { evalBug } from '../evalBugs.js';

export function renderNewBill({ navigate }) {
  const prefs = getPrefs();
  const error = el('p', { class: 'inline-error', role: 'alert', hidden: true });
  const people = el('div', { class: 'people' });

  const title = el('input', {
    id: 'title', type: 'text', testid: 'title-input', placeholder: 'Dinner at Toit',
    autocomplete: 'off', 'data-shakefix-allow': true,
  });
  const total = el('input', {
    id: 'total', type: 'number', inputmode: 'decimal', step: '0.01', min: '0',
    testid: 'total-input', placeholder: '1000',
  });

  function addPerson(value = '') {
    const n = people.children.length;
    const input = el('input', {
      type: 'text', testid: `person-input-${n}`, placeholder: `Person ${n + 1}`,
      'aria-label': `Person ${n + 1}`, autocomplete: 'off', value,
    });
    people.append(input);
    return input;
  }
  addPerson();

  async function save(event) {
    event?.preventDefault();
    error.hidden = true;
    const amount = Number(total.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      error.textContent = 'Enter a total greater than zero.';
      error.hidden = false;
      return;
    }
    // Names are sent as typed — no trimming or blank check (see SEEDED_BUGS.md, B2).
    const names = [...people.querySelectorAll('input')].map((i) => i.value);
    const bill = await api.createBill({
      title: title.value,
      total: amount,
      // SEEDED BUG B7: ignores the default currency from Settings (the label above shows it).
      currency: 'INR',
      tipPct: 0,
      people: names,
    });
    navigate(`/bill/${bill.id}`, { replace: true });
  }

  const form = el('form', { class: 'card form', onsubmit: save, novalidate: true },
    el('label', { for: 'title' }, 'What was it for?'), title,
    el('label', { for: 'total' }, `Total (${prefs.currency})`), total,
    el('span', { class: 'label' }, 'Who is splitting?'), people,
    el('button', { class: 'btn btn-ghost', type: 'button', testid: 'add-person-btn', onclick: () => addPerson().focus() }, '+ Add person'),
    error,
    el('button', {
      class: 'btn btn-primary btn-block', type: 'submit', testid: 'save-bill-btn',
      // EVAL BUG E6 (off unless EVAL_BUG=E6): a click handler that also saves, on top of the form's
      // submit handler, so one tap creates the bill twice (double submit).
      onclick: evalBug('E6') ? () => { save(); } : null,
    }, 'Save bill'),
  );

  return [el('section', { class: 'hero' }, el('h1', {}, 'New bill')), form];
}
