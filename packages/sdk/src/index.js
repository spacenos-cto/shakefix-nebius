// shakefix-sdk core: wires shake detection, recorder, console/network capture, screenshot and reporter UI.
import { createShakeController, needsMotionPermission, supportsMotion } from './shake.js';
import { createRecorder, DEFAULT_ALLOWLIST, shouldMask } from './recorder.js';
import { createConsoleCapture, createNetworkCapture } from './capture.js';
import { buildReplay, DEFAULT_EXPECTATIONS } from './replay.js';
import { captureScreenshot } from './screenshot.js';
import {
  DEMO_POLL_MS, subscribePush, askNotificationPermission, createWatcher, endpointBase, showFixedNotification, FIXED_TITLE, FIXED_BODY,
  getDeviceId, hasAnswered, markAnswered, postVerdict, takeVerdictParam, VERDICT_QUESTION, STILL_BROKEN_NOTE, RID_RE,
} from './notify.js';
import { createUI } from './ui.js';
import { blobToBase64, canRecordVoice, createVoiceRecorder } from './voice.js';

export { createShakeDetector, jolt, JOLT_THRESHOLD } from './shake.js';
export { RingBuffer, selectorFor, shouldMask, cssPath, matchesAllowlist, DEFAULT_ALLOWLIST, createRecorder } from './recorder.js';
export { buildReplay, inferExpectation, genRid, DEFAULT_EXPECTATIONS, SCHEMA } from './replay.js';
export { endpointBase, verdictUrl, VERDICT_QUESTION, STILL_BROKEN_NOTE } from './notify.js';

const CHIP_KEY = 'shakefix.chipDismissed';
const AUTO_PROMPT_COOLDOWN_MS = 30_000;
export const SDK_VERSION = typeof __SHAKEFIX_VERSION__ !== 'undefined' ? __SHAKEFIX_VERSION__ : 'dev';

/** Reads config from the SDK's own <script> tag data-attributes. */
export function readScriptConfig(script) {
  if (!script) return {};
  const d = script.dataset || {};
  const cfg = {};
  if (d.endpoint) cfg.endpoint = d.endpoint;
  if (d.app || d.project) cfg.app = d.app || d.project;
  if (d.version) cfg.version = d.version;
  if (d.bubble) cfg.bubble = d.bubble !== 'false';
  if (d.automationUi) cfg.automationUi = d.automationUi === 'true';
  if (d.demo) cfg.demo = d.demo === '1' || d.demo === 'true';
  if (d.voice) cfg.voice = d.voice !== 'false';
  if (d.callMe) cfg.callMe = d.callMe === 'true';
  return cfg;
}

/** Version: data-version, else #app-version / [data-testid=app-version] text ("v1a2b3c4" → "1a2b3c4"). */
export function resolveVersion(cfgVersion, doc = document) {
  if (cfgVersion) return cfgVersion;
  const node = doc.getElementById('app-version') || doc.querySelector('[data-testid="app-version"]');
  const text = node && node.textContent ? node.textContent.trim() : '';
  if (!text) return 'unknown';
  return /^v[0-9a-z][0-9a-z._+-]*$/i.test(text) ? text.slice(1) : text;
}

/**
 * @param {object} config  { endpoint, app, version?, expectations?, allowlist?, bubble?, automationUi? }
 * @param {{win?: Window}} [env]
 */
