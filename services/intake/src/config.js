// All configuration comes from the environment. Never log the returned object as-is:
// it contains secrets. Use `publicConfig()` for anything that goes to logs or /healthz.

import { voiceFeatures } from './voice.js';

const list = (v) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const int = (v, d) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

export const DEFAULT_INPUT_ALLOWLIST = 'total-input,tip-select,currency-select,title-input,person-input-*';

export function loadConfig(env = process.env) {
  return Object.freeze({
    port: int(env.PORT, 8080),
    host: env.HOST || '0.0.0.0',
    // SCM provider switch (docs/PROVIDERS.md). Default gitlab: GITLAB_* below, unchanged.
    scmProvider: String(env.SCM_PROVIDER || 'gitlab').toLowerCase() === 'github' ? 'github' : 'gitlab',
    githubRepo: env.GITHUB_REPO || env.GITHUB_REPOSITORY || '',
    githubToken: env.GITHUB_TOKEN || env.GH_TOKEN || '',
    githubApiUrl: (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
    scmLabelMap: env.SCM_LABEL_MAP || '',
    gitlabUrl: (env.GITLAB_URL || 'https://gitlab.com').replace(/\/+$/, ''),
    projectId: env.GITLAB_PROJECT_ID || '',
    // Optional web URL of the GitLab project (issue/MR links on Discharge Certificates).
    // Default: derived from the issue URL, or GITLAB_URL/<GITLAB_PROJECT_ID> when that is a path.
    gitlabProjectWebUrl: String(env.GITLAB_PROJECT_WEB_URL || '').replace(/\/+$/, ''),
    humanPat: env.GITLAB_HUMAN_PAT || '',
    webhookSecret: env.GITLAB_WEBHOOK_SECRET || '',
    hookSecret: env.INTAKE_HOOK_SECRET || '',
    // HMAC key for Discharge Certificates (src/certificate.js). Unset: certificates are issued unsigned.
    certSigningKey: env.CERT_SIGNING_KEY || '',
    flowServiceAccount: String(env.FLOW_SERVICE_ACCOUNT || '').replace(/^@+/, ''),
    startMode: env.START_MODE === 'api' ? 'api' : 'trigger',
    flowDefinition: env.FLOW_DEFINITION || '',
    reportsRef: env.REPORTS_REF || '',
    // Public base URL of this service (for verdict links in push payloads). Default: from the request.
    publicUrl: String(env.PUBLIC_URL || '').replace(/\/+$/, ''),
    store: env.STORE === 'firestore' ? 'firestore' : 'memory',
    firestoreCollection: env.FIRESTORE_COLLECTION || 'reports',
    pushMode: env.PUSH_MODE === 'webpush' ? 'webpush' : 'poll',
    vapidPublicKey: env.VAPID_PUBLIC_KEY || '',
    vapidPrivateKey: env.VAPID_PRIVATE_KEY || '',
    vapidSubject: env.VAPID_SUBJECT || '',
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    // Infra triage (src/infra.js): who is on call, and where pages go (ntfy, Slack, Discord, any JSON URL).
    maintainer: String(env.SHAKEFIX_MAINTAINER || '').replace(/^@+/, ''),
    pagerWebhookUrl: env.PAGER_WEBHOOK_URL || '',
    // Public ER Board (e.g. GitLab Pages). Reporters get a "Track your fix" link to their own case there.
    boardUrl: String(env.BOARD_URL || '').replace(/\/+$/, ''),
    infraCheck: env.INFRA_CHECK !== 'off',
    inputAllowlist: list(env.INPUT_ALLOWLIST ?? DEFAULT_INPUT_ALLOWLIST),
    maxBodyBytes: int(env.MAX_BODY_BYTES, 2 * 1024 * 1024),
    rateIpPerMin: int(env.RATE_IP_PER_MIN, 5),
    // Public read-only certificate endpoints (the judges page reads 4 certificates and verifies each).
    rateReadIpPerMin: int(env.RATE_READ_IP_PER_MIN, 60),
    rateAppPerDay: int(env.RATE_APP_PER_DAY, 50),
    maxReoperations: int(env.MAX_REOPERATIONS, 1),
    // Medical Record (docs/MEMORY.md): a reporter rejection appends a lesson on the default branch.
    memoryLessons: env.MEMORY_LESSONS !== '0',
    logLevel: env.LOG_LEVEL || 'info',
    // Extra bot usernames for the human-touch counter (the flow service account is always a bot).
    botUsernames: list(env.BOT_USERNAMES),
    // Voice (src/voice.js, docs/VOICE.md). Each feature stays off until its keys are set.
    elevenApiKey: env.ELEVENLABS_API_KEY || '',
    elevenSttModel: env.ELEVENLABS_STT_MODEL || 'scribe_v2',
    elevenConfirmAgentId: env.ELEVENLABS_CONFIRM_AGENT_ID || '',
    elevenOncallAgentId: env.ELEVENLABS_ONCALL_AGENT_ID || '',
    elevenPhoneNumberId: env.ELEVENLABS_PHONE_NUMBER_ID || '',
    elevenWebhookSecret: env.ELEVENLABS_WEBHOOK_SECRET || '',
    oncallPhone: env.ONCALL_PHONE || '',
    // Attach the reporter's audio to the issue (default off: the transcript is enough, and the repo is public).
    voiceKeepAudio: env.VOICE_KEEP_AUDIO === '1',
    // DEMO_MODE=1: replay the recorded hero run (src/demo.js); no GitLab calls. DEMO_SPEED=10 runs it 10x faster.
    demoMode: env.DEMO_MODE === '1' || env.DEMO_MODE === 'true',
    demoSpeed: Number(env.DEMO_SPEED) > 0 ? Number(env.DEMO_SPEED) : 1,
  });
}

/** Non-secret view of the config, safe for logs and health output. */
export function publicConfig(c) {
  return {
    gitlabUrl: c.gitlabUrl,
    projectId: c.projectId,
    startMode: c.startMode,
    store: c.store,
    pushMode: c.pushMode,
    reportsRef: c.reportsRef || '(default branch)',
    allowedOrigins: c.allowedOrigins,
    hasHumanPat: Boolean(c.humanPat),
    hasWebhookSecret: Boolean(c.webhookSecret),
    hasHookSecret: Boolean(c.hookSecret),
    hasCertSigningKey: Boolean(c.certSigningKey),
    hasFlowServiceAccount: Boolean(c.flowServiceAccount),
    hasPager: Boolean(c.pagerWebhookUrl),
    infraCheck: c.infraCheck,
    voice: voiceFeatures(c),
    demoMode: Boolean(c.demoMode),
  };
}
