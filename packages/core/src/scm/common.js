// Provider-neutral helpers shared by the GitLab and GitHub SCM providers.

const RID_RE = /shakefix:rid=([A-Za-z0-9_-]+)/;

/** rid from an issue description marker <!-- shakefix:rid=<rid> -->. */
export function ridFromText(text) {
  const m = RID_RE.exec(String(text || ''));
  return m ? m[1] : null;
}

/** Issue numbers referenced as "#123" or branch names like "fix/123-..." / "123-...". Deterministic order. */
export function issueRefsFromText(text) {
  const out = [];
  const add = (n) => { if (n && !out.includes(Number(n))) out.push(Number(n)); };
  for (const m of String(text || '').matchAll(/(?:^|[^\w&])#(\d+)\b/g)) add(m[1]);
  for (const m of String(text || '').matchAll(/(?:^|\/)(\d+)-[\w-]+/gm)) add(m[1]);
  return out;
}

/** Issue numbers closed by a PR/MR description ("Closes #12", "fixes #3", "resolved #4"). */
export function closingRefsFromText(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi)) {
    const n = Number(m[1]);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * Find the issue linked to an MR/PR: "closes" links first (preferring one with a rid marker),
 * then "#123" references in the description, title and source branch.
 */
export async function linkedIssue(scm, mrIid) {
  try {
    const list = await scm.mrClosesIssues(mrIid);
    if (Array.isArray(list) && list.length) {
      const withRid = list.find((i) => ridFromText(i.description));
      return withRid || list[0];
    }
  } catch { /* fall through to description parsing */ }
  const mr = await scm.getMR(mrIid);
  const refs = issueRefsFromText(`${mr.description || ''}\n${mr.title || ''}\n${mr.source_branch || ''}`);
  for (const iid of refs) {
    try {
      const issue = await scm.getIssue(iid);
      if (ridFromText(issue.description)) return issue;
    } catch { /* try next */ }
  }
  if (refs.length) return scm.getIssue(refs[0]);
  throw new Error(`MR !${mrIid} has no linked issue`);
}

/** Scope of a GitLab scoped label ("shakefix::ready" -> "shakefix"), else null. */
export function labelScope(label) {
  const i = String(label).lastIndexOf('::');
  return i > 0 ? String(label).slice(0, i) : null;
}

/**
 * Emulate GitLab scoped labels on a provider without them (GitHub): adding "a::x" removes every
 * other "a::*" label already on the item. Returns the full list of labels to remove.
 */
export function scopedRemovals(current = [], add = [], remove = []) {
  const out = new Set(remove);
  const scopes = new Set(add.map(labelScope).filter(Boolean));
  for (const l of current) {
    const s = labelScope(l);
    if (s && scopes.has(s) && !add.includes(l)) out.add(l);
  }
  for (const l of add) out.delete(l);
  return [...out];
}

/** Parse "a=b,c=d" into {a:"b", c:"d"}. */
export function parseLabelMap(s) {
  const out = {};
  for (const pair of String(s || '').split(',')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}
