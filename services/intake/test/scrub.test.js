import { describe, expect, it } from 'vitest';
import { scrubPhones, scrubReplay, scrubText } from '../src/scrub.js';
import { makeReplay } from './helpers.js';

describe('scrubText', () => {
  it('strips emails', () => {
    expect(scrubText('mail me at jane.doe+x@mail.example.co.uk please')).toBe('mail me at [email] please');
  });

  it('strips phone numbers in common formats', () => {
    expect(scrubText('call +91 98765 43210')).toBe('call [phone]');
    expect(scrubText('or (415) 555-0132 today')).toBe('or [phone] today');
    expect(scrubText('or 415.555.0132')).toBe('or [phone]');
  });

  it('keeps amounts, short numbers and ISO dates', () => {
    expect(scrubPhones('total 1000 split 3 ways')).toBe('total 1000 split 3 ways');
    expect(scrubPhones('paid 12000.50')).toBe('paid 12000.50');
    expect(scrubPhones('on 2026-10-11')).toBe('on 2026-10-11');
  });
});

describe('scrubReplay', () => {
  it('drops non-allowlisted input values and keeps allowlisted ones', () => {
    const r = scrubReplay(makeReplay(), ['total-input']);
    const title = r.actions.find((a) => a.testid === 'title-input');
    const total = r.actions.find((a) => a.testid === 'total-input');
    expect(title).not.toHaveProperty('value');
    expect(total.value).toBe('1000');
  });

  it('scrubs note, console emails and network query strings', () => {
    const r = scrubReplay(
      makeReplay({
        note: 'broken for me@x.io, ring 0412 345 678',
        console: [{ level: 'error', msg: 'user bob@x.io failed', stack: 'at a (b@c.de)' }],
      }),
      [],
    );
    expect(r.note).toBe('broken for [email], ring [phone]');
    expect(r.console[0].msg).toBe('user [email] failed');
    expect(r.network[0].path).toBe('/api/bills/7/settle');
  });

  it('does not mutate the input', () => {
    const input = makeReplay();
    scrubReplay(input, []);
    expect(input.actions[1].value).toBe('Dinner with bob@example.com');
  });
});
