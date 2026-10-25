// I/O side of Fix Confidence: collects the optional inputs from CI env and the MR.
// Every source is best effort; a missing input lowers the score a little, it never crashes the gate.

import { confidenceThreshold, normalizeStatus, signalsFromTexts } from './confidence.js';

/** Unit-test status from PROOF_UNIT_STATUS, else the `unit` job of this pipeline (GitLab). */
export async function unitStatus({ env = process.env, scm = null, log = () => {} } = {}) {
  if (env.PROOF_UNIT_STATUS) return normalizeStatus(env.PROOF_UNIT_STATUS);
  if (!scm?.request || scm.name !== 'gitlab' || !env.CI_PIPELINE_ID || !env.CI_PROJECT_ID) return 'unknown';
  try {
    const jobs = await scm.request('GET', `/projects/${encodeURIComponent(env.CI_PROJECT_ID)}/pipelines/${encodeURIComponent(env.CI_PIPELINE_ID)}/jobs`, { query: { per_page: 100 } });
    const unit = (Array.isArray(jobs) ? jobs : []).find((j) => j.name === (env.PROOF_UNIT_JOB || 'unit'));
    if (!unit) return 'unknown';
    if (unit.status === 'success') return 'pass';
    if (unit.status === 'failed') return 'fail';
    return 'unknown'; // still running or skipped
  } catch (err) {
    log(`warn: could not read pipeline jobs (${err.message})`);
    return 'unknown';
  }
}

/** Attending JSON + memory premortem risk from the MR description and notes (last one wins). */
export async function mrSignals({ scm = null, mr = null, log = () => {} } = {}) {
  if (!scm || !mr) return { attending: null, premortemRisk: null };
  const texts = [];
  try { texts.push((await scm.getMR(mr))?.description ?? ''); } catch (err) { log(`warn: could not read MR !${mr} (${err.message})`); }
  try {
    const notes = typeof scm.listMRNotes === 'function' ? await scm.listMRNotes(mr) : [];
    for (const n of notes ?? []) if (!n.system) texts.push(n.body ?? '');
  } catch (err) { log(`warn: could not read MR notes (${err.message})`); }
  return signalsFromTexts(texts);
}

/** Everything evaluateGate({confidence}) accepts. */
export async function gatherConfidenceInputs({ env = process.env, scm = null, mr = null, log = () => {} } = {}) {
  const [unit, sig] = await Promise.all([unitStatus({ env, scm, log }), mrSignals({ scm, mr, log })]);
  const premortemRisk = env.PROOF_PREMORTEM_RISK ? env.PROOF_PREMORTEM_RISK : sig.premortemRisk;
  return { unit, attending: sig.attending, premortemRisk, threshold: confidenceThreshold(env) };
}
