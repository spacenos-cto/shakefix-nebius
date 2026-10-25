// @shakefix/core: the provider switch that lets ShakeFix run on other platforms by config.
//   SCM_PROVIDER   = gitlab (default) | github
//   MODEL_PROVIDER = anthropic (default) | openai-compatible | none
//   AGENT_RUNNER   = duo (default on GitLab) | local (default on GitHub)
// See docs/PROVIDERS.md.

export * from './scm/index.js';
export * from './model/index.js';
export * from './agent/index.js';
export * from './prompts.js';
// Medical Record (docs/MEMORY.md), namespaced: import { memory } from '@shakefix/core' or '@shakefix/core/memory'.
export * as memory from './memory/index.js';
