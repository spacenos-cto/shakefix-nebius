// Optional GitLab Orbit (knowledge graph) client for the blast radius. docs/ORBIT-NOTES.md.
//
// POST {GITLAB_URL}/api/v4/orbit/query with a CALLS traversal, hops [1,3]. Token: ORBIT_TOKEN,
// falling back to GITLAB_TOKEN. Project: ORBIT_PROJECT_ID, falling back to CI_PROJECT_ID.
// Orbit indexes the default branch only and has no route/endpoint entity, so routes always come
// from our own extractor (routes.js). Any non-200, empty or unparseable answer -> null, and the
// caller silently uses the static graph (source: "static").

export function orbitConfig(env = {}) {
  const gitlabUrl = (env.GITLAB_URL || env.CI_SERVER_URL || '').replace(/\/+$/, '');
  const token = env.ORBIT_TOKEN || env.GITLAB_TOKEN || '';
  const projectId = Number(env.ORBIT_PROJECT_ID || env.CI_PROJECT_ID || 0) || null;
  const enabled = Boolean(gitlabUrl && token && projectId) && env.SHAKEFIX_BLAST_ORBIT !== '0';
  return { gitlabUrl, token, projectId, enabled };
}

/**
 * Orbit DSL for "who calls X" (direction "callers") or "what does X call" (direction "callees").
 * @param {{projectId:number, name:string, filePath:string, direction?:'callers'|'callees', limit?:number}} q
 */
export function callsQuery({ projectId, name, filePath, direction = 'callers', limit = 200 }) {
  const cols = ['name', 'fqn', 'file_path', 'start_line', 'definition_type'];
  const other = direction === 'callers' ? 'caller' : 'callee';
  return {
    query: {
      query_type: 'traversal',
      nodes: [
        {
          id: 'target',
          entity: 'Definition',
          filters: { project_id: { eq: projectId }, name: { eq: name }, file_path: { ends_with: filePath } },
          columns: cols,
        },
        { id: other, entity: 'Definition', filters: { project_id: { eq: projectId } }, columns: cols },
      ],
      relationships: [
        direction === 'callers'
          ? { type: 'CALLS', from: 'caller', to: 'target', hops: [1, 3] }
          : { type: 'CALLS', from: 'target', to: 'callee', hops: [1, 3] },
      ],
      limit,
    },
    response_format: 'raw',
  };
}

const asNode = (v) => (v && typeof v === 'object' && typeof v.name === 'string' && typeof v.file_path === 'string'
  ? { name: v.name, file: v.file_path, line: v.start_line ?? null }
  : null);

/** Best-effort parse of a raw traversal response into [{target, other}] rows. */
export function parseRows(body, other) {
  const rows = body?.rows ?? body?.data?.rows ?? body?.results ?? body?.data ?? (Array.isArray(body) ? body : []);
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    let t = asNode(row.target);
    let o = asNode(row[other]);
    if (!t || !o) {
      // flat columns: target.name / target_name
      const get = (node, col) => row[`${node}.${col}`] ?? row[`${node}_${col}`];
      t = t ?? asNode({ name: get('target', 'name'), file_path: get('target', 'file_path'), start_line: get('target', 'start_line') });
      o = o ?? asNode({ name: get(other, 'name'), file_path: get(other, 'file_path'), start_line: get(other, 'start_line') });
    }
    if (t && o) out.push({ target: t, other: o });
  }
  return out;
}

/**
 * Ask Orbit for call edges around `targets` ([{name, filePath}], repo-relative paths).
 * @returns {Promise<null | Array<{from:{name,file}, to:{name,file}}>>} null = not usable, fall back.
 */
export async function orbitEdges(cfg, targets, { direction = 'callers', fetch: f = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (!cfg?.enabled || !targets.length || typeof f !== 'function') return null;
  const other = direction === 'callers' ? 'caller' : 'callee';
  const edges = [];
  for (const t of targets.slice(0, 10)) {
    let res;
    try {
      res = await f(`${cfg.gitlabUrl}/api/v4/orbit/query`, {
        method: 'POST',
        headers: { 'PRIVATE-TOKEN': cfg.token, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(callsQuery({ projectId: cfg.projectId, name: t.name, filePath: t.filePath, direction })),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return null;
    }
    if (res.status !== 200) return null;
    let body;
    try { body = await res.json(); } catch { return null; }
    for (const row of parseRows(body, other)) {
      edges.push(direction === 'callers' ? { from: row.other, to: row.target } : { from: row.target, to: row.other });
    }
  }
  return edges.length ? edges : null;
}
