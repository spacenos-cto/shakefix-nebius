// DEMO_MODE=1: a deterministic replay of a recorded ShakeFix run, so a live demo cannot flake.
//
// Nothing here talks to GitLab. The board, status, timeline, verdict and badge endpoints serve the
// hero-run fixture (src/demo/hero-run.json) paced in real time (DEMO_SPEED speeds it up). Every
// response carries `demo: true` and the UIs label it "DEMO REPLAY".
//
//   - The fixture's own report (issue #4 → MR !1) starts when the intake boots and loops.
//   - A shake while in demo mode (POST /v1/reports) starts a new card that walks the same script with
//     the reporter's own rid, so the SDK on the phone sees the same flow. Its 👍 is never scripted:
//     it waits for the reporter's tap (POST /v1/reports/:rid/verdict).
import { readFileSync } from 'node:fs';
import { badgeColor, badgeMessage, badgeStats, renderBadge } from './badge.js';
import { RID_RE, reportBodySchema, verdictBodySchema, zodIssues } from './schema.js';
import { STAGE_KEYS, buildTimeline } from './timeline.js';

export const DEMO_FIXTURE_URL = new URL('./demo/hero-run.json', import.meta.url);

export function loadDemoFixture(path = DEMO_FIXTURE_URL) {
  return validateFixture(JSON.parse(readFileSync(path, 'utf8')));
}

export function validateFixture(f) {
  if (!f || f.schema !== 'shakefix.demo/v1') throw new Error('demo fixture: schema must be shakefix.demo/v1');
  if (!RID_RE.test(String(f.rid))) throw new Error('demo fixture: bad rid');
  if (!Array.isArray(f.stages) || !f.stages.length) throw new Error('demo fixture: stages missing');
  let last = -1;
  for (const s of f.stages) {
    if (!STAGE_KEYS.includes(s.key)) throw new Error(`demo fixture: unknown stage ${s.key}`);
    if (!Number.isFinite(s.offsetS) || s.offsetS < last) throw new Error(`demo fixture: offsets must be ascending (${s.key})`);
    if (!['recorded', 'estimated', 'scripted'].includes(s.source)) throw new Error(`demo fixture: bad source for ${s.key}`);
    last = s.offsetS;
  }
  return f;
}

/** Board state for the latest stage reached. */
const STAGE_STATE = {
  shaken: 'received',
  issue_created: 'received',
  triage_start: 'triaging',
  triage_end: 'triaging',
  surgery: 'in-surgery',
  review: 'in-surgery',
  mr_opened: 'proof',
  second_opinion: 'proof',
  merged: 'proof',
  deployed: 'deployed',
  verified: 'verified',
};

/**
 * @param {{fixture: object, now?: () => number, speed?: number, holdS?: number, maxRuns?: number}} o
 */
export function createDemo({ fixture, now = () => Date.now(), speed = 1, holdS = 300, maxRuns = 20 }) {
  const f = validateFixture(fixture);
  const k = Number(speed) > 0 ? Number(speed) : 1;
  const runs = new Map();
  const lastOffset = f.stages[f.stages.length - 1].offsetS;
  const sources = Object.fromEntries(f.stages.map((s) => [s.key, s.source]));

  function start(rid, { live = false, title } = {}) {
    if (runs.size >= maxRuns && !runs.has(rid)) {
      const oldestLive = [...runs.values()].find((r) => r.live);
      if (oldestLive) runs.delete(oldestLive.rid);
    }
    const run = { rid, live, startMs: now(), title: title ?? f.title, verdict: null, verdictAt: null };
    runs.set(rid, run);
    return run;
  }
  start(f.rid);

  const at = (run, offsetS) => run.startMs + (offsetS * 1000) / k;

  function loop(run) {
    // The fixture's own card loops so the board never runs dry.
    if (!run.live && now() > at(run, lastOffset) + holdS * 1000) {
      run.startMs = now();
      run.verdict = null;
      run.verdictAt = null;
    }
  }

  /** Record-shaped view of a run at the current time. */
  function record(run) {
    loop(run);
    const t = now();
    const stages = {};
    let latest = null;
    for (const s of f.stages) {
      let ms = at(run, s.offsetS);
      if (s.key === 'verified') {
        if (run.verdict === 'confirmed') ms = run.verdictAt;
        else if (run.live || run.verdict === 'rejected') continue; // a live reporter's 👍 is never scripted
      }
      if (ms <= t) {
        stages[s.key] = new Date(ms).toISOString();
        latest = s.key;
      }
    }
    let state = STAGE_STATE[latest] ?? 'received';
    if (run.verdict === 'rejected') state = 'reopened';
    const live = ['deployed', 'verified'].includes(state);
    return {
      rid: run.rid,
      primary: true,
      issueIid: f.issueIid,
      issueUrl: f.issueUrl,
      mrIid: stages.mr_opened ? f.mrIid : null,
      mrUrl: stages.mr_opened ? f.mrUrl : null,
      title: run.title,
      sev: f.sev,
      state,
      route: f.route,
      proof: stages.second_opinion && f.proof ? f.proof : { intended: null, unintended: null },
      stages,
      humanTouches: f.humanTouches ?? 0,
      timeline: [],
      cost: f.cost ?? null,
      createdAt: stages.shaken,
      updatedAt: stages[latest] ?? stages.shaken,
      fixedAt: stages.deployed ?? null,
      verifiedAt: stages.verified ?? null,
      verdict: run.verdict === 'rejected' ? 'rejected' : stages.verified ? 'confirmed' : null,
      verdicts: { confirmed: stages.verified ? 1 : 0, rejected: run.verdict === 'rejected' ? 1 : 0 },
      live,
    };
  }

  const list = () => [...runs.values()].sort((a, b) => b.startMs - a.startMs).map(record);

  return {
    fixture: f,
    speed: k,
    sources,
    runs,
    start,
    get: (rid) => (runs.has(rid) ? record(runs.get(rid)) : null),
    list,
    verdict(rid, verdict) {
      const run = runs.get(rid);
      if (!run) return null;
      run.verdict = verdict;
      run.verdictAt = now();
      return record(run);
    },
  };
}

