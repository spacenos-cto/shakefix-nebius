// Minimal GitLab REST client on fetch (no SDK). The token is sent only in the
// PRIVATE-TOKEN header and never included in errors or logs.
//
// This is the intake's GitLab ScmProvider (SCM_PROVIDER=gitlab, the default; see ./scm.js). It is
// kept self-contained because the Docker build context is services/intake. The canonical, larger
// provider is packages/core/src/scm/gitlab.js; packages/core/test/scm-gitlab.test.js asserts both
// send identical requests for every method here.

export class GitlabError extends Error {
  constructor(method, path, status, data) {
    const detail = typeof data === 'object' && data ? data.message ?? data.error ?? '' : '';
    super(`GitLab ${method} ${path} -> ${status}${detail ? `: ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
    this.name = 'GitlabError';
    this.status = status;
    this.data = data;
  }
}

export function createGitlabClient({ baseUrl = 'https://gitlab.com', projectId, token, fetch: f = globalThis.fetch, timeoutMs = 15_000 }) {
  const api = `${String(baseUrl).replace(/\/+$/, '')}/api/v4`;
  const pid = encodeURIComponent(String(projectId ?? ''));
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
      await request('HEAD', `/projects/${pid}/repository/files/${encodeURIComponent(String(path))}`, { query: { ref } });
      return true;
    } catch (err) {
      if (err.status === 404) return false;
      throw err;
    }
  }

  return {
    request,

    /** Who really changed labels (GitLab audit trail): [{user, at}] for an issue or MR. */
    async labelEventActors(kind, iid) {
      const path = kind === 'merge_request' ? 'merge_requests' : 'issues';
      const list = await request('GET', `/projects/${pid}/${path}/${encodeURIComponent(String(iid))}/resource_label_events`, { query: { per_page: 100 } });
      return (Array.isArray(list) ? list : []).map((e) => ({ user: e.user?.username ?? null, at: e.created_at }));
    },

    async defaultBranch() {
      if (!defaultBranchCache) {
        const p = await request('GET', `/projects/${pid}`);
        defaultBranchCache = p?.default_branch || 'main';
      }
      return defaultBranchCache;
    },

    /** Raw file content at a ref (throws GitlabError with status 404 when missing). */
    getFile: (path, ref) => request('GET', `/projects/${pid}/repository/files/${encodeURIComponent(String(path))}/raw`, { query: { ref }, raw: true }),

    /**
     * Several files in one commit. files: [{path, content, action?: 'create'|'update'|'delete'|'upsert'}].
     * Same requests as packages/core/src/scm/gitlab.js commitFiles (drift guard in packages/core/test).
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
      return request('POST', `/projects/${pid}/repository/commits`, { json });
    },

    /** Create one file in one commit. */
    commitFile({ branch, filePath, content, message }) {
      return request('POST', `/projects/${pid}/repository/commits`, {
        json: { branch, commit_message: message, actions: [{ action: 'create', file_path: filePath, content }] },
      });
    },

    /** Upload a file; returns {alt, url, full_path, markdown}. */
    uploadFile({ filename, data, contentType = 'image/png' }) {
      const form = new FormData();
      form.append('file', new Blob([data], { type: contentType }), filename);
      return request('POST', `/projects/${pid}/uploads`, { form });
    },

    createIssue({ title, description, labels }) {
      return request('POST', `/projects/${pid}/issues`, {
        json: { title, description, labels: labels.join(',') },
      });
    },

    async findOpenIssueByLabel(label) {
      const list = await request('GET', `/projects/${pid}/issues`, {
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
      return request('PUT', `/projects/${pid}/issues/${encodeURIComponent(issueIid)}`, { json });
    },

    addIssueNote(issueIid, body) {
      return request('POST', `/projects/${pid}/issues/${encodeURIComponent(issueIid)}/notes`, { json: { body } });
    },

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
}
