import { loadConfig } from '../src/config.js';

export function makeReplay(over = {}) {
  return {
    schema: 'shakefix.replay/v1',
    rid: 'r_20261011_8f3a01',
    app: { name: 'splitpal', version: 'a1b2c3d', baseUrl: 'https://splitpal.example.run.app' },
    device: { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', viewport: [390, 844], touch: true },
    trigger: 'shake',
    note: 'settle button does nothing',
    startRoute: '/',
    actions: [
      { t: 0, type: 'click', testid: 'new-bill-btn', selector: '[data-testid=new-bill-btn]', route: '/' },
      { t: 400, type: 'input', testid: 'title-input', selector: '[data-testid=title-input]', value: 'Dinner with bob@example.com', route: '/bill/new' },
      { t: 812, type: 'input', testid: 'total-input', selector: '[data-testid=total-input]', value: '1000', route: '/bill/new' },
      { t: 1500, type: 'click', testid: 'settle-btn', selector: '[data-testid=settle-btn]', route: '/bill/7' },
    ],
    expectation: { testid: 'settled-banner', state: 'visible' },
    console: [],
    network: [{ method: 'POST', path: '/api/bills/7/settle?u=a@b.co', status: 200, ms: 41 }],
    ...over,
  };
}

// 1x1 transparent PNG
export const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function testConfig(over = {}) {
  return {
    ...loadConfig({
      GITLAB_URL: 'https://gitlab.test',
      GITLAB_PROJECT_ID: 'grp/shakefix',
      GITLAB_HUMAN_PAT: 'glpat-test-not-real',
      GITLAB_WEBHOOK_SECRET: 'wh-secret',
      INTAKE_HOOK_SECRET: 'hook-secret',
      FLOW_SERVICE_ACCOUNT: 'ai-shakefix-grp',
      ALLOWED_ORIGINS: 'https://splitpal.example.run.app',
      PUBLIC_URL: 'https://intake.test',
      MEMORY_LESSONS: '0', // exact GitLab call sequences; the memory hook has its own test
    }),
    ...over,
  };
}

/**
 * Fake fetch emulating the handful of GitLab endpoints the intake uses.
 * Records every call in `calls` (url, method, headers, body).
 */
export function fakeGitlab({ openIssues = [], failOn = null, labelEvents = [] } = {}) {
  const calls = [];
  let nextIid = 41;
  let nextNote = 900;
  const issues = [...openIssues];

  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

  async function fetch(url, init = {}) {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const path = u.pathname.replace(/^\/api\/v4/, '');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, path, query: Object.fromEntries(u.searchParams), headers: init.headers, body });
    if (failOn && failOn(method, path)) return json(500, { message: 'boom' });

    if (method === 'GET' && /^\/projects\/[^/]+$/.test(path)) return json(200, { id: 1, default_branch: 'main' });
    if (method === 'GET' && /\/resource_label_events$/.test(path)) return json(200, labelEvents);
    if (method === 'GET' && /\/issues$/.test(path)) {
      const label = u.searchParams.get('labels');
      return json(200, issues.filter((i) => i.labels.includes(label) && i.state === 'opened'));
    }
    if (method === 'POST' && /\/repository\/commits$/.test(path)) return json(201, { id: 'abc123' });
    if (method === 'POST' && /\/uploads$/.test(path)) {
      return json(201, { alt: 'shot', url: '/uploads/x/shot.png', full_path: '/grp/shakefix/uploads/x/shot.png', markdown: '![shot](/uploads/x/shot.png)' });
    }
    if (method === 'POST' && /\/issues$/.test(path)) {
      const iid = nextIid++;
      const issue = { iid, title: body.title, labels: body.labels.split(','), state: 'opened', web_url: `https://gitlab.test/grp/shakefix/-/issues/${iid}` };
      issues.push(issue);
      return json(201, issue);
    }
    if (method === 'POST' && /\/issues\/\d+\/notes$/.test(path)) return json(201, { id: nextNote++, body: body.body });
    if (method === 'PUT' && /\/issues\/\d+$/.test(path)) {
      const iid = Number(path.split('/').pop());
      const issue = issues.find((i) => i.iid === iid);
      if (!issue) return json(404, { message: '404 Issue Not Found' });
      const add = String(body.add_labels ?? '').split(',').filter(Boolean);
      const remove = new Set(String(body.remove_labels ?? '').split(',').filter(Boolean));
      issue.labels = [...new Set([...issue.labels.filter((l) => !remove.has(l)), ...add])];
      if (body.state_event === 'reopen') issue.state = 'opened';
      if (body.state_event === 'close') issue.state = 'closed';
      return json(200, issue);
    }
    if (method === 'POST' && path === '/ai/duo_workflows/workflows') return json(201, { id: 7, status: 'created' });
    return json(404, { message: '404 Not Found' });
  }

  return { fetch, calls, issues };
}
