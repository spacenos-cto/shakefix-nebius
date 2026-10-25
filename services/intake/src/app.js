// Fastify app factory. All dependencies are injected so tests can run it with a
// fake GitLab (fake fetch), the memory store and a stub pusher.
import Fastify from 'fastify';
import { publicConfig } from './config.js';
import { SIGNATURE_HEADER, safeEqual, verifySignature } from './hmac.js';
import { createRateLimiter } from './ratelimit.js';
import {
  fixedPushPayload,
  flowGoal,
  issueBody,
  issueLabels,
  issueTitle,
  plusOneNote,
  reoperateNote,
  rejectedNote,
  replayCommitMessage,
  replayFilePath,
  retriageNote,
  verdictReplayCommitMessage,
  verdictReplayPath,
  verifiedNote,
} from './render.js';
import { currentRoute, dedupeHash, severityOf } from './replay.js';
import { RID_RE, certVerifyQuerySchema, fixedBodySchema, reoperateBodySchema, reportBodySchema, verdictBodySchema, zodIssues } from './schema.js';
import { scrubReplay } from './scrub.js';
import { STATE_LABELS, issueIidFromBranch, mapGitlabEvent, nextState } from './states.js';
import { GitlabError } from './gitlab.js';
import { INTAKE_NOTE_MARKER, applyTimelineEvents, buildTimeline, isBotUser, timelineEventsFromHook } from './timeline.js';
import { badgeColor, badgeMessage, badgeStats, renderBadge } from './badge.js';
import { createDemo, loadDemoFixture, registerDemoRoutes } from './demo.js';
import { recordRejection } from './memory.js';
import { buildCertificate, isDischarged, verifyDigestSignature } from './certificate.js';
import { INFRA_LABEL, assessInfra, infraSection, infraSignalsFromReplay, pageHuman, probeApp } from './infra.js';
import { callNote, callOutcome, createVoice, decodeAudio, verifyElevenSignature, voiceNoteSection } from './voice.js';
import { oncallBodySchema } from './schema.js';

const PUBLIC_PATHS = new Set(['/v1/board', '/v1/vapid-public-key', '/healthz', '/v1/health', '/v1/badge.svg', '/v1/certificates/verify']);
/** Public read-only paths with a parameter (any origin may GET them). */
const PUBLIC_RE = /^\/v1\/reports\/[^/]+\/(timeline|certificate)$/;
const MAX_NOTE_IDS = 50;
const SERVER_TO_SERVER = /^\/v1\/(hooks\/(gitlab|elevenlabs)|oncall\/call|reports\/[^/]+\/(fixed|reoperate))$/;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function decodePng(b64) {
  if (!b64 || typeof b64 !== 'string') return null;
  const s = b64.replace(/^data:image\/png;base64,/i, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s, 'base64');
  if (buf.length < 8 || !PNG_MAGIC.every((b, i) => buf[i] === b)) return null;
  return buf;
}

const pathOf = (url) => String(url || '').split('?')[0];