export function createShakeFix(config, { win = window } = {}) {
  const doc = win.document;
  const cfg = { bubble: true, ...config };
  const base = endpointBase(cfg.endpoint);
  const automated = !!win.navigator.webdriver && !cfg.automationUi;
  const showUi = !automated;
  const routeNow = () => win.location.pathname + win.location.search;
  const userCfg = () => win.ShakeFixConfig || {};
  const allowlist = () => userCfg().allowlist || cfg.allowlist || DEFAULT_ALLOWLIST;

  let ui = null;
  let lastAutoPrompt = 0;
  let pending = null;
  let landingVerdict = null; // {verdict, rid} from ?shakefix_verdict=… (notification tap)
  // DEMO_MODE: data-demo="1", <meta name="shakefix-demo" content="1">, or an intake answer with demo:true.
  let demoMode = !!cfg.demo || doc.querySelector?.('meta[name="shakefix-demo"]')?.getAttribute('content') === '1';

  const isOwnEvent = (e) => {
    if (!ui) return false;
    const path = e.composedPath ? e.composedPath() : [];
    return path.includes(ui.host) || e.target === ui.host;
  };

  const recorder = createRecorder({
    capacity: 30,
    get allowlist() { return allowlist(); },
    getRoute: routeNow,
    isIgnored: isOwnEvent,
    onRageClick: () => autoPrompt('rage-click'),
    storage: (() => { try { return win.sessionStorage; } catch { return null; } })(),
  });
  const consoleCap = createConsoleCapture({ win, onUncaught: () => autoPrompt('auto-error') });
  const networkCap = createNetworkCapture({ win, isIgnored: (url) => !!base && String(url).startsWith(base) });
  const shake = createShakeController({ win, onShake: () => open('shake') });
  const watcher = createWatcher({
    win,
    endpoint: cfg.endpoint,
    pollMs: demoMode ? DEMO_POLL_MS : undefined,
    onDemo: () => markDemo(),
    onFixed: async (rid) => {
      await showFixedNotification(win, rid, { endpoint: cfg.endpoint, url: routeNow(), deviceId: getDeviceId(win) });
      ensureUi();
      ui.showToast(`${FIXED_TITLE} — ${FIXED_BODY}`, null, 10_000);
      askVerdict(rid, { auto: true });
    },
  });

  function markDemo() {
    demoMode = true;
    watcher.setPollMs(DEMO_POLL_MS);
    if (showUi) ensureUi().setDemo(true);
  }

  function ensureUi() {
    if (ui) return ui;
    ui = createUI({
      doc,
      showBubble: showUi && cfg.bubble !== false && userCfg().bubble !== false,
      onBubble: () => open('bubble'),
      onChip: () => enableShake(),
      onChipDismiss: () => { try { win.localStorage.setItem(CHIP_KEY, '1'); } catch { /* ignore */ } },
      onSend: send,
      onClose: () => { pending = null; },
      // Voice note (data-voice="false" turns it off) and the opt-in "call me" (data-call-me="true").
      voice: { canRecord: cfg.voice !== false && canRecordVoice(win), createRecorder: (cbs) => createVoiceRecorder({ win, ...cbs }) },
      callMe: cfg.callMe === true,
    });
    ui.mount();
    if (demoMode) ui.setDemo(true);
    return ui;
  }

  function autoPrompt(trigger) {
    const t = Date.now();
    if (!showUi || (ui && ui.isOpen) || t - lastAutoPrompt < AUTO_PROMPT_COOLDOWN_MS) return;
    lastAutoPrompt = t;
    ensureUi().showToast('Looks like something broke. Tap to tell us.', () => open(trigger));
  }

  /** Snapshot everything at the moment of the report (before the sheet steals focus). */
  function snapshot(trigger) {
    return {
      trigger,
      rawActions: recorder.actions(),
      console: consoleCap.entries(),
      network: networkCap.entries(),
      currentRoute: routeNow(),
      screenshot: captureScreenshot({
        win,
        ignore: (el) => !!ui && el === ui.host,
        isMasked: (el) => shouldMask(el, allowlist()),
      }),
    };
  }

  function makeReplay(snap, note = '') {
    return buildReplay({
      app: { name: cfg.app || 'app', version: resolveVersion(cfg.version, doc), baseUrl: win.location.origin },
      device: {
        ua: win.navigator.userAgent,
        viewport: [win.innerWidth, win.innerHeight],
        touch: (win.navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in win,
      },
      trigger: snap.trigger,
      note,
      rawActions: snap.rawActions,
      currentRoute: snap.currentRoute,
      expectations: { ...(cfg.expectations || {}), ...(userCfg().expectations || {}) },
      console: snap.console,
      network: snap.network,
    });
  }

  function open(trigger = 'bubble') {
    ensureUi();
    if (ui.isOpen) return;
    pending = snapshot(trigger);
    ui.openSheet({ screenshot: pending.screenshot });
  }

  async function send({ note, notify, voice = null, phone = null }) {
    const snap = pending || snapshot('bubble');
    // Permission prompts must happen inside the Send tap (user gesture), before any await on the network.
    const pushP = notify ? subscribePush({ win, endpoint: cfg.endpoint }) : Promise.resolve(null);
    if (notify && !win.PushManager) askNotificationPermission(win);
    const [screenshotPng, pushSubscription] = await Promise.all([snap.screenshot, pushP]);
    const replay = makeReplay(snap, note);
    if (!cfg.endpoint) throw new Error('ShakeFix: data-endpoint is not configured');
    const deviceId = getDeviceId(win);

    // 👎 re-report: the fresh replay goes to the verdict endpoint of the original report.
    if (snap.verdictRid) {
      const rid = snap.verdictRid;
      await postVerdict({ win, endpoint: cfg.endpoint, rid, verdict: 'rejected', replay, deviceId, pushSubscription });
      markAnswered(win, rid);
      if (notify && !pushSubscription) watcher.watch(rid);
      return { rid };
    }

    const voiceNote = voice?.blob?.size ? { audio: await blobToBase64(voice.blob), mime: voice.mime } : null;
    const res = await win.fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        replay, screenshotPng, pushSubscription, ...(deviceId ? { deviceId } : {}),
        ...(voiceNote ? { voiceNote } : {}),
        ...(phone ? { callback: { phone, consent: true } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`ShakeFix: intake returned ${res.status}`);
    let body = {};
    try { body = await res.json(); } catch { /* empty body */ }
    const rid = body.rid || replay.rid;
    recorder.clear(); // the next report starts from here, not from steps already sent
    if (body.demo) markDemo();
    if (notify && !pushSubscription) watcher.watch(rid);
    return { rid, issueUrl: body.issueUrl, trackUrl: body.trackUrl, demo: !!body.demo };
  }

  /**
   * "Fixed ✓ — is it working for you now?" 👍 posts {verdict:"confirmed"}; 👎 opens the
   * reporter pre-filled with "Still broken after fix" and posts {verdict:"rejected", replay}.
   * `auto` (notification/poll/landing) respects automation and already-answered rids;
   * an explicit call (window.ShakeFix.askVerdict) always shows the sheet, like open().
   */
  function askVerdict(rid, { auto = false } = {}) {
    if (!rid || !RID_RE.test(String(rid))) return false;
    if (auto && (!showUi || hasAnswered(win, rid))) return false;
    ensureUi();
    if (ui.isOpen) return false;
    return ui.openVerdict({
      question: VERDICT_QUESTION,
      onYes: async () => {
        await postVerdict({ win, endpoint: cfg.endpoint, rid, verdict: 'confirmed', deviceId: getDeviceId(win) });
        markAnswered(win, rid);
      },
      onNo: () => reReport(rid),
    });
  }

  /** 👎: the normal reporter flow, pre-filled, sent as a rejection of `rid`'s fix. */
  function reReport(rid) {
    ensureUi();
    if (ui.isOpen) return false;
    pending = { ...snapshot('bubble'), verdictRid: rid };
    ui.openSheet({
      screenshot: pending.screenshot,
      note: STILL_BROKEN_NOTE,
      heading: 'Still broken?',
      sentHeading: 'Back to the ER',
      sentSub: 'We reopened your case with this new replay. Thanks for telling us.',
      callMeOption: false,
    });
    return true;
  }

  function handleLanding() {
    const l = landingVerdict;
    landingVerdict = null;
    if (!l || !showUi) return;
    if (l.verdict === 'no') reReport(l.rid);
    else if (l.verdict === 'ask') askVerdict(l.rid, { auto: true });
    else if (l.verdict === 'yes' && !hasAnswered(win, l.rid)) {
      // SW fallback when it could not post the 👍 itself.
      postVerdict({ win, endpoint: cfg.endpoint, rid: l.rid, verdict: 'confirmed', deviceId: getDeviceId(win) })
        .then(() => markAnswered(win, l.rid))
        .catch(() => { /* offline; the reporter can still answer later */ });
    }
  }

  async function enableShake() {
    const ok = await shake.enableShake();
    if (ok && ui) ui.hideChip();
    return ok;
  }

  function start() {
    // Read (and strip) ?shakefix_verdict before the recorder starts, so the cleanup isn't recorded.
    landingVerdict = takeVerdictParam(win);
    recorder.start(win, doc);
    consoleCap.start();
    networkCap.start();
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'B' || e.key === 'b' || e.code === 'KeyB')) {
        e.preventDefault();
        open('hotkey');
      }
    };
    win.addEventListener('keydown', onKey, true);
    // A page that frames the app (the "Try ShakeFix" demo) can simulate the shake with
    // postMessage({type: 'shakefix:shake'}). It only opens the reporter; sending still needs a tap.
    win.addEventListener('message', (e) => {
      if (e.source === win.parent && e.source !== win && e.data && e.data.type === 'shakefix:shake') open('shake');
    });
    const boot = () => {
      if (showUi) ensureUi();
      if (supportsMotion(win)) {
        if (needsMotionPermission(win)) {
          let dismissed = false;
          try { dismissed = win.localStorage.getItem(CHIP_KEY) === '1'; } catch { /* ignore */ }
          if (showUi && !dismissed) ensureUi().showChip();
        } else {
          shake.enableShake();
        }
      }
      watcher.start();
      handleLanding();
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }

  return {
    version: SDK_VERSION,
    config: cfg,
    get demo() { return demoMode; },
    start,
    open,
    enableShake,
    askVerdict: (rid) => askVerdict(rid),
    /** Current replay.json (what would be sent now). */
    getReplay: (note = '') => {
      const s = { trigger: 'bubble', rawActions: recorder.actions(), console: consoleCap.entries(), network: networkCap.entries(), currentRoute: routeNow() };
      return makeReplay(s, note);
    },
    _internals: { recorder, consoleCap, networkCap, shake, watcher },
  };
}
