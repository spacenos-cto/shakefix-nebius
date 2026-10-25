// ShakeFix Medical Record: LORE-style, deterministic, repo-stored memory (docs/MEMORY.md).
//   recall()     top similar past cases with score + reasons ("Seen before")
//   premortem()  risk level, history of the area, lessons that apply, autonomy recommendation
//   record*()    build / update case files, append lessons, regenerate index.json

export * from './text.js';
export * from './store.js';
export * from './recall.js';
export * from './indexer.js';
export * from './record.js';