export function buildApp({ config, gitlab, store, pusher, limiter, logger = false, now = () => Date.now(), demo = null, fetchImpl = fetch, voice = null }) {
  const rate = limiter ?? createRateLimiter({ ipPerMin: config.rateIpPerMin, readIpPerMin: config.rateReadIpPerMin, appPerDay: config.rateAppPerDay, now });
  const vox = voice ?? createVoice({ config, fetchImpl });
  const iso = () => new Date(now()).toISOString();
  const allowAllOrigins = config.allowedOrigins.includes('*');
  async function dropAgentEdits(events, body) {
    const edits = events.filter((e) => e.type === 'human' && e.kind === 'edit');
    const kind = body?.object_kind === 'merge_request' ? 'merge_request' : 'issue';
    const iid = body?.object_attributes?.iid;
    if (!edits.length || !iid || !gitlab?.labelEventActors) return events;
    try {
      const actors = await gitlab.labelEventActors(kind, iid);
      const near = (at) => actors.filter((a) => Math.abs(Date.parse(a.at) - Date.parse(at)) <= 15_000);
      return events.filter((e) => {
        if (!(e.type === 'human' && e.kind === 'edit')) return true;
        const who = near(e.at);
        return !(who.length && who.every((a) => isBotUser(a.user, botUsernames)));
      });
    } catch {
      return events; // audit trail unavailable: keep the conservative count
    }
  }

  // Reporters can't open a private GitLab issue; they follow their case on the public ER Board.
  const certificateUrl = (rid) => (config.boardUrl && config.publicUrl
    ? `${config.boardUrl}/certificate.html?rid=${encodeURIComponent(rid)}&intake=${encodeURIComponent(config.publicUrl)}`
    : null);
  const trackUrl = (rid) => (config.boardUrl ? `${config.boardUrl}/?rid=${encodeURIComponent(rid)}&explain=1&view=visual` : null);

  const app = Fastify({
    trustProxy: true, // Cloud Run sets X-Forwarded-For
    bodyLimit: config.maxBodyBytes,
    logger:
      logger === false
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers["private-token"]',
                'req.headers["x-gitlab-token"]',
                `req.headers["${SIGNATURE_HEADER}"]`,
              ],
              censor: '[redacted]',
            },
            // Request logging without bodies, query strings or IPs.
            serializers: {
              req: (req) => ({ method: req.method, path: pathOf(req.url), id: req.id }),
              res: (res) => ({ statusCode: res.statusCode }),
            },
          },
  });

  // Keep the raw body for HMAC verification; parse JSON ourselves.
  app.removeContentTypeParser('application/json');
  app.removeContentTypeParser('text/plain');
  const jsonParser = (req, body, done) => {
    req.rawBody = body;
    if (body === '' || body === undefined) return done(null, {});
    try {
      done(null, JSON.parse(body));
    } catch {
      const e = new Error('invalid JSON');
      e.statusCode = 400;
      done(e);
    }
  };
  app.addContentTypeParser('application/json', { parseAs: 'string' }, jsonParser);
  // navigator.sendBeacon() posts text/plain; accept it as JSON too.
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, jsonParser);

  // ---- CORS allowlist ---------------------------------------------------------------
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    const path = pathOf(req.url);
    if (!origin) return;
    const isPublic = PUBLIC_PATHS.has(path) || (PUBLIC_RE.test(path) && (req.method === 'GET' || req.method === 'OPTIONS'));
    const allowed = allowAllOrigins || config.allowedOrigins.includes(origin);
    if (allowed) {
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'Origin');
    } else if (isPublic) {
      reply.header('access-control-allow-origin', '*');
    }
    if (req.method === 'OPTIONS') {
      if (!allowed && !isPublic) return reply.code(403).send({ error: 'origin_not_allowed' });
      reply.header('access-control-allow-methods', isPublic ? 'GET, OPTIONS' : 'GET, POST, OPTIONS');
      reply.header('access-control-allow-headers', 'content-type');
      reply.header('access-control-max-age', '600');
      return reply.code(204).send();
    }
    if (!allowed && !isPublic && !SERVER_TO_SERVER.test(path)) {
      return reply.code(403).send({ error: 'origin_not_allowed' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    // GitlabError from ./gitlab.js, or any @shakefix/core ScmError (SCM_PROVIDER=github).
    if (err instanceof GitlabError || err?.isScmError) {
      req.log.error({ status: err.status, msg: err.message }, 'gitlab call failed');
      return reply.code(502).send({ error: 'gitlab_error', status: err.status });
    }
    const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (code === 413) return reply.code(413).send({ error: 'payload_too_large', limitBytes: config.maxBodyBytes });
    if (code >= 500) req.log.error({ err: { message: err.message, name: err.name } }, 'unhandled error');
    return reply.code(code).send({ error: code >= 500 ? 'internal_error' : err.message || 'bad_request' });
  });

  // ---- helpers ----------------------------------------------------------------------
  async function primaryFor(record) {
    if (!record || record.primary || record.issueIid == null) return record;
    const all = await store.findByIssueIid(record.issueIid);
    return all.find((r) => r.primary) ?? record;
  }

  function transitionPatch(record, state) {
    const t = iso();
    return {
      state,
      updatedAt: t,
      timestamps: { ...(record.timestamps ?? {}), [state]: record.timestamps?.[state] ?? t },
    };
  }

  function requireHmac(req, reply) {
    if (!config.hookSecret) {
      reply.code(503).send({ error: 'hook_secret_not_configured' });
      return false;
    }
    if (!verifySignature(config.hookSecret, req.rawBody ?? '', req.headers[SIGNATURE_HEADER])) {
      reply.code(401).send({ error: 'bad_signature' });
      return false;
    }
    return true;
  }

  /** Public base URL of this service (PUBLIC_URL, else the request's forwarded proto/host). */
  function publicBase(req) {
    if (config.publicUrl) return config.publicUrl;
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(',')[0].trim();
    return `${req.protocol || 'https'}://${host}`;
  }

  function validRid(req, reply) {
    if (!RID_RE.test(req.params.rid)) {
      reply.code(400).send({ error: 'invalid_rid' });
      return false;
    }
    return true;
  }

  // ---- routes -----------------------------------------------------------------------
  const health = async () => ({ ok: true, ...pick(publicConfig(config), ['store', 'pushMode', 'startMode', 'demoMode', 'voice']) });
  app.get('/healthz', health);
  app.get('/v1/health', health); // /healthz is reserved on *.run.app

  app.get('/v1/vapid-public-key', async () => ({
    publicKey: config.pushMode === 'webpush' ? config.vapidPublicKey : null,
    pushMode: config.pushMode,
  }));

  // DEMO_MODE=1: replay the recorded hero run; no GitLab, no store (src/demo.js, docs/DEMO.md).
  if (config.demoMode) {
    const d = demo ?? createDemo({ fixture: loadDemoFixture(), now, speed: config.demoSpeed });
    registerDemoRoutes(app, { demo: d, rate, now });
    return app;
  }

  const botUsernames = [config.flowServiceAccount, ...(config.botUsernames ?? [])].filter(Boolean);

  /** Post an issue note tagged as the intake's own, so its webhook is never a human touch even if it
   *  arrives before the note id is stored. */
  const addIntakeNote = (issueIid, body) => gitlab.addIssueNote(issueIid, `${body}\n\n${INTAKE_NOTE_MARKER}`);

  /** Patch that remembers a note the intake posted (so its webhook is not a human touch). */
  function rememberNote(record, note, { automation = false } = {}) {
    const patch = {};
    if (note?.id != null) patch.intakeNoteIds = [...(record?.intakeNoteIds ?? []), note.id].slice(-MAX_NOTE_IDS);
    if (automation) patch.lastAutomationAt = iso();
    return patch;
  }

  app.post('/v1/reports', async (req, reply) => {
    // 1. rate limit (IP), validate, rate limit (app)
    const ipCheck = rate.checkIp(req.ip);
    if (!ipCheck.ok) return reply.code(429).header('retry-after', ipCheck.retryAfterSec).send({ error: 'rate_limited', scope: 'ip' });

    const parsed = reportBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_report', issues: zodIssues(parsed.error) });
    const { screenshotPng, pushSubscription, deviceId, voiceNote } = parsed.data;
    // The reporter's number stays in the store (never in the issue, board or certificate).
    const callback = parsed.data.callback ? { phone: parsed.data.callback.phone, consentAt: iso() } : null;

    const appCheck = rate.checkApp(parsed.data.replay.app.name);
    if (!appCheck.ok) return reply.code(429).header('retry-after', appCheck.retryAfterSec).send({ error: 'rate_limited', scope: 'app' });

    // 2. scrub
    const replay = scrubReplay(parsed.data.replay, config.inputAllowlist);
    const { rid } = replay;
    if (await store.get(rid)) return reply.code(409).send({ error: 'duplicate_rid', rid });

    const sev = severityOf(replay);
    const hash = dedupeHash(replay);
    const route = currentRoute(replay);
    const t = iso();
    const subscriptions = pushSubscription ? [pushSubscription] : [];

    // 3. dedupe against an OPEN issue with the same dup:: label
    const existing = await gitlab.findOpenIssueByLabel(`dup::${hash}`);
    if (existing) {
      const plusOne = await addIntakeNote(existing.iid, plusOneNote(rid));
      const siblings = await store.findByIssueIid(existing.iid);
      const primary = siblings.find((r) => r.primary);
      if (primary) await store.update(primary.rid, rememberNote(primary, plusOne));
      await store.put({
        rid,
        issueIid: existing.iid,
        issueUrl: existing.web_url,
        title: existing.title,
        sev,
        hash,
        route,
        appName: replay.app.name,
        state: primary?.state ?? 'received',
        mrIid: primary?.mrIid ?? null,
        proof: { intended: null, unintended: null },
        primary: false,
        duplicateOf: primary?.rid ?? null,
        subscriptions,
        deviceId: deviceId ?? null,
        callback,
        reoperations: 0,
        createdAt: t,
        updatedAt: t,
        timestamps: { received: t },
      });
      req.log.info({ rid, issueIid: existing.iid, hash }, 'duplicate report attached');
      return reply.code(200).send({ rid, issueUrl: existing.web_url, issueIid: existing.iid, duplicate: true, trackUrl: trackUrl(primary?.rid ?? rid) });
    }

    // 4. commit replay.json ([skip ci]) to the default branch (or REPORTS_REF)
    const branch = config.reportsRef || (await gitlab.defaultBranch());
    await gitlab.commitFile({
      branch,
      filePath: replayFilePath(rid),
      content: `${JSON.stringify(replay, null, 2)}\n`,
      message: replayCommitMessage(rid),
    });

    // 5. upload screenshot
    let screenshotMarkdown = null;
    const png = decodePng(screenshotPng);
    if (png) {
      const up = await gitlab.uploadFile({ filename: `${rid}.png`, data: png, contentType: 'image/png' });
      screenshotMarkdown = up?.markdown ?? (up?.url ? `![screenshot](${up.url})` : null);
    } else if (screenshotPng) {
      req.log.warn({ rid }, 'screenshot ignored: not a base64 PNG');
    }

    // 5a. voice note: ElevenLabs transcript ("In their words"); audio attached only with VOICE_KEEP_AUDIO=1
    let voiceMd = null;
    const audio = decodeAudio(voiceNote);
    if (audio) {
      let transcript = null;
      try {
        transcript = await vox.transcribe(audio);
      } catch (err) {
        req.log.warn({ rid, err: err.message }, 'voice note not transcribed');
      }
      let audioMarkdown = null;
      if (config.voiceKeepAudio) {
        const up = await gitlab.uploadFile({ filename: `${rid}.${audio.ext}`, data: audio.buf, contentType: audio.mime });
        audioMarkdown = up?.markdown ?? (up?.url ? `[voice note](${up.url})` : null);
      }
      voiceMd = voiceNoteSection({ transcript, audioMarkdown });
    } else if (voiceNote) {
      req.log.warn({ rid }, 'voice note ignored: not plausible audio');
    }

    // 5b. infra triage: platform signals in the replay + a live health probe of the app
    let infra = { suspected: false };
    if (config.infraCheck) {
      const probe = await probeApp({ baseUrl: replay.app.baseUrl, allowedOrigins: config.allowedOrigins, fetchImpl });
      infra = assessInfra({ signals: infraSignalsFromReplay(replay), probe });
    }

    // 6. create the issue with the HUMAN PAT (fires the "Work item created" trigger)
    const title = issueTitle(replay);
    const infraMd = infraSection(infra, { maintainer: config.maintainer });
    const issue = await gitlab.createIssue({
      title,
      description: issueBody({ replay, screenshotMarkdown, trackUrl: trackUrl(rid) }) + (voiceMd ? `\n\n${voiceMd}\n` : '') + (infraMd ? `\n\n${infraMd}\n` : ''),
      labels: [...issueLabels({ sev, hash }), ...(infra.suspected ? [INFRA_LABEL, 'needs-human'] : [])],
    });
    if (infra.suspected) {
      const paged = await pageHuman({
        webhookUrl: config.pagerWebhookUrl,
        fetchImpl,
        title: `ShakeFix: possible infra problem (#${issue.iid})`,
        text: `${title}\n${infra.reasons.join('\n')}`,
        url: issue.web_url,
        log: (m) => req.log.warn({ rid }, m),
      });
      req.log.warn({ rid, issueIid: issue.iid, reasons: infra.reasons, paged }, 'infra suspected: human paged');
    }
    const issueAt = iso();

    // 7. store
    await store.put({
      rid,
      issueIid: issue.iid,
      issueUrl: issue.web_url,
      title,
      sev,
      hash,
      route,
      appName: replay.app.name,
      state: 'received',
      mrIid: null,
      proof: { intended: null, unintended: null },
      primary: true,
      duplicateOf: null,
      subscriptions,
      deviceId: deviceId ?? null,
      callback,
      voiceNote: Boolean(audio),
      reoperations: 0,
      createdAt: t,
      updatedAt: t,
      timestamps: { received: t },
      stages: { shaken: t, issue_created: issueAt },
      timeline: [],
      humanTouches: 0,
      intakeNoteIds: [],
      infra: infra.suspected ? { suspected: true, reasons: infra.reasons } : null,
    });
    req.log.info({ rid, issueIid: issue.iid, sev, hash }, 'issue created');

    // 8. optional direct flow start (START_MODE=api). Default "trigger": the issue creation does it.
    if (config.startMode === 'api') {
      try {
        // NOTE: field names verified only against BUILD_SPEC §10.7; check GitLab docs (see gitlab.js).
        const res = await gitlab.startFlow({ goal: flowGoal(issue.iid), workflowDefinition: config.flowDefinition });
        req.log.info({ rid, flowResponse: JSON.stringify(res ?? null).slice(0, 500) }, 'flow started via API');
      } catch (err) {
        req.log.error({ rid, status: err?.status, msg: err?.message }, 'flow start via API failed');
      }
    }

    return reply.code(201).send({ rid, issueUrl: issue.web_url, issueIid: issue.iid, duplicate: false, trackUrl: trackUrl(rid) });
  });

  app.get('/v1/reports/:rid/status', async (req, reply) => {
    if (!validRid(req, reply)) return reply;
    const rec = await store.get(req.params.rid);
    if (!rec) return reply.code(404).send({ error: 'not_found' });
    const p = await primaryFor(rec);
    return {
      rid: rec.rid,
      state: p.state,
      issueIid: rec.issueIid,
      issueUrl: rec.issueUrl,
      mrIid: p.mrIid ?? undefined,
      verdict: currentVerdict(p),
      updatedAt: p.updatedAt,
    };
  });

  // Called by CI notify.sh after the prod smoke test passes.
  app.post('/v1/reports/:rid/fixed', async (req, reply) => {
    if (!validRid(req, reply)) return reply;
    if (!requireHmac(req, reply)) return reply;
    const parsed = fixedBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: zodIssues(parsed.error) });
    const body = parsed.data;

    const rec = await store.get(req.params.rid);
    if (!rec) return reply.code(404).send({ error: 'not_found' });

    const all = rec.issueIid != null ? await store.findByIssueIid(rec.issueIid) : [rec];
    const t = iso();
    // Reporters who asked for a call get one per new fix round (a retried notify does not call again).
    const toCall = all.filter((r) => r.callback?.phone && r.state !== 'deployed').map((r) => ({ rid: r.rid, phone: r.callback.phone, round: (r.fixRound ?? 0) + 1 }));
    for (const r of all) {
      const patch = { ...transitionPatch(r, 'deployed'), fixedAt: r.fixedAt ?? t, stages: { ...(r.stages ?? {}), deployed: r.stages?.deployed ?? t } };
      if (body.cost) patch.cost = body.cost;
      // A new fix round opens a new verdict window (a retried notify does not).
      if (r.state !== 'deployed') patch.fixRound = (r.fixRound ?? 0) + 1;
      if (body.mrIid) patch.mrIid = body.mrIid;
      if (body.proof) { patch.proof = body.proof; patch.proofSource = 'ci'; }
      await store.update(r.rid, patch);
    }

    const url = body.url ?? rec.route ?? '/';
    const base = publicBase(req);
    const seen = new Set();
    let notified = 0;
    for (const r of all) {
      const payload = fixedPushPayload(url, {
        rid: r.rid,
        verdictUrl: `${base}/v1/reports/${r.rid}/verdict`,
        deviceId: r.deviceId ?? undefined,
      });
      for (const sub of r.subscriptions ?? []) {
        if (seen.has(sub.endpoint)) continue;
        seen.add(sub.endpoint);
        const res = await pusher.send(sub, payload);
        if (res?.ok) notified += 1;
      }
    }
    let called = 0;
    if (vox.features.confirmCall) {
      const seenPhones = new Set();
      for (const c of toCall) {
        if (seenPhones.has(c.phone)) continue;
        seenPhones.add(c.phone);
        try {
          const placed = await vox.call({
            kind: 'confirm',
            to: c.phone,
            variables: { shakefix_rid: c.rid, shakefix_round: String(c.round), issue_title: rec.title ?? 'your report', app_name: rec.appName ?? 'the app' },
          });
          const fresh = (await store.get(c.rid)) ?? {};
          await store.update(c.rid, { calls: [...(fresh.calls ?? []), { kind: 'confirm', round: c.round, conversationId: placed.conversationId, at: iso() }] });
          called += 1;
        } catch (err) {
          req.log.warn({ rid: c.rid, err: err.message }, 'confirmation call not placed');
        }
      }
    }
    req.log.info({ rid: rec.rid, issueIid: rec.issueIid, notified, called, pushMode: pusher.mode }, 'marked fixed');
    return { ok: true, rid: rec.rid, state: 'deployed', notified, called, pushMode: pusher.mode };
  });

  // Called by CI proof-gate.sh on the FIRST Second Opinion failure (BUILD_SPEC §11.7).
  app.post('/v1/reports/:rid/reoperate', async (req, reply) => {
    if (!validRid(req, reply)) return reply;
    if (!requireHmac(req, reply)) return reply;
    const parsed = reoperateBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: zodIssues(parsed.error) });
    if (!config.flowServiceAccount) return reply.code(503).send({ error: 'flow_service_account_not_configured' });
    const body = parsed.data;

    const rec = await store.get(req.params.rid);
    const primary = await primaryFor(rec);
    const issueIid = primary?.issueIid ?? body.issueIid;
    if (issueIid == null) return reply.code(404).send({ error: 'not_found' });
    if (primary && (primary.reoperations ?? 0) >= config.maxReoperations) {
      return reply.code(409).send({ error: 'already_reoperated', reoperations: primary.reoperations });
    }

    // Posted with the HUMAN PAT so the flow's Mention trigger fires.
    const note = await addIntakeNote(issueIid, reoperateNote({ account: config.flowServiceAccount, mr: body.mr }));

    if (primary) {
      await store.update(primary.rid, {
        ...rememberNote(primary, note),
        ...transitionPatch(primary, 'in-surgery'),
        reoperations: (primary.reoperations ?? 0) + 1,
        mrIid: body.mr,
        ...(body.proof ? { proof: body.proof } : {}),
      });
    }
    req.log.info({ rid: req.params.rid, issueIid, mr: body.mr }, 're-operate mention posted');
    return { ok: true, issueIid, noteId: note?.id ?? null };
  });

  /**
   * Record a reporter verdict for the current fix round: from the SDK/service worker (👍/👎 tap) or
   * from a confirmation call (spoken yes/no, source 'call'). A rejection without a replay (a call)
   * reopens and re-triggers the flow without committing a new replay.
   * Returns {code, body} for the caller to send.
   */
  async function applyVerdict(rec, { verdict, deviceId = null, pushSubscription = null, replay: replayIn = null, voterKey = null, source = null, log }) {
    const primary = await primaryFor(rec);
    const issueIid = primary.issueIid ?? rec.issueIid;
    if (issueIid == null) return { code: 404, body: { error: 'not_found' } };

    // One verdict per fix round and per device (or per reporter rid when no device id is sent).
    const round = primary.fixRound ?? 1;
    const voter = voterKey ?? (deviceId ? `d:${deviceId}` : `r:${rec.rid}`);
    const key = `${round}:${voter}`;
    if ((primary.verdicts ?? []).some((v) => v.key === key)) {
      return { code: 200, body: { ok: true, duplicate: true, rid: rec.rid, state: primary.state } };
    }
    if (!['deployed', 'verified'].includes(primary.state)) {
      return { code: 409, body: { error: 'not_fixed', state: primary.state } };
    }

    const t = iso();
    const entry = { key, verdict, round, rid: rec.rid, at: t, ...(source ? { source } : {}) };
    const siblings = await store.findByIssueIid(issueIid);
    const all = siblings.length ? siblings : [primary];

    if (verdict === 'confirmed') {
      if (primary.state !== 'verified') {
        // Mark automation BEFORE touching GitLab: the label webhook can arrive before our calls return.
        await store.update(primary.rid, { lastAutomationAt: iso() });
        const note = await addIntakeNote(issueIid, verifiedNote({ certificateUrl: certificateUrl(primary.rid) }));
        await gitlab.updateIssue(issueIid, { addLabels: ['shakefix::verified'] });
        for (const r of all) {
          await store.update(r.rid, {
            ...transitionPatch(r, 'verified'),
            verifiedAt: t,
            stages: { ...(r.stages ?? {}), verified: r.stages?.verified ?? t },
            ...(r.rid === primary.rid ? rememberNote(r, note, { automation: true }) : {}),
          });
        }
      }
      const fresh = (await store.get(primary.rid)) ?? primary;
      await store.update(primary.rid, { verdicts: [...(fresh.verdicts ?? []), entry], updatedAt: t });
      log.info({ rid: rec.rid, issueIid, round, source }, 'reporter confirmed the fix');
      return { code: 200, body: { ok: true, rid: rec.rid, verdict, state: 'verified' } };
    }

    // rejected: commit the fresh replay (a spoken 👎 has none), reopen + relabel, note, re-trigger the flow.
    const replay = replayIn ? scrubReplay({ ...replayIn, rid: rec.rid }, config.inputAllowlist) : null;
    const n = replay ? (rec.replayCount ?? 1) + 1 : (rec.replayCount ?? 1);
    const filePath = replay ? verdictReplayPath(rec.rid, n) : null;
    if (replay) {
      const branch = config.reportsRef || (await gitlab.defaultBranch());
      await gitlab.commitFile({
        branch,
        filePath,
        content: `${JSON.stringify(replay, null, 2)}\n`,
        message: verdictReplayCommitMessage(rec.rid, n),
      });
    }
    await store.update(primary.rid, { lastAutomationAt: iso() }); // before the webhooks it causes
    await gitlab.updateIssue(issueIid, {
      stateEvent: 'reopen',
      addLabels: ['shakefix::reopened'],
      removeLabels: STATE_LABELS,
    });
    const posted = replay ? [await addIntakeNote(issueIid, rejectedNote({ replay, path: filePath }))] : [];

    // Posted with the HUMAN PAT so the flow's Mention trigger fires (bots cannot trigger flows).
    let retriggered = false;
    if (config.flowServiceAccount) {
      posted.push(await addIntakeNote(issueIid, retriageNote({ account: config.flowServiceAccount })));
      retriggered = true;
    } else {
      log.warn({ rid: rec.rid, issueIid }, 'FLOW_SERVICE_ACCOUNT not set; re-triage mention skipped');
    }

    for (const r of all) {
      await store.update(r.rid, {
        state: 'reopened',
        updatedAt: t,
        reopenedAt: t,
        timestamps: { ...(r.timestamps ?? {}), reopened: t },
      });
    }
    const fresh = (await store.get(primary.rid)) ?? primary;
    const noteIds = posted.map((n) => n?.id).filter((id) => id != null);
    await store.update(primary.rid, {
      verdicts: [...(fresh.verdicts ?? []), entry],
      rejections: (fresh.rejections ?? 0) + 1,
      intakeNoteIds: [...(fresh.intakeNoteIds ?? []), ...noteIds].slice(-MAX_NOTE_IDS),
      lastAutomationAt: iso(),
    });
    const own = (await store.get(rec.rid)) ?? rec;
    const subs = own.subscriptions ?? [];
    const addSub = pushSubscription && !subs.some((x) => x.endpoint === pushSubscription.endpoint);
    await store.update(rec.rid, {
      replayCount: n,
      ...(addSub ? { subscriptions: [...subs, pushSubscription] } : {}),
      ...(deviceId && !own.deviceId ? { deviceId } : {}),
    });
    // Medical Record (docs/MEMORY.md): reporter-rejected lesson + verdict count. Never blocks the verdict.
    if (replay && config.memoryLessons && typeof gitlab.getFile === 'function' && typeof gitlab.commitFiles === 'function') {
      try {
        const mem = await recordRejection({ gitlab, branch: await gitlab.defaultBranch(), iid: issueIid, replay, now: t });
        log.info({ rid: rec.rid, issueIid, ...mem }, 'medical record: reporter rejection recorded');
      } catch (err) {
        log.warn({ rid: rec.rid, issueIid, err: err.message }, 'medical record: rejection not recorded');
      }
    }
    log.info({ rid: rec.rid, issueIid, round, replay: filePath, retriggered, source }, 'reporter rejected the fix; issue reopened');
    return { code: 200, body: { ok: true, rid: rec.rid, verdict, state: 'reopened', replayPath: filePath, retriggered } };
  }

  // Reporter verdict on a delivered fix ("patient's verdict", BUILD_SPEC §17.5). Public:
  // called by the SDK sheet or the service worker's notification action. CORS allowlist applies.
  app.post('/v1/reports/:rid/verdict', async (req, reply) => {
    if (!validRid(req, reply)) return reply;
    const ipCheck = rate.checkIp(`verdict:${req.ip}`);
    if (!ipCheck.ok) return reply.code(429).header('retry-after', ipCheck.retryAfterSec).send({ error: 'rate_limited', scope: 'ip' });

    const parsed = verdictBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_verdict', issues: zodIssues(parsed.error) });
    const { verdict, deviceId, pushSubscription } = parsed.data;

    const rec = await store.get(req.params.rid);
    if (!rec) return reply.code(404).send({ error: 'not_found' });
    const out = await applyVerdict(rec, { verdict, deviceId, pushSubscription, replay: parsed.data.replay ?? null, log: req.log });
    return reply.code(out.code).send(out.body);
  });

  // Called by CI rollback.sh after production was rolled back: phone the on-call developer
  // ("send it back to the agents, or hold?"). The answer arrives on /v1/hooks/elevenlabs.
  app.post('/v1/oncall/call', async (req, reply) => {
    if (!requireHmac(req, reply)) return reply;
    const parsed = oncallBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', issues: zodIssues(parsed.error) });
    if (!vox.features.oncallCall) return reply.code(503).send({ error: 'oncall_call_not_configured' });
    const b = parsed.data;
    const first = b.issues.length ? (await store.findByIssueIid(b.issues[0])).find((r) => r.primary) : null;
    const placed = await vox.call({
      kind: 'oncall',
      to: config.oncallPhone,
      variables: {
        shakefix_issues: b.issues.join(','),
        version: b.version ?? 'unknown',
        prev_revision: b.prevRevision ?? 'the previous revision',
        reason: b.reason ?? 'the post-deploy smoke test failed',
        issue_title: first?.title ?? 'a ShakeFix fix',
      },
    });
    req.log.info({ issues: b.issues, conversationId: placed.conversationId }, 'on-call call placed');
    return { ok: true, conversationId: placed.conversationId };
  });

  // ElevenLabs post-call webhook: what the reporter or the on-call developer decided on the phone.
  app.post('/v1/hooks/elevenlabs', async (req, reply) => {
    if (!config.elevenWebhookSecret) return reply.code(503).send({ error: 'webhook_secret_not_configured' });
    if (!verifyElevenSignature(config.elevenWebhookSecret, req.rawBody ?? '', req.headers['elevenlabs-signature'], now())) {
      return reply.code(401).send({ error: 'bad_signature' });
    }
    if (req.body?.type !== 'post_call_transcription') return { ok: true, ignored: true };
    const o = callOutcome(req.body);

    if (o.kind === 'confirm') {
      if (!o.rid || !RID_RE.test(o.rid)) return { ok: true, ignored: true };
      const rec = await store.get(o.rid);
      if (!rec) return { ok: true, ignored: true };
      const primary = await primaryFor(rec);
      const issueIid = primary.issueIid ?? rec.issueIid;
      const calls = (rec.calls ?? []).map((c) => (c.conversationId && c.conversationId === o.conversationId ? { ...c, decision: o.decision, endedAt: iso() } : c));
      await store.update(rec.rid, { calls });
      if (issueIid != null) {
        await store.update(primary.rid, { lastAutomationAt: iso() });
        const note = await addIntakeNote(issueIid, callNote(o));
        const fresh = (await store.get(primary.rid)) ?? primary;
        await store.update(primary.rid, rememberNote(fresh, note, { automation: true }));
      }
      // A call about an older fix round must not decide the current one.
      const stale = o.round != null && o.round !== (primary.fixRound ?? 1);
      if (stale || o.decision === 'unsure') {
        req.log.info({ rid: rec.rid, decision: o.decision, stale }, 'confirmation call: no verdict');
        return { ok: true, kind: o.kind, decision: o.decision, applied: false };
      }
      const out = await applyVerdict(rec, {
        verdict: o.decision === 'yes' ? 'confirmed' : 'rejected',
        voterKey: `call:${rec.rid}`,
        source: 'call',
        log: req.log,
      });
      return { ok: true, kind: o.kind, decision: o.decision, applied: out.code === 200, state: out.body?.state ?? null };
    }

    if (o.kind === 'oncall') {
      for (const iid of o.issues) {
        const primary = (await store.findByIssueIid(iid)).find((r) => r.primary) ?? null;
        if (primary) await store.update(primary.rid, { lastAutomationAt: iso() });
        const notes = [await addIntakeNote(iid, callNote(o))];
        if (o.decision === 'retry') {
          await gitlab.updateIssue(iid, { addLabels: ['shakefix::voice-approved'], removeLabels: ['needs-human'] });
          // Human PAT mention: the flow's Mention trigger fires again for another attempt.
          if (config.flowServiceAccount) notes.push(await addIntakeNote(iid, retriageNote({ account: config.flowServiceAccount })));
        }
        if (primary) {
          const fresh = (await store.get(primary.rid)) ?? primary;
          const ids = notes.map((n) => n?.id).filter((id) => id != null);
          await store.update(primary.rid, { intakeNoteIds: [...(fresh.intakeNoteIds ?? []), ...ids].slice(-MAX_NOTE_IDS), lastAutomationAt: iso() });
        }
      }
      req.log.info({ issues: o.issues, decision: o.decision }, 'on-call call finished');
      return { ok: true, kind: o.kind, decision: o.decision, issues: o.issues };
    }
    return { ok: true, ignored: true };
  });

  app.post('/v1/hooks/gitlab', { bodyLimit: Math.max(config.maxBodyBytes, 5 * 1024 * 1024) }, async (req, reply) => {
    if (!config.webhookSecret) return reply.code(503).send({ error: 'webhook_secret_not_configured' });
    if (!safeEqual(String(req.headers['x-gitlab-token'] ?? ''), config.webhookSecret)) {
      return reply.code(401).send({ error: 'bad_token' });
    }
    const mapped = mapGitlabEvent(req.body);
    const hookIid = mapped?.issueIid ?? issueIidOfHook(req.body);
    if (!mapped && hookIid == null) return { ok: true, ignored: true };

    let rec = mapped?.rid ? await store.get(mapped.rid) : null;
    if (!rec && hookIid != null) {
      const all = await store.findByIssueIid(hookIid);
      rec = all.find((r) => r.primary) ?? null;
    }
    // Recover a record from the issue itself (e.g. memory store after a restart).
    if (!rec && mapped?.kind === 'issue' && mapped.rid && mapped.labels.includes('shakefix')) {
      const t = iso();
      const sevLabel = mapped.labels.find((l) => /^sev::[1-3]$/.test(l));
      const dupLabel = mapped.labels.find((l) => /^dup::[0-9a-f]{8}$/.test(l));
      rec = {
        rid: mapped.rid,
        issueIid: mapped.issueIid,
        issueUrl: req.body?.object_attributes?.url ?? null,
        title: mapped.title ?? '',
        sev: sevLabel ? Number(sevLabel.slice(5)) : 3,
        hash: dupLabel ? dupLabel.slice(5) : null,
        route: null,
        appName: null,
        state: 'received',
        mrIid: null,
        proof: { intended: null, unintended: null },
        primary: true,
        duplicateOf: null,
        subscriptions: [],
        reoperations: 0,
        createdAt: t,
        updatedAt: t,
        timestamps: { received: t },
      };
      await store.put(rec);
    }
    if (!rec) return { ok: true, ignored: true };

    const patch = {};
    let ns = null;
    if (mapped) {
      if (mapped.mrIid != null && mapped.kind !== 'issue') patch.mrIid = mapped.mrIid;
      if (mapped.kind === 'issue' && mapped.title) patch.title = mapped.title;
      ns = nextState(rec.state, mapped);
      if (ns) Object.assign(patch, transitionPatch(rec, ns));
    }
    // Agent timeline + human touches (src/timeline.js).
    let events = timelineEventsFromHook(req.body, {
      now: iso(),
      botUsernames,
      issueIid: rec.issueIid,
      intakeNoteIds: rec.intakeNoteIds,
      lastAutomationAt: rec.lastAutomationAt,
    });
    // Composite identity: a flow's label edits arrive in webhooks as the human who triggered it.
    // Before counting an edit as a human touch, ask GitLab's audit trail who really made it.
    events = await dropAgentEdits(events, req.body);
    const tl = applyTimelineEvents(rec, events);
    if (tl) {
      // CI's /fixed counts win; otherwise the latest Second Opinion note (it is edited in place on reruns).
      if (tl.proof && rec.proofSource === 'ci') delete tl.proof;
      Object.assign(patch, tl);
    }
    if (Object.keys(patch).length) {
      if (!patch.updatedAt) patch.updatedAt = iso();
      await store.update(rec.rid, patch);
    }
    return { ok: true, rid: rec.rid, state: ns ?? rec.state };
  });

  // Public, read-only, no PII (no subscriptions, notes, replays or IPs).
  app.get('/v1/board', async (req, reply) => {
    const all = await store.list({ limit: 200 });
    reply.header('cache-control', 'public, max-age=2');
    return {
      generatedAt: iso(),
      items: all
        .filter((r) => r.primary)
        .map((r) => ({
          rid: r.rid,
          issueIid: r.issueIid,
          title: r.title,
          sev: r.sev,
          state: r.state,
          mrIid: r.mrIid ?? null,
          proof: { intended: r.proof?.intended ?? null, unintended: r.proof?.unintended ?? null },
          verdict: currentVerdict(r),
          verdicts: verdictCounts(r),
          humanTouches: r.humanTouches ?? 0,
          timestamps: {
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            fixedAt: r.fixedAt ?? null,
            verifiedAt: r.verifiedAt ?? null,
            ...(r.timestamps ?? {}),
          },
        })),
    };
  });

  // Public, read-only: per-case agent timeline + stopwatch (no usernames, notes or replays).
  app.get('/v1/reports/:rid/timeline', async (req, reply) => {
    if (!validRid(req, reply)) return reply;
    const rec = await store.get(req.params.rid);
    if (!rec) return reply.code(404).send({ error: 'not_found' });
    const p = await primaryFor(rec);
    reply.header('cache-control', 'public, max-age=2');
    return buildTimeline(p, { now: iso() });
  });

  // Public README badge: "ShakeFix | Discharged N · 👍 X%".
  app.get('/v1/badge.svg', async (_req, reply) => {
    const all = (await store.list({ limit: 1000 })).filter((r) => r.primary);
    const stats = badgeStats(all, currentVerdict);
    reply.header('content-type', 'image/svg+xml; charset=utf-8').header('cache-control', 'public, max-age=60');
    return renderBadge({ message: badgeMessage(stats), color: badgeColor(stats) });
  });

  // Public, read-only: Discharge Certificate for a deployed/verified case (src/certificate.js).
  app.get('/v1/reports/:rid/certificate', async (req, reply) => {
    if (!validRid(req, reply)) return reply;
    const ipCheck = (rate.checkReadIp ?? rate.checkIp)(`cert:${req.ip}`);
    if (!ipCheck.ok) return reply.code(429).header('retry-after', ipCheck.retryAfterSec).send({ error: 'rate_limited', scope: 'ip' });
    const rec = await store.get(req.params.rid);
    if (!rec) return reply.code(404).send({ error: 'not_found' });
    const p = await primaryFor(rec);
    if (!isDischarged(p)) return reply.code(409).send({ error: 'not_discharged', state: p.state });
    reply.header('cache-control', 'public, max-age=5');
    return buildCertificate(p, { now: iso(), config, verdict: currentVerdict(p) });
  });

  // Public: check a certificate's signature. `current` = the digest still matches the case record.
  app.get('/v1/certificates/verify', async (req, reply) => {
    const ipCheck = (rate.checkReadIp ?? rate.checkIp)(`verify:${req.ip}`);
    if (!ipCheck.ok) return reply.code(429).header('retry-after', ipCheck.retryAfterSec).send({ error: 'rate_limited', scope: 'ip' });
    const parsed = certVerifyQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_query', issues: zodIssues(parsed.error) });
    const { rid, digest, signature } = parsed.data;
    if (!config.certSigningKey) return { valid: false, signed: false, reason: 'signing_key_not_configured' };
    const valid = verifyDigestSignature(config.certSigningKey, digest, signature);
    let current = null;
    const rec = await store.get(rid);
    if (rec) {
      const p = await primaryFor(rec);
      current = isDischarged(p) && buildCertificate(p, { now: iso(), config, verdict: currentVerdict(p) }).digest === digest;
    }
    return { valid, rid, current };
  });

  return app;
}

