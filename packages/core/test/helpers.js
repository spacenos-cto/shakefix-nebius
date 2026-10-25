// Recording fake fetch. `route(call)` returns {status, body} (body object -> JSON, string -> text).

export function fakeFetch(route = () => ({ status: 200, body: {} })) {
  const calls = [];
  async function fetch(url, init = {}) {
    const u = new URL(url);
    let body = init.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* keep text */ }
    }
    const call = {
      method: init.method || 'GET',
      url: String(url),
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      headers: init.headers || {},
      body,
    };
    calls.push(call);
    const r = (await route(call)) || { status: 200, body: {} };
    if (r.throw) throw r.throw;
    const status = r.status ?? 200;
    const text = r.body === undefined || r.body === null ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  }
  return { fetch, calls };
}
