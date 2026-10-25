// Firestore store (STORE=firestore). @google-cloud/firestore is Apache-2.0 and is
// imported lazily so the default (memory) path never loads it.
// Collection: FIRESTORE_COLLECTION (default "reports"), document id = rid.
// findByIssueIid needs no composite index (single equality filter); list() orders by createdAt.

export async function createFirestoreStore({ collection = 'reports' } = {}) {
  const mod = await import('@google-cloud/firestore');
  const Firestore = mod.Firestore ?? mod.default?.Firestore;
  const db = new Firestore({ ignoreUndefinedProperties: true });
  const col = db.collection(collection);

  return {
    kind: 'firestore',
    async get(rid) {
      const snap = await col.doc(rid).get();
      return snap.exists ? snap.data() : null;
    },
    async put(record) {
      await col.doc(record.rid).set(record);
    },
    async update(rid, patch) {
      const ref = col.doc(rid);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const next = { ...snap.data(), ...patch };
        tx.set(ref, next);
        return next;
      });
    },
    async findByIssueIid(iid) {
      const q = await col.where('issueIid', '==', iid).get();
      return q.docs.map((d) => d.data());
    },
    async list({ limit = 100 } = {}) {
      const q = await col.orderBy('createdAt', 'desc').limit(limit).get();
      return q.docs.map((d) => d.data());
    },
  };
}