/** Issue iid for webhook kinds mapGitlabEvent ignores (push to shakefix/<iid>-*, notes). */
export function issueIidOfHook(payload) {
  const kind = payload?.object_kind ?? payload?.event_type;
  if (kind === 'push') return issueIidFromBranch(String(payload?.ref ?? '').replace(/^refs\/heads\//, ''));
  if (kind === 'note') {
    if (payload?.issue?.iid != null) return payload.issue.iid;
    return issueIidFromBranch(payload?.merge_request?.source_branch);
  }
  return null;
}

/** Verdict for the current fix round: 'rejected' wins over 'confirmed'; null when none yet. */
export function currentVerdict(record) {
  const round = record?.fixRound ?? 1;
  const vs = (record?.verdicts ?? []).filter((v) => (v.round ?? 1) === round);
  if (vs.some((v) => v.verdict === 'rejected')) return 'rejected';
  if (vs.some((v) => v.verdict === 'confirmed')) return 'confirmed';
  return null;
}

/** All-time verdict counts for a record (all rounds). */
export function verdictCounts(record) {
  const vs = record?.verdicts ?? [];
  return {
    confirmed: vs.filter((v) => v.verdict === 'confirmed').length,
    rejected: vs.filter((v) => v.verdict === 'rejected').length,
  };
}

function pick(obj, keys) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