/** Registers the demo routes on a Fastify app (DEMO_MODE=1). */
export function registerDemoRoutes(app, { demo, rate, now = () => Date.now() }) {
  const iso = () => new Date(now()).toISOString();
  const badRid = (req, reply) => {
    if (RID_RE.test(req.params.rid)) return false;
    reply.code(400).send({ error: 'invalid_rid' });
    return true;
  };

  app.get('/v1/board', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return {
      generatedAt: iso(),
      demo: true,
      items: demo.list().map((r) => ({
        rid: r.rid,
        issueIid: r.issueIid,
        issueUrl: r.issueUrl,
        title: r.title,
        sev: r.sev,
        state: r.state,
        mrIid: r.mrIid,
        mrUrl: r.mrUrl,
        proof: r.proof,
        verdict: r.verdict,
        verdicts: r.verdicts,
        humanTouches: r.humanTouches,
        demo: true,
        timestamps: { createdAt: r.createdAt, updatedAt: r.updatedAt, fixedAt: r.fixedAt, verifiedAt: r.verifiedAt },
      })),
    };
  });

  app.get('/v1/reports/:rid/status', async (req, reply) => {
    if (badRid(req, reply)) return reply;
    const r = demo.get(req.params.rid);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    return { rid: r.rid, state: r.state, issueIid: r.issueIid, issueUrl: r.issueUrl, mrIid: r.mrIid ?? undefined, verdict: r.verdict, updatedAt: r.updatedAt, demo: true };
  });

  app.get('/v1/reports/:rid/timeline', async (req, reply) => {
    if (badRid(req, reply)) return reply;
    const r = demo.get(req.params.rid);
    if (!r) return reply.code(404).send({ error: 'not_found' });
    reply.header('cache-control', 'no-store');
    const tl = buildTimeline(r, { now: iso(), sources: demo.sources, demo: true });
    // Sped up (DEMO_SPEED > 1): the clock on screen is the replay's, so say how long the real run took.
    if (demo.speed > 1) {
      const last = demo.fixture.stages[demo.fixture.stages.length - 1].offsetS;
      const real = `${Math.floor(last / 60)}m ${String(last % 60).padStart(2, '0')}s`;
      tl.replaySpeed = demo.speed;
      tl.stopwatch = `${tl.stopwatch} · replayed at ${demo.speed}x; the real run took ${real}`;
    }
    return tl;
  });

  app.get('/v1/badge.svg', async (_req, reply) => {
    const stats = badgeStats(demo.list(), (r) => r.verdict);
    reply.header('content-type', 'image/svg+xml; charset=utf-8').header('cache-control', 'no-cache');
    return renderBadge({ message: badgeMessage(stats, { demo: true }), color: badgeColor(stats) });
  });

  app.post('/v1/reports', async (req, reply) => {
    const ipCheck = rate.checkIp(req.ip);
    if (!ipCheck.ok) return reply.code(429).header('retry-after', ipCheck.retryAfterSec).send({ error: 'rate_limited', scope: 'ip' });
    const parsed = reportBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_report', issues: zodIssues(parsed.error) });
    const { rid } = parsed.data.replay;
    demo.start(rid, { live: true });
    req.log.info({ rid }, 'demo replay started for a live shake');
    return reply.code(201).send({ rid, issueUrl: demo.fixture.issueUrl, issueIid: demo.fixture.issueIid, duplicate: false, demo: true });
  });

  app.post('/v1/reports/:rid/verdict', async (req, reply) => {
    if (badRid(req, reply)) return reply;
    const parsed = verdictBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_verdict', issues: zodIssues(parsed.error) });
    const cur = demo.get(req.params.rid);
    if (!cur) return reply.code(404).send({ error: 'not_found' });
    if (cur.verdict) return { ok: true, duplicate: true, rid: cur.rid, state: cur.state, demo: true };
    if (!cur.live) return reply.code(409).send({ error: 'not_fixed', state: cur.state, demo: true });
    const { verdict } = parsed.data;
    const r = demo.verdict(req.params.rid, verdict);
    if (verdict === 'confirmed') return { ok: true, rid: r.rid, verdict, state: 'verified', demo: true };
    return { ok: true, rid: r.rid, verdict, state: 'reopened', replayPath: null, retriggered: false, demo: true };
  });

  for (const path of ['/v1/reports/:rid/fixed', '/v1/reports/:rid/reoperate', '/v1/hooks/gitlab']) {
    app.post(path, async (_req, reply) => reply.code(409).send({ error: 'demo_mode', message: 'DEMO_MODE=1 replays a recorded run; writes are disabled.' }));
  }
}
