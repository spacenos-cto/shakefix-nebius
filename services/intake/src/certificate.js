// Discharge Certificate: a signed, shareable record of what happened to one discharged case.
// Pure functions. Served by GET /v1/reports/:rid/certificate and checked by GET /v1/certificates/verify.
//
// digest    = sha256 hex of the canonical JSON (keys sorted, no whitespace) of the EVIDENCE fields
//             (everything in the certificate except issuedAt, links, digest, signature and signed).
// signature = hex(HMAC-SHA256(CERT_SIGNING_KEY, digest)), or null when no key is configured.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { stageTimes } from './timeline.js';

export const CERT_SCHEMA = 'shakefix.certificate/v1';
export const DISCHARGED_STATES = Object.freeze(['deployed', 'verified']);
export const CERT_STAGES = Object.freeze(['shaken', 'issue_created', 'mr_opened', 'second_opinion', 'merged', 'deployed', 'verified']);
/** Fields covered by the digest, in the order they are documented. */
export const EVIDENCE_FIELDS = Object.freeze(['schema', 'rid', 'title', 'state', 'issue', 'mr', 'stages', 'durations', 'humanTouches', 'proof', 'verdict']);
const HEX64 = /^[0-9a-f]{64}$/;

export const isDischarged = (record) => DISCHARGED_STATES.includes(record?.state);

/** JSON with object keys sorted recursively (arrays keep their order). */
export function canonicalJson(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');
export const signDigest = (key, digest) => (key ? createHmac('sha256', key).update(digest).digest('hex') : null);

/** Constant-time check of hex(HMAC(key, digest)). False (never throws) for missing key or malformed input. */
export function verifyDigestSignature(key, digest, signature) {
  if (!key || typeof digest !== 'string' || typeof signature !== 'string') return false;
  const d = digest.toLowerCase();
  const sig = signature.toLowerCase();
  if (!HEX64.test(d) || !HEX64.test(sig)) return false;
  return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(signDigest(key, d), 'hex'));
}

/**
 * GitLab project web URL: GITLAB_PROJECT_WEB_URL, else derived from the record's issue URL,
 * else GITLAB_URL/<project path> when GITLAB_PROJECT_ID is a path (not a numeric id).
 */
export function projectWebUrl(config, record) {
  if (config?.gitlabProjectWebUrl) return config.gitlabProjectWebUrl;
  const m = /^(https?:\/\/.+?)\/-\/issues\/\d+\/?$/.exec(String(record?.issueUrl ?? ''));
  if (m) return m[1];
  const id = String(config?.projectId ?? '');
  if (config?.gitlabUrl && id && !/^\d+$/.test(id)) return `${config.gitlabUrl}/${decodeURIComponent(id)}`;
  return null;
}

const ms = (a, b) => {
  const d = Date.parse(b ?? '') - Date.parse(a ?? '');
  return Number.isFinite(d) && d >= 0 ? d : null;
};

/** Evidence object (the digested part of the certificate). */
export function certificateEvidence(record, { verdict = null } = {}) {
  const t = stageTimes(record);
  const stages = Object.fromEntries(CERT_STAGES.map((k) => [k, t[k] ? new Date(t[k]).toISOString() : null]));
  const num = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
  return {
    schema: CERT_SCHEMA,
    rid: record.rid,
    title: record.title ?? '',
    state: record.state,
    issue: { iid: record.issueIid ?? null },
    mr: { iid: record.mrIid ?? null },
    stages,
    durations: {
      shakeToDeployedMs: ms(stages.shaken, stages.deployed),
      shakeToVerifiedMs: ms(stages.shaken, stages.verified),
    },
    humanTouches: record.humanTouches ?? (record.timeline ?? []).filter((e) => e.type === 'human').length,
    proof: { intended: num(record.proof?.intended), unintended: num(record.proof?.unintended) },
    verdict: verdict === 'confirmed' || verdict === 'rejected' ? verdict : 'awaiting',
  };
}

/**
 * Full certificate for a discharged record.
 * @param {object} record  primary report record
 * @param {{now: string, config: object, verdict?: string|null}} opts
 */
export function buildCertificate(record, { now, config, verdict = null }) {
  const ev = certificateEvidence(record, { verdict });
  const digest = sha256Hex(canonicalJson(ev));
  const key = config?.certSigningKey || '';
  const base = projectWebUrl(config, record);
  const issueUrl = record.issueUrl ?? (base && ev.issue.iid != null ? `${base}/-/issues/${ev.issue.iid}` : null);
  const mrUrl = base && ev.mr.iid != null ? `${base}/-/merge_requests/${ev.mr.iid}` : null;
  return {
    ...ev,
    issue: { iid: ev.issue.iid, url: issueUrl },
    mr: { iid: ev.mr.iid, url: mrUrl },
    issuedAt: now,
    evidenceFields: EVIDENCE_FIELDS,
    digestAlgorithm: 'sha256(canonical-json(evidence))',
    digest,
    signatureAlgorithm: 'hmac-sha256(CERT_SIGNING_KEY, digest)',
    signature: signDigest(key, digest),
    signed: Boolean(key),
  };
}
