// Same-origin JSON API client. `?now=<ISO>` on page load is forwarded as `x-test-now`
// (honoured only when the server runs with test hooks).
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
  me: () => request('GET', '/api/me'),
  setPrivacy: (privacy) => request('PATCH', '/api/me/privacy', privacy),
  prescriptions: () => request('GET', '/api/prescriptions'),
  prescription: (id) => request('GET', `/api/prescriptions/${encodeURIComponent(id)}`),
  refill: (id) => request('POST', `/api/prescriptions/${encodeURIComponent(id)}/refills`, {}),
  orders: () => request('GET', '/api/orders'),
  order: (id) => request('GET', `/api/orders/${encodeURIComponent(id)}`),
};
