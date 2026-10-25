import { buildApp } from './app.js';
import { loadConfig, publicConfig } from './config.js';
import { createPusher } from './push.js';
import { createScm, requiredScmKeys } from './scm.js';
import { createStore } from './store/index.js';

const config = loadConfig();
const store = await createStore(config);
// SCM_PROVIDER=gitlab (default): the GitLab client with GITLAB_URL / GITLAB_PROJECT_ID / GITLAB_HUMAN_PAT.
const gitlab = await createScm(config);

let app;
// Logger is resolved lazily so the pusher can log through the Fastify (pino) logger.
const lazyLog = { warn: (...a) => app?.log.warn(...a) };
const pusher = await createPusher(config, lazyLog);

app = buildApp({ config, gitlab, store, pusher, logger: true });

const missing = [...requiredScmKeys(config), 'webhookSecret', 'hookSecret', 'flowServiceAccount'].filter((k) => !config[k]);
if (config.demoMode) app.log.warn({ speed: config.demoSpeed }, 'DEMO_MODE=1: replaying the recorded hero run; no GitLab calls');
else if (missing.length) app.log.warn({ missing }, 'intake config incomplete');
app.log.info({ config: publicConfig(config) }, 'intake starting');

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    app.close().finally(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
