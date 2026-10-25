// Eval-only seeded bugs E5–E10 (see SEEDED_BUGS.md "Eval bugs" and evals/README.md).
//
// They are OFF unless the server runs with EVAL_BUG set, e.g. `EVAL_BUG=E5 node server/index.js`.
// main stays clean: with EVAL_BUG unset every evalBug() call returns false.
//
//   Node (server/index.js, unit tests): reads process.env.EVAL_BUG.
//   Browser: reads <meta name="splitpal-eval-bugs" content="E5,E7">, which the server injects
//            only when EVAL_BUG is set.

export const EVAL_BUGS = Object.freeze(['E5', 'E6', 'E7', 'E8', 'E9', 'E10']);

/** "e5, E7 ,x" -> Set{"E5","E7"} (unknown ids are ignored). */
export function parseEvalBugs(raw) {
  return new Set(
    String(raw ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => EVAL_BUGS.includes(s)),
  );
}

let cached = null;

function readRaw() {
  // globalThis.process: never statically replaced by Vite, undefined in the browser.
  const env = globalThis.process?.env;
  if (env && typeof env.EVAL_BUG === 'string') return env.EVAL_BUG;
  if (typeof document !== 'undefined') {
    return document.querySelector('meta[name="splitpal-eval-bugs"]')?.getAttribute('content') || '';
  }
  return '';
}

export function activeEvalBugs() {
  if (!cached) cached = parseEvalBugs(readRaw());
  return cached;
}

/** True when eval bug `id` is switched on for this process / page. */
export function evalBug(id) {
  return activeEvalBugs().has(id);
}

/** Tests only: forget the cached flag set (after changing process.env.EVAL_BUG). */
export function resetEvalBugsForTests() {
  cached = null;
}
