import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  blastRadius, buildGraph, callsQuery, clientRoutes, componentFor, detectCategory, exposureFor, handlerTargets,
  matchClientRoute, mermaidLabel, normalizeFiles, orbitConfig, parseRows, regexToPattern,
} from '../src/blast/index.js';
import { mask } from '../src/blast/source.js';
import { parseModule } from '../src/blast/module.js';
import { main } from '../bin/shakefix-blast.js';
import { fakeFetch } from './helpers.js';

const FIX = resolve(import.meta.dirname, 'fixtures/blast');
const APP = join(FIX, 'carerx');
const REAL_APP = resolve(import.meta.dirname, '../../../apps/carerx');
const replayC3 = JSON.parse(readFileSync(join(FIX, 'replay-c3.json'), 'utf8'));
const replayC1 = JSON.parse(readFileSync(join(FIX, 'replay-c1.json'), 'utf8'));
const graph = buildGraph(APP);

// What CareRx's /api/insights/affected returns from its synthetic seed population.
const POP = {
  size: 1284, windowDays: 30, refills: 902, avgCopay: 9.4,
  routes: { '/': 1284, '/rx/:id': 1191, '/rx/:id/refill': 902, '/orders/:id': 902, '/orders': 377, '/settings': 344 },
  components: { 'rx-row': 1191, 'refill-btn': 902, 'pay-btn': 902, 'privacy-share-toggle': 211, 'rx-strength': 1191 },
  segments: { 'screen-reader': 71, levothyroxine: 298 },
};
const insights = () => fakeFetch((call) => {
  if (call.path !== '/api/insights/affected') return { status: 404, body: { error: 'not found' } };
  const counts = [POP.routes[call.query.route], POP.components[call.query.component], POP.segments[call.query.segment]].filter(Number.isFinite);
  return {
    status: 200,
    body: {
      patients: counts.length ? Math.min(...counts) : null, populationSize: POP.size, windowDays: POP.windowDays,
      refills: POP.refills, avgCopay: POP.avgCopay, synthetic: true, note: 'SYNTHETIC demo population.',
    },
  };
});

describe('source scanner', () => {
  it('masks strings, comments, templates and regexes without breaking braces', () => {
    const src = "const a = '{'; // }\nconst r = /^\\/rx\\/(?<id>[^/]+)$/;\nconst t = `x-${b ? '}' : `{${c}`}-y`;\nfunction f() { return 1; }";
    const m = mask(src);
    expect(m.code.length).toBe(src.length);
    expect(m.code).not.toMatch(/'\{'/);
    expect(m.regexes[0].body).toBe('^\\/rx\\/(?<id>[^/]+)$');
    expect(m.strings.find((s) => s.quote === '`' && s.value.startsWith('x-')).value).toBe('x-*-y');
    const mod = parseModule(src, 'a.js');
    expect(mod.defs.map((d) => d.name)).toEqual(['f']);
  });
});

describe('routes.js', () => {
  it('extracts client routes from main.js with their view modules', () => {
    expect(regexToPattern('^\\/rx\\/(?<id>[^/]+)\\/refill$')).toBe('/rx/:id/refill');
    const routes = graph.router.routes.map((r) => [r.pattern, r.viewFile]);
    expect(graph.router.file).toBe('src/main.js');
    expect(routes).toContainEqual(['/rx/:id/refill', 'src/views/refill.js']);
    expect(routes).toContainEqual(['/rx/:id', 'src/views/rx.js']);
    expect(routes).toContainEqual(['/settings', 'src/views/settings.js']);
    expect(matchClientRoute(graph.router.routes, '/rx/rx_1/refill').pattern).toBe('/rx/:id/refill');
    expect(matchClientRoute(graph.router.routes, '/rx/rx_1').pattern).toBe('/rx/:id');
    expect(matchClientRoute(graph.router.routes, '/orders').pattern).toBe('/orders');
  });

  it('extracts express routes with the /api router prefix', () => {
    const server = graph.server.map((s) => `${s.method} ${s.path}`);
    expect(server).toContain('POST /api/prescriptions/:id/refills');
    expect(server).toContain('PATCH /api/me/privacy');
    expect(server).toContain('GET /api/insights/affected');
    expect(server).toContain('GET /healthz');
    expect(server.some((s) => s.endsWith(' *'))).toBe(false);
  });

  it('knows which testids each view renders, templates as wildcards', () => {
    expect(graph.testids['src/views/refill.js']).toEqual(expect.arrayContaining(['pay-btn', 'copay', 'refill-drug']));
    expect(graph.testids['src/views/home.js']).toContain('rx-row-*');
    expect(componentFor('rx-row-3', graph.testids['src/views/home.js'])).toBe('rx-row');
    expect(componentFor('pay-btn', graph.testids['src/views/refill.js'])).toBe('pay-btn');
  });

  it('handles a string-path router too', () => {
    const mod = parseModule("import { a } from './a.js';\nconst routes = [{ path: '/x/:id', view: a, title: 'X' }];", 'main.js');
    const r = clientRoutes(mod, () => ({ file: 'a.js', name: 'a' }));
    expect(r).toEqual([expect.objectContaining({ pattern: '/x/:id', viewFile: 'a.js', title: 'X' })]);
  });
});

