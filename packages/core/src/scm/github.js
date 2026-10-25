// GitHub ScmProvider: REST v3 on fetch (no SDK). Pull requests play the role of merge requests.
// Objects are normalised to the GitLab shapes the rest of ShakeFix reads
// (iid, description, labels[], web_url, source_branch, ...), with the original under `raw`.
//
// Label mapping: GitHub has no scoped labels, so adding "shakefix::ready" removes any other
// "shakefix::*" label on the item (GitLab does this natively). An optional labelMap renames
// labels on the way out, e.g. {"shakefix::ready": "shakefix: ready"}.

import { GithubError, NotSupportedError } from './errors.js';
import { closingRefsFromText, linkedIssue, ridFromText, scopedRemovals } from './common.js';

export { GithubError };

const b64 = (s) => Buffer.from(typeof s === 'string' ? s : s).toString('base64');

export function normalizeIssue(i) {
  if (!i) return i;
  return {
    iid: i.number,
    id: i.id,
    title: i.title,
    description: i.body ?? '',
    labels: (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
    state: i.state === 'open' ? 'opened' : 'closed',
    web_url: i.html_url,
    author: i.user ? { username: i.user.login } : null,
    raw: i,
  };
}

export function normalizePR(p) {
  if (!p) return p;
  return {
    iid: p.number,
    id: p.id,
    title: p.title,
    description: p.body ?? '',
    labels: (p.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
    state: p.merged_at || p.merged ? 'merged' : p.state === 'open' ? 'opened' : 'closed',
    draft: Boolean(p.draft),
    source_branch: p.head?.ref,
    target_branch: p.base?.ref,
    sha: p.head?.sha,
    web_url: p.html_url,
    raw: p,
  };
}

export function normalizeNote(c) {
  return { id: c.id, body: c.body ?? '', author: c.user ? { username: c.user.login } : null, created_at: c.created_at, raw: c };
}

/**
 * @param {object} o
 * @param {string} o.repo   "owner/name"
 * @param {string} o.token
 * @param {string} [o.apiUrl] default https://api.github.com (GitHub Enterprise: https://host/api/v3)
 * @param {Record<string,string>} [o.labelMap]
 * @param {string} [o.uploadsPath] where uploadFile commits files (default reports/uploads)
 */
export function createGithubProvider({ repo, token, apiUrl = 'https://api.github.com', fetch: f = globalThis.fetch, timeoutMs = 15_000, labelMap = {}, uploadsPath = 'reports/uploads' } = {}) {
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(String(repo))) throw new Error('GitHub provider needs repo "owner/name" (GITHUB_REPO)');
  const api = String(apiUrl).replace(/\/+$/, '');
  const [owner, name] = String(repo).split('/');
  const R = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const enc = (v) => encodeURIComponent(String(v));
  const encPath = (p) => String(p).split('/').map(encodeURIComponent).join('/');
  const mapLabel = (l) => labelMap[l] ?? l;
  let defaultBranchCache = null;

  async function request(method, path, { json, query, accept = 'application/vnd.github+json', raw = false } = {}) {
    const url = new URL(api + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = {
      authorization: `Bearer ${token}`,
      accept,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'shakefix',
    };
    let body;
    if (json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(json);
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
    if (!res.ok) throw new GithubError(method, path, res.status, data);
    return data;
  }

  const ignore404 = (p) => p.catch((err) => { if (err?.status === 404) return null; throw err; });

  async function refSha(branch) {
    const r = await ignore404(request('GET', `${R}/git/ref/heads/${encPath(branch)}`));
    return r?.object?.sha ?? null;
  }

  /** Apply label changes to an issue or PR (same endpoint on GitHub). */
  async function setLabels(number, { addLabels = [], removeLabels = [] } = {}, known) {
    const add = addLabels.map(mapLabel);
    let remove = removeLabels.map(mapLabel);
    if (add.some((l) => l.includes('::'))) {
      const current = known ?? await request('GET', `${R}/issues/${enc(number)}/labels`, { query: { per_page: 100 } });
      remove = scopedRemovals((Array.isArray(current) ? current : []).map((l) => (typeof l === 'string' ? l : l.name)), add, remove);
    }
    for (const l of remove) await ignore404(request('DELETE', `${R}/issues/${enc(number)}/labels/${enc(l)}`));
    if (add.length) await request('POST', `${R}/issues/${enc(number)}/labels`, { json: { labels: add } });
  }

  async function issuesFor(numbers) {
    const out = [];
    for (const n of numbers) {
      try { out.push(normalizeIssue(await request('GET', `${R}/issues/${enc(n)}`))); } catch { /* skip */ }
    }
    return out;
  }

  const scm = {
    name: 'github',
    capabilities: Object.freeze({ scopedLabels: false, uploads: false, flows: false, mergeWhenPipelineSucceeds: false }),
    request,
    repo: `${owner}/${name}`,

    async defaultBranch() {
      if (!defaultBranchCache) {
        const p = await request('GET', R);
        defaultBranchCache = p?.default_branch || 'main';
      }
      return defaultBranchCache;
    },

    // ------------------------------------------------------------------ issues
    async getIssue(n) {
      return normalizeIssue(await request('GET', `${R}/issues/${enc(n)}`));
    },

    async createIssue({ title, description, labels = [] }) {
      return normalizeIssue(await request('POST', `${R}/issues`, { json: { title, body: description, labels: labels.map(mapLabel) } }));
    },

    async findOpenIssueByLabel(label) {
      const list = await request('GET', `${R}/issues`, {
        query: { labels: mapLabel(label), state: 'open', per_page: 10, sort: 'created', direction: 'asc' },
      });
      const hit = (Array.isArray(list) ? list : []).find((i) => !i.pull_request);
      return hit ? normalizeIssue(hit) : null;
    },

    async updateIssue(n, { addLabels, removeLabels, stateEvent } = {}) {
      await setLabels(n, { addLabels, removeLabels });
      if (stateEvent) {
        const state = stateEvent === 'reopen' ? 'open' : stateEvent === 'close' ? 'closed' : stateEvent;
        await request('PATCH', `${R}/issues/${enc(n)}`, { json: { state } });
      }
      return scm.getIssue(n);
    },

    async addIssueNote(n, body) {
      return normalizeNote(await request('POST', `${R}/issues/${enc(n)}/comments`, { json: { body } }));
    },

    async listIssueNotes(n) {
      const list = await request('GET', `${R}/issues/${enc(n)}/comments`, { query: { per_page: 100 } });
      return (list || []).map(normalizeNote);
    },

    async findRidInIssue(n) {
      return ridFromText((await scm.getIssue(n))?.description);
    },

    // ------------------------------------------------------------------ repository
    getFile: (path, ref) => request('GET', `${R}/contents/${encPath(path)}`, { query: { ref }, accept: 'application/vnd.github.raw+json', raw: true }),

    /** Create or update one file in one commit (contents API). */
    async commitFile({ branch, filePath, content, message }) {
      const existing = await ignore404(request('GET', `${R}/contents/${encPath(filePath)}`, { query: { ref: branch } }));
      const json = { message, content: b64(content), branch };
      if (existing?.sha) json.sha = existing.sha;
      return request('PUT', `${R}/contents/${encPath(filePath)}`, { json });
    },

    /**
     * Several files in ONE commit via the git data API. files: [{path, content, action?}]
     * (action 'delete' removes the path). Creates `branch` from startBranch (or the default
     * branch) when it does not exist.
     */
    async commitFiles({ branch, startBranch, message, files }) {
      let parent = await refSha(branch);
      const exists = Boolean(parent);
      if (!parent) {
        const from = startBranch || (await scm.defaultBranch());
        parent = await refSha(from);
        if (!parent) throw new GithubError('GET', `${R}/git/ref/heads/${from}`, 404, { message: `branch ${from} not found` });
      }
      const base = await request('GET', `${R}/git/commits/${enc(parent)}`);
      const tree = files.map((fl) => (fl.action === 'delete'
        ? { path: fl.path, mode: '100644', type: 'blob', sha: null }
        : { path: fl.path, mode: '100644', type: 'blob', content: String(fl.content) }));
      const t = await request('POST', `${R}/git/trees`, { json: { base_tree: base.tree.sha, tree } });
      const c = await request('POST', `${R}/git/commits`, { json: { message, tree: t.sha, parents: [parent] } });
      if (exists) await request('PATCH', `${R}/git/refs/heads/${encPath(branch)}`, { json: { sha: c.sha, force: false } });
      else await request('POST', `${R}/git/refs`, { json: { ref: `refs/heads/${branch}`, sha: c.sha } });
      return { id: c.sha, sha: c.sha, branch, web_url: c.html_url };
    },

    async createBranch({ branch, ref }) {
      const sha = (await refSha(ref)) || ref; // ref may already be a sha
      return request('POST', `${R}/git/refs`, { json: { ref: `refs/heads/${branch}`, sha } });
    },

    /**
     * GitHub has no issue-attachment API: the file is committed under uploadsPath on the
     * default branch with [skip ci]. Returns {url, markdown} like GitLab's uploads API.
     */
    async uploadFile({ filename, data }) {
      const branch = await scm.defaultBranch();
      const path = `${uploadsPath.replace(/\/+$/, '')}/${filename}`;
      const res = await request('PUT', `${R}/contents/${encPath(path)}`, {
        json: { message: `chore(shakefix): upload ${filename} [skip ci]`, content: Buffer.from(data).toString('base64'), branch },
      });
      const url = res?.content?.download_url || res?.content?.html_url || `https://github.com/${owner}/${name}/blob/${branch}/${path}?raw=true`;
      return { alt: filename, url, full_path: path, markdown: `![${filename}](${url})` };
    },

    // ------------------------------------------------------------------ pull requests (≈ MRs)
    async getMR(n) {
      return normalizePR(await request('GET', `${R}/pulls/${enc(n)}`));
    },

    async findMRBySourceBranch(branch) {
      const list = await request('GET', `${R}/pulls`, { query: { head: `${owner}:${branch}`, state: 'open', per_page: 1 } });
      return Array.isArray(list) && list.length ? normalizePR(list[0]) : null;
    },

    async createMR({ sourceBranch, targetBranch, title, description, labels = [] }) {
      const pr = await request('POST', `${R}/pulls`, { json: { title, head: sourceBranch, base: targetBranch, body: description } });
      if (labels.length) await setLabels(pr.number, { addLabels: labels }, []); // a new PR has no labels yet
      return normalizePR({ ...pr, labels: labels.map((l) => ({ name: mapLabel(l) })) });
    },

    async updateMR(n, { addLabels, removeLabels, title, description } = {}) {
      await setLabels(n, { addLabels, removeLabels });
      const json = {};
      if (title !== undefined) json.title = title;
      if (description !== undefined) json.body = description;
      if (Object.keys(json).length) return normalizePR(await request('PATCH', `${R}/pulls/${enc(n)}`, { json }));
      return scm.getMR(n);
    },

    async addMRNote(n, body) {
      return normalizeNote(await request('POST', `${R}/issues/${enc(n)}/comments`, { json: { body } }));
    },

    async updateMRNote(_n, noteId, body) {
      return normalizeNote(await request('PATCH', `${R}/issues/comments/${enc(noteId)}`, { json: { body } }));
    },

    async listMRNotes(n) {
      return scm.listIssueNotes(n);
    },

    async mrClosesIssues(n) {
      const pr = await scm.getMR(n);
      return issuesFor(closingRefsFromText(pr.description));
    },

    linkedIssue: (n) => linkedIssue(scm, n),

    /**
     * Merge now (GitHub's "auto-merge" needs GraphQL; the merge job runs after the required checks
     * instead). whenPipelineSucceeds is accepted for interface parity and ignored.
     */
    async mergeMR(n, { sha, squash = true, removeSourceBranch = true, commitMessage } = {}) {
      const json = { merge_method: squash ? 'squash' : 'merge' };
      if (sha) json.sha = sha;
      if (commitMessage) json.commit_title = commitMessage;
      const res = await request('PUT', `${R}/pulls/${enc(n)}/merge`, { json });
      if (removeSourceBranch) {
        try {
          const pr = await scm.getMR(n);
          if (pr.source_branch && pr.raw?.head?.repo?.full_name === `${owner}/${name}`) {
            await ignore404(request('DELETE', `${R}/git/refs/heads/${encPath(pr.source_branch)}`));
          }
        } catch { /* branch cleanup is best effort */ }
      }
      return res;
    },

    startFlow() {
      throw new NotSupportedError('github', 'startFlow (GitLab Duo only; use AGENT_RUNNER=local)');
    },
  };
  return scm;
}
