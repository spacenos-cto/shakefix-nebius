import { el } from '../dom.js';
import { api } from '../api.js';

export async function renderHome() {
  const [me, list] = await Promise.all([api.me(), api.prescriptions()]);
  const rows = list.map((rx) =>
    el('a', { class: 'rx-row', href: `/rx/${rx.id}`, 'data-link': true, testid: `rx-row-${rx.id}` },
      el('span', { class: 'rx-main' },
        el('span', { class: 'rx-name' }, rx.drug),
        el('span', { class: 'muted' }, `${rx.strengthLabel} · ${rx.purpose}`),
      ),
      el('span', { class: rx.refillsLeft > 0 ? 'chip chip-ok' : 'chip chip-warn' },
        rx.refillsLeft > 0 ? `${rx.refillsLeft} ${rx.refillsLeft === 1 ? 'refill' : 'refills'} left` : 'Ask your doctor'),
    ));
  return [
    el('section', { class: 'hero' },
      el('p', { class: 'muted' }, me.pharmacy),
      el('h1', { testid: 'greeting' }, `Good morning, ${me.firstName}`),
      el('p', { class: 'muted' }, 'Tap a medicine to refill it.'),
    ),
    el('div', { class: 'card list', testid: 'rx-list' }, rows),
  ];
}