describe('graph.js', () => {
  it('resolves imports, object-literal API methods and client -> server http edges', () => {
    const out = [...graph.edges.get('src/views/refill.js#renderRefill')];
    expect(out).toEqual(expect.arrayContaining(['src/api.js#api.refill', 'src/api.js#api.prescription', 'src/lib/money.js#formatUsd']));
    expect([...graph.edges.get('src/api.js#api.refill')]).toContain('server/index.js#ROUTE POST /api/prescriptions/:id/refills');
    expect(graph.kinds.get('src/api.js#api.refill->server/index.js#ROUTE POST /api/prescriptions/:id/refills')).toBe('http');
    expect([...graph.edges.get('server/index.js#present')]).toContain('src/dosing/strength.js#formatStrength');
  });

  it('follows the pay-btn handler to the refill API (nested `pay` function)', () => {
    expect(handlerTargets(graph, 'src/views/refill.js', 'pay-btn')).toContain('src/api.js#api.refill');
    expect(handlerTargets(graph, 'src/views/refill.js', 'pay-btn')).not.toContain('src/api.js#api.me');
  });
});

describe('blastRadius: C3 double-charge replay', () => {
  it('Mermaid contains the user action, route, view module and API endpoint, and output is deterministic', async () => {
    const a = await blastRadius({ graph, replay: replayC3 });
    const b = await blastRadius({ graph: buildGraph(APP), replay: structuredClone(replayC3) });
    expect(a.mermaid).toMatch(/^graph LR\n/);
    expect(a.mermaid).toContain('["click pay-btn"]');
    expect(a.mermaid).toContain('["/rx/:id/refill"]');
    expect(a.mermaid).toContain('["src/views/refill.js · renderRefill"]');
    expect(a.mermaid).toContain('["POST /api/prescriptions/:id/refills"]');
    expect(a.mermaid).toContain('["src/lib/money.js · formatUsd"]');
    expect(a.markdown).toBe(b.markdown);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('every Mermaid label is quoted and free of raw quotes/parentheses', async () => {
    const r = await blastRadius({ graph, replay: replayC3 });
    for (const line of r.mermaid.split('\n').slice(1)) {
      const node = /^\s+([a-z]\d+)\["(.*)"\]$/.exec(line);
      const edge = /^\s+[a-z]\d+ --> [a-z]\d+$/.test(line);
      const cls = /^\s+(classDef|class) /.test(line);
      expect(Boolean(node) || edge || cls, line).toBe(true);
      if (node) expect(node[2]).not.toMatch(/["()<>`]/);
    }
  });

  it('offline: patients unknown, no money figure, still a full report', async () => {
    const r = await blastRadius({ graph, replay: replayC3 });
    expect(r.population.patients).toBe('unknown');
    expect(r.category).toBe('billing');
    expect(r.exposure.value).toBeNull();
    expect(r.source).toBe('static');
    expect(r.primary).toMatchObject({ pattern: '/rx/:id/refill', component: 'pay-btn', view: 'src/views/refill.js' });
    expect(r.endpoints[0]).toMatchObject({ method: 'POST', path: '/api/prescriptions/:id/refills', primary: true });
    expect(r.markdown).toContain('### 💥 Blast Radius');
    expect(r.headline).toBe('This bug touches `/rx/:id/refill` · `pay-btn` · patients unknown (offline: no APP_URL)');
  });

  it('online: 902 synthetic patients and refills × avg copay', async () => {
    const f = insights();
    const r = await blastRadius({ graph, replay: replayC3, appUrl: 'http://carerx.test', fetch: f.fetch });
    expect(f.calls[0].query).toEqual({ route: '/rx/:id/refill', component: 'pay-btn' });
    expect(r.population).toMatchObject({ patients: 902, synthetic: true, windowDays: 30 });
    expect(r.headline).toBe('This bug touches `/rx/:id/refill` · `pay-btn` · **902 patients** in the last 30 days (synthetic demo population)');
    expect(r.exposure.value).toBe(8478.8);
    expect(r.exposure.text).toContain('$8,478.80');
    expect(r.exposure.legal.sources).toEqual([]);
    expect(r.exposure.legal.text).not.toMatch(/\$\d/);
    expect(r.markdown).toMatch(/\| Patients \(last 30 d\) \| 902 of 1,284 \(synthetic\) \|/);
  });
});

describe('blastRadius: other inputs', () => {
  it('C1 accessibility replay queries the screen-reader segment', async () => {
    const f = insights();
    const r = await blastRadius({ graph, replay: replayC1, appUrl: 'http://carerx.test', fetch: f.fetch });
    expect(r.category).toBe('accessibility');
    expect(f.calls[0].query).toEqual({ route: '/rx/:id', component: 'refill-btn', segment: 'screen-reader' });
    expect(r.population.patients).toBe(71);
    expect(r.exposure.text).toMatch(/^71 patients who use a screen reader could not complete this action/);
  });

  it('changed files only: walks callers back to the routes', async () => {
    const r = await blastRadius({ graph, files: normalizeFiles(['apps/carerx/src/dosing/strength.js#formatStrength'], 'apps/carerx') });
    expect(r.mode).toBe('files');
    expect(r.changed.defs).toEqual(['src/dosing/strength.js#formatStrength']);
    expect(r.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(expect.arrayContaining(['GET /api/prescriptions', 'GET /api/prescriptions/:id']));
    expect(r.category).toBe('medication-info');
    expect(r.mermaid).toContain('class d');
    expect(r.nodes.find((n) => n.id === 'src/dosing/strength.js#formatStrength').changed).toBe(true);
  });

  it('a changed view maps to its client route', async () => {
    const r = await blastRadius({ graph, files: ['src/views/settings.js'] });
    expect(r.routes.map((x) => x.pattern)).toContain('/settings');
    expect(r.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual([]);
  });
});

describe('orbit.js', () => {
  const env = { GITLAB_URL: 'https://gitlab.example', ORBIT_TOKEN: 'tok', CI_PROJECT_ID: '87458663' };

  it('config: ORBIT_TOKEN falls back to GITLAB_TOKEN; disabled without a project', () => {
    expect(orbitConfig({ ...env, ORBIT_TOKEN: undefined, GITLAB_TOKEN: 'g' })).toMatchObject({ token: 'g', enabled: true });
    expect(orbitConfig({ GITLAB_URL: 'x', ORBIT_TOKEN: 't' }).enabled).toBe(false);
  });

  it('query shape: CALLS traversal, hops [1,3]', () => {
    const q = callsQuery({ projectId: 1, name: 'formatUsd', filePath: 'apps/carerx/src/lib/money.js' });
    expect(q.query.query_type).toBe('traversal');
    expect(q.query.relationships).toEqual([{ type: 'CALLS', from: 'caller', to: 'target', hops: [1, 3] }]);
    expect(q.query.nodes[0].filters.file_path).toEqual({ ends_with: 'apps/carerx/src/lib/money.js' });
  });

  it('non-200 / empty Orbit -> silent static fallback', async () => {
    for (const reply of [{ status: 404, body: { message: 'Knowledge graph request failed' } }, { status: 200, body: { rows: [] } }]) {
      const f = fakeFetch(() => reply);
      const r = await blastRadius({ graph, files: ['src/lib/money.js'], env, fetch: f.fetch });
      expect(r.source).toBe('static');
      expect(f.calls[0].url).toBe('https://gitlab.example/api/v4/orbit/query');
      expect(f.calls[0].headers['PRIVATE-TOKEN']).toBe('tok');
    }
  });

  it('usable Orbit rows -> source "orbit" and extra caller edges', async () => {
    const f = fakeFetch((call) => (call.path.endsWith('/orbit/query')
      ? { status: 200, body: { rows: [{ target: { name: 'isKnownUnit', file_path: 'apps/carerx/src/dosing/strength.js' }, caller: { name: 'renderRx', file_path: 'apps/carerx/src/views/rx.js' } }] } }
      : { status: 404 }));
    const r = await blastRadius({ graph, files: ['src/dosing/strength.js#isKnownUnit'], env, fetch: f.fetch });
    expect(r.source).toBe('orbit');
    expect(r.links).toContainEqual(['src/views/rx.js#renderRx', 'src/dosing/strength.js#isKnownUnit']);
    expect(r.routes.map((x) => x.pattern)).toContain('/rx/:id');
    expect(parseRows({ rows: [{ 'target.name': 'a', 'target.file_path': 'x.js', 'caller.name': 'b', 'caller.file_path': 'y.js' }] }, 'caller')).toHaveLength(1);
  });
});

describe('exposure.js', () => {
  it('detects categories from note, testids and files', () => {
    expect(detectCategory({ note: 'charged twice' })).toBe('billing');
    expect(detectCategory({ note: 'turned off sharing my health data but it is still on' })).toBe('privacy');
    expect(detectCategory({ note: '', files: ['src/dosing/strength.js'] })).toBe('medication-info');
    expect(detectCategory({ note: 'nothing happens' })).toBe('general');
  });

  it('legal text is qualitative; context sources are verified public pages only', () => {
    for (const c of ['billing', 'accessibility', 'privacy', 'medication-info', 'general']) {
      const e = exposureFor(c, { patients: 10, windowDays: 30, refills: 10, avgCopay: 1 });
      expect(e.legal.text).not.toMatch(/\$\s?\d/);
      for (const src of e.legal.sources) expect(src.url).toMatch(/^https:\/\/(www\.ftc\.gov|www\.adatitleiii\.com|afb\.org|online\.ecri\.org|www\.cdc\.gov)\//);
    }
    expect(exposureFor('privacy', { patients: 1 }).legal.sources.length).toBeGreaterThan(0);
    expect(exposureFor('billing', { patients: 1 }).legal.sources).toEqual([]);
  });
});

describe('render', () => {
  it('escapes Mermaid labels', () => {
    expect(mermaidLabel('a "b" (c) <d> #e\nf')).toBe('a #quot;b#quot; #40;c#41; #lt;d#gt; #35;e f');
  });
});

describe('shakefix-blast CLI', () => {
  const capture = () => {
    const out = [];
    const err = [];
    return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s) } };
  };

  it('prints Markdown offline, writes --out, and --json is valid JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'blast-'));
    try {
      const c = capture();
      const outFile = join(dir, 'blast.md');
      const code = await main(['--replay', join(FIX, 'replay-c3.json'), '--app-dir', APP, '--out', outFile], {}, c.io);
      expect(code).toBe(0);
      expect(c.out[0]).toContain('patients unknown');
      expect(readFileSync(outFile, 'utf8')).toContain('```mermaid');
      const j = capture();
      expect(await main(['--replay', join(FIX, 'replay-c3.json'), '--app-dir', APP, '--json', '--files', 'apps/carerx/src/lib/money.js'], {}, j.io)).toBe(0);
      const report = JSON.parse(j.out[0]);
      expect(report.schema).toBe('shakefix.blast/v1');
      expect(report.mode).toBe('replay+files');
      expect(report.changed.files).toEqual(['src/lib/money.js']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses --app-url / APP_URL for insights', async () => {
    const c = capture();
    const f = insights();
    await main(['--replay', join(FIX, 'replay-c3.json'), '--app-dir', APP], { APP_URL: 'http://carerx.test' }, c.io, { fetch: f.fetch });
    expect(f.calls).toHaveLength(1);
    expect(c.out[0]).toContain('**902 patients**');
  });

  it('usage errors exit 2', async () => {
    const c = capture();
    expect(await main([], {}, c.io)).toBe(2);
    expect(await main(['--replay', 'nope.json', '--app-dir', APP], {}, c.io)).toBe(2);
    expect(await main(['--files', 'x.js', '--app-dir', join(FIX, 'missing')], {}, c.io)).toBe(2);
  });
});

describe.skipIf(!existsSync(join(REAL_APP, 'src/main.js')))('against the real apps/carerx', () => {
  it('finds the refill route, view and endpoint', async () => {
    const r = await blastRadius({ appDir: REAL_APP, replay: replayC3 });
    expect(r.mermaid).toContain('["/rx/:id/refill"]');
    expect(r.mermaid).toContain('["POST /api/prescriptions/:id/refills"]');
  });
});

describe('mermaid link style', () => {
  it('plain links avoid ">" so escaped notes still render', async () => {
    const graph = buildGraph(APP);
    const plain = await blastRadius({ graph, replay: replayC3, links: 'plain' });
    expect(plain.mermaid).not.toContain('-->');
    expect(plain.mermaid).toContain('---');
    const arrow = await blastRadius({ graph, replay: replayC3 });
    expect(arrow.mermaid).toContain('-->');
  });
});
