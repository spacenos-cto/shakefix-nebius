// Same-origin JSON API client.
// A `?now=<ISO>` query param on page load is forwarded as `x-test-now` (honoured only when
// the server runs with test hooks) so B4 can be reproduced by hand on a preview URL.

const testNow = new URLSearchParams(location.search).get('now');

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (testNow) headers['x-test-now'] = testNow;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `${method} ${path} failed (${res.status})`);
  return data;
}

export const api = {
  listBills: () => request('GET', '/api/bills'),
  getBill: (id) => request('GET', `/api/bills/${encodeURIComponent(id)}`),
  createBill: (bill) => request('POST', '/api/bills', bill),
  updateBill: (id, patch) => request('PATCH', `/api/bills/${encodeURIComponent(id)}`, patch),
  settleBill: (id, paid) => request('POST', `/api/bills/${encodeURIComponent(id)}/settle`, { paid }),
  session: () => request('GET', '/api/session'),
};
