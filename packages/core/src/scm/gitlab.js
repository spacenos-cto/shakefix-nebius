// GitLab ScmProvider: REST v4 on fetch (no SDK). The token is sent only in the PRIVATE-TOKEN
// header and never included in errors or logs.
//
// The issue-side methods (defaultBranch, commitFile, uploadFile, createIssue,
// findOpenIssueByLabel, updateIssue, addIssueNote, startFlow) are byte-for-byte the requests of
// services/intake/src/gitlab.js; test/scm-gitlab.test.js asserts they stay identical. The intake
// keeps its own copy because its Docker build context is services/intake only.

import { GitlabError } from './errors.js';
import { linkedIssue, ridFromText } from './common.js';

export { GitlabError };

/**
 * @param {object} o
 * @param {string} [o.baseUrl]   instance URL, e.g. https://gitlab.com ("/api/v4" is appended)
 * @param {string} [o.apiUrl]    full API URL, e.g. $CI_API_V4_URL (wins over baseUrl)
 * @param {string|number} o.projectId  numeric id or "group/project"
 * @param {string} o.token
 */
export function createGitlabProvider({ baseUrl = 'https://gitlab.com', apiUrl, projectId, token, fetch: f = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  const api = apiUrl ? String(apiUrl).replace(/\/+$/, '') : `${String(baseUrl).replace(/\/+$/, '')}/api/v4`;
  const pid = encodeURIComponent(String(projectId ?? ''));
  const P = `/projects/${pid}`;
  const enc = (v) => encodeURIComponent(String(v));
  let defaultBranchCache = null;

  async function request(method, path, { json, form, query, raw = false } = {}) {
    const url = new URL(api + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = { 'PRIVATE-TOKEN': token, accept: 'application/json' };
    let body;
    if (json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form; // fetch sets the multipart boundary
    }
    const res = await f(url.toString(), { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (raw && res.ok) return text;
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) throw new GitlabError(method, path, res.status, data);
    return data;
  }

  async function fileExists(path, ref) {
    try {
      await request('HEAD', `${P}/repository/files/${enc(path)}`, { query: { ref } });
      return true;
    } catch (err) {
      if (err.status === 404) return false;
      throw err;
    }
  }

  const scm = {
    name: 'gitlab',
    capabilities: Object.freeze({ scopedLabels: true, uploads: true, flows: true, mergeWhenPipelineSucceeds: true }),
    request,

    async defaultBranch() {
      if (!defaultBranchCache) {
        const p = await request('GET', P);
        defaultBranchCache = p?.default_branch || 'main';
      }
      return defaultBranchCache;
    },

    // ------------------------------------------------------------------ issues
    getIssue: (iid) => request('GET', `${P}/issues/${enc(iid)}`),

    createIssue({ title, description, labels = [] }) {
      return request('POST', `${P}/issues`, { json: { title, description, labels: labels.join(',') } });
    },

    async findOpenIssueByLabel(label) {
      const list = await request('GET', `${P}/issues`, {
        query: { labels: label, state: 'opened', per_page: 1, order_by: 'created_at', sort: 'asc' },
      });
      return Array.isArray(list) && list.length ? list[0] : null;
    },

    /** Labels and open/close state in one call (PUT /issues/:iid). */
    updateIssue(issueIid, { addLabels, removeLabels, stateEvent } = {}) {
      const json = {};
      if (addLabels?.length) json.add_labels = addLabels.join(',');
      if (removeLabels?.length) json.remove_labels = removeLabels.join(',');
      if (stateEvent) json.state_event = stateEvent; // 'reopen' | 'close'
      return request('PUT', `${P}/issues/${enc(issueIid)}`, { json });
    },

    addIssueNote(issueIid, body) {
      return request('POST', `${P}/issues/${enc(issueIid)}/notes`, { json: { body } });
    },

    listIssueNotes: (iid) => request('GET', `${P}/issues/${enc(iid)}/notes`, { query: { per_page: 100, sort: 'asc' } }),

    async findRidInIssue(iid) {
      return ridFromText((await scm.getIssue(iid))?.description);
    },

    // ------------------------------------------------------------------ repository
    getFile: (path, ref) => request('GET', `${P}/repository/files/${enc(path)}/raw`, { query: { ref }, raw: true }),

    /** Create one file in one commit. */
    commitFile({ branch, filePath, content, message }) {
      return request('POST', `${P}/repository/commits`, {
        json: { branch, commit_message: message, actions: [{ action: 'create', file_path: filePath, content }] },
      });
    },

    /**
     * Several files in one commit. files: [{path, content, action?: 'create'|'update'|'delete'|'upsert'}].
     * startBranch creates `branch` from it when `branch` does not exist yet.
     */
    async commitFiles({ branch, startBranch, message, files }) {
      const ref = startBranch ? startBranch : branch;
      const actions = [];
      for (const fl of files) {
        let action = fl.action || 'upsert';
        if (action === 'upsert') action = (await fileExists(fl.path, ref)) ? 'update' : 'create';
        actions.push(action === 'delete' ? { action, file_path: fl.path } : { action, file_path: fl.path, content: fl.content });
      }
      const json = { branch, commit_message: message, actions };
      if (startBranch) json.start_branch = startBranch;
      return request('POST', `${P}/repository/commits`, { json });
    },

    createBranch({ branch, ref }) {
      return request('POST', `${P}/repository/branches`, { json: { branch, ref } });
    },

    /** Upload a file; returns {alt, url, full_path, markdown}. */
    uploadFile({ filename, data, contentType = 'image/png' }) {
      const form = new FormData();
      form.append('file', new Blob([data], { type: contentType }), filename);
      return request('POST', `${P}/uploads`, { form });
    },

    // ------------------------------------------------------------------ merge requests
    getMR: (iid) => request('GET', `${P}/merge_requests/${enc(iid)}`),

    async findMRBySourceBranch(branch) {
      const list = await request('GET', `${P}/merge_requests`, { query: { source_branch: branch, state: 'opened', per_page: 1 } });
      return Array.isArray(list) && list.length ? list[0] : null;
    },

    createMR({ sourceBranch, targetBranch, title, description, labels = [], removeSourceBranch = true, squash = true }) {
      return request('POST', `${P}/merge_requests`, {
        json: {
          source_branch: sourceBranch, target_branch: targetBranch, title, description,
          labels: labels.join(','), remove_source_branch: removeSourceBranch, squash,
        },
      });
    },

    updateMR(iid, { addLabels, removeLabels, title, description } = {}) {
      const json = {};
      if (addLabels?.length) json.add_labels = addLabels.join(',');
      if (removeLabels?.length) json.remove_labels = removeLabels.join(',');
      if (title !== undefined) json.title = title;
      if (description !== undefined) json.description = description;
      return request('PUT', `${P}/merge_requests/${enc(iid)}`, { json });
    },

    addMRNote: (iid, body) => request('POST', `${P}/merge_requests/${enc(iid)}/notes`, { json: { body } }),

    updateMRNote: (iid, noteId, body) => request('PUT', `${P}/merge_requests/${enc(iid)}/notes/${enc(noteId)}`, { json: { body } }),

    listMRNotes: (iid) => request('GET', `${P}/merge_requests/${enc(iid)}/notes`, { query: { per_page: 100, sort: 'asc' } }),

    mrClosesIssues: (iid) => request('GET', `${P}/merge_requests/${enc(iid)}/closes_issues`),

    linkedIssue: (mrIid) => linkedIssue(scm, mrIid),

    mergeMR(iid, { sha, squash = true, removeSourceBranch = true, whenPipelineSucceeds = true, commitMessage } = {}) {
      const json = { should_remove_source_branch: removeSourceBranch, squash };
      if (sha) json.sha = sha;
      if (whenPipelineSucceeds) {
        json.auto_merge = true;
        json.merge_when_pipeline_succeeds = true;
      }
      if (commitMessage) json.squash_commit_message = commitMessage;
      return request('PUT', `${P}/merge_requests/${enc(iid)}/merge`, { json });
    },

    // ------------------------------------------------------------------ Duo
    /**
     * Fallback flow start (BUILD_SPEC §10.7 option A).
     * TODO(verify): endpoint path and field names (`project_id`, `goal`, `workflow_definition`)
     * MUST be verified against the current GitLab Duo Agent Platform API docs before relying on it.
     */
    startFlow({ goal, workflowDefinition }) {
      return request('POST', '/ai/duo_workflows/workflows', {
        json: { project_id: String(projectId), goal, workflow_definition: workflowDefinition },
      });
    },
  };
  return scm;
}
