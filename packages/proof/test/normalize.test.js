import { describe, it, expect } from 'vitest';
import {
  normalizePath, routeOf, normalizeBody, normalizeTextMap, normalizeApiEntry, normalizeAudit, billIdOf, joinPath,
} from '../src/normalize.js';

describe('normalizePath', () => {
  it('replaces numeric segments with :id and drops query/hash/origin', () => {
    expect(normalizePath('/api/bills/42/settle?x=1#y')).toBe('/api/bills/:id/settle');
    expect(normalizePath('https://mr-42---splitpal.run.app/api/bills/7')).toBe('/api/bills/:id');
    expect(normalizePath('/api/bills/')).toBe('/api/bills');
    expect(normalizePath('/api/v2/bills')).toBe('/api/v2/bills');
  });
  it('routeOf keeps concrete ids', () => {
    expect(routeOf('http://localhost:8080/bill/9/settle?x=1')).toBe('/bill/9/settle');
    expect(routeOf('http://localhost:8080/')).toBe('/');
  });
});

describe('normalizeBody', () => {
  it('sorts keys and removes volatile keys at any depth', () => {
    const out = normalizeBody({ z: 1, id: 9, a: { updatedAt: 'x', b: [{ ts: 1, createdAt: 2, k: 3, id: 4 }] } });
    expect(JSON.stringify(out)).toBe('{"a":{"b":[{"k":3}]},"z":1}');
  });
  it('normalizeApiEntry upper-cases method and normalizes path', () => {
    expect(normalizeApiEntry({ method: 'post', path: '/api/bills/4/settle', status: '200', body: { ok: true, id: 4 } }))
      .toEqual({ method: 'POST', path: '/api/bills/:id/settle', status: 200, body: { ok: true } });
  });
});

describe('text + audit', () => {
  it('drops app-version, collapses whitespace, sorts keys', () => {
    const out = normalizeTextMap({ 'tip-total': ' ₹49.99\n', 'app-version': 'va1b2c3d', 'bill-total': 'a   b' });
    expect(Object.keys(out)).toEqual(['bill-total', 'tip-total']);
    expect(out['tip-total']).toBe('₹49.99');
    expect(out['bill-total']).toBe('a b');
  });
  it('normalizeAudit keeps {op, table, fields} without volatile keys', () => {
    expect(normalizeAudit([{ ts: 1, op: 'update', table: 'bills', rowId: 4, fields: { updatedAt: 'x', settled: true } }]))
      .toEqual([{ op: 'update', table: 'bills', fields: { settled: true } }]);
  });
});

describe('helpers', () => {
  it('billIdOf reads routes and bill-row testids', () => {
    expect(billIdOf({ route: '/bill/9' })).toBe('9');
    expect(billIdOf({ route: '/bill/9/settle' })).toBe('9');
    expect(billIdOf({ route: '/bill/new' })).toBe(null);
    expect(billIdOf({ route: '/', testid: 'bill-row-3' })).toBe('3');
  });
  it('joinPath formats JSON paths', () => {
    expect(joinPath(joinPath(joinPath('$', 'shares'), 1), 'amount')).toBe('$.shares[1].amount');
    expect(joinPath('$', 'a b')).toBe('$["a b"]');
  });
});
