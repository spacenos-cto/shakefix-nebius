import { createMemoryStore } from './memory.js';

export { createMemoryStore };

export async function createStore(config) {
  if (config.store === 'firestore') {
    const { createFirestoreStore } = await import('./firestore.js');
    return createFirestoreStore({ collection: config.firestoreCollection });
  }
  return createMemoryStore();
}
