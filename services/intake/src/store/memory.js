// In-memory store (default; dev/tests). Data is lost on restart.
// Store interface (both impls):
//   get(rid) -> record|null
//   put(record) -> void                    (create or replace)
//   update(rid, patch) -> record|null      (shallow merge; returns the merged record)
//   findByIssueIid(iid) -> record[]
//   list({limit}) -> record[]              (newest first)

export function createMemoryStore() {
  const map = new Map();
  const clone = (r) => (r ? structuredClone(r) : null);

  return {
    kind: 'memory',
    async get(rid) {
      return clone(map.get(rid));
    },
    async put(record) {
      map.set(record.rid, clone(record));
    },
    async update(rid, patch) {
      const cur = map.get(rid);
      if (!cur) return null;
      const next = { ...cur, ...clone(patch) };
      map.set(rid, next);
      return clone(next);
    },
    async findByIssueIid(iid) {
      return [...map.values()].filter((r) => r.issueIid === iid).map(clone);
    },
    async list({ limit = 100 } = {}) {
      return [...map.values()]
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, limit)
        .map(clone);
    },
  };
}
