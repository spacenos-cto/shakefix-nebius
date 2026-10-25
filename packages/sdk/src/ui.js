// Reporter UI in a shadow root: "Report bug" bubble, iOS permission chip, auto-prompt toast, reporter sheet.
// Dark theme: ink #111, cream #F0ECE5, orange #E85D26.
import { normalizePhone } from './voice.js';

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
button { font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.bubble { position: fixed; right: 14px; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); z-index: 2147483000;
  display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px 9px 11px; border-radius: 999px;
  background: #111; color: #F0ECE5; border: 1px solid #2a2a2a; font-size: 13px; font-weight: 600; letter-spacing: .01em;
  box-shadow: 0 6px 24px rgba(0,0,0,.28); transition: transform .15s ease; }
.bubble:active { transform: scale(.96); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #E85D26; box-shadow: 0 0 0 3px rgba(232,93,38,.25); }
.chip { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(64px + env(safe-area-inset-bottom, 0px));
  z-index: 2147483000; display: inline-flex; align-items: center; gap: 4px; background: #F0ECE5; color: #111;
  border-radius: 999px; padding: 4px 4px 4px 14px; font-size: 13px; font-weight: 600; box-shadow: 0 6px 24px rgba(0,0,0,.2); }
.chip .go { background: none; border: 0; color: #111; padding: 6px 2px; font-weight: 700; }
.chip .x { background: #111; color: #F0ECE5; border: 0; border-radius: 50%; width: 24px; height: 24px; font-size: 14px; line-height: 1; }
.toast { position: fixed; left: 12px; right: 12px; top: calc(12px + env(safe-area-inset-top, 0px)); margin: 0 auto; max-width: 420px;
  z-index: 2147483001; background: #111; color: #F0ECE5; border-left: 4px solid #E85D26; border-radius: 12px;
  padding: 12px 14px; font-size: 14px; box-shadow: 0 10px 30px rgba(0,0,0,.35); text-align: left; width: auto; border-top: 0; border-right: 0; border-bottom: 0; }
.backdrop { position: fixed; inset: 0; z-index: 2147483002; background: rgba(0,0,0,.45); display: flex; align-items: flex-end; justify-content: center; }
.sheet { width: 100%; max-width: 480px; background: #111; color: #F0ECE5; border-radius: 18px 18px 0 0;
  padding: 18px 18px calc(18px + env(safe-area-inset-bottom, 0px)); box-shadow: 0 -10px 40px rgba(0,0,0,.4); animation: up .18s ease-out; }
@media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
@keyframes up { from { transform: translateY(24px); opacity: .6; } to { transform: none; opacity: 1; } }
.grab { width: 36px; height: 4px; border-radius: 4px; background: #333; margin: -6px auto 12px; }
h2 { margin: 0 0 4px; font-size: 18px; font-weight: 700; }
.sub { margin: 0 0 14px; font-size: 13px; color: #a8a39b; }
.row { display: flex; gap: 12px; align-items: flex-start; }
.thumb { width: 64px; height: 96px; border-radius: 8px; background: #1d1d1d center/cover no-repeat; border: 1px solid #2a2a2a; flex: none; }
textarea { flex: 1; min-height: 96px; resize: vertical; background: #1a1a1a; color: #F0ECE5; border: 1px solid #333; border-radius: 10px;
  padding: 10px 12px; font-size: 15px; outline: none; }
textarea:focus { border-color: #E85D26; }
.toggle { display: flex; align-items: center; justify-content: space-between; margin: 14px 0 16px; font-size: 14px; }
.switch { position: relative; width: 44px; height: 26px; border-radius: 999px; background: #333; border: 0; padding: 0; transition: background .15s; }
.switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #F0ECE5; transition: transform .15s; }
.switch[aria-checked="true"] { background: #E85D26; }
.switch[aria-checked="true"]::after { transform: translateX(18px); }
.actions { display: flex; gap: 10px; }
.btn { flex: 1; padding: 13px; border-radius: 12px; border: 0; font-weight: 700; font-size: 15px; }
.primary { background: #E85D26; color: #111; }
.primary[disabled] { opacity: .6; cursor: default; }
.ghost { background: #1d1d1d; color: #F0ECE5; flex: 0 0 auto; padding: 13px 18px; }
.err { color: #ff8a65; font-size: 13px; margin: 0 0 10px; }
.ok { text-align: center; padding: 8px 0 4px; }
.ok .big { font-size: 34px; color: #E85D26; line-height: 1; margin-bottom: 8px; }
.ok a { color: #E85D26; font-weight: 700; text-decoration: none; }
.verdict .q { margin: 2px 0 16px; font-size: 18px; font-weight: 700; }
.verdict .btn { font-size: 16px; }
.yes { background: #E85D26; color: #111; }
.no { background: #1d1d1d; color: #F0ECE5; }
.voice { display: flex; align-items: center; gap: 10px; margin: 12px 0 0; font-size: 13px; color: #a8a39b; }
.mic { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 999px; border: 1px solid #333;
  background: #1a1a1a; color: #F0ECE5; font-size: 14px; font-weight: 600; }
.mic[data-state="recording"] { border-color: #E85D26; color: #E85D26; }
.mic[data-state="recording"]::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #E85D26; animation: blink 1s infinite; }
@keyframes blink { 50% { opacity: .2; } }
.linkbtn { background: none; border: 0; color: #a8a39b; text-decoration: underline; padding: 0; font-size: 13px; }
.phone { width: 100%; margin: -6px 0 8px; background: #1a1a1a; color: #F0ECE5; border: 1px solid #333; border-radius: 10px; padding: 10px 12px; font-size: 15px; outline: none; }
.phone:focus { border-color: #E85D26; }
.fine { margin: 0 0 12px; font-size: 12px; color: #8b867f; }
.hidden { display: none !important; }
.demo { position: fixed; left: 12px; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); z-index: 2147483000; padding: 6px 10px;
  border-radius: 999px; background: #f2b84b; color: #111; font-size: 11px; font-weight: 800; letter-spacing: .08em; }
`;

function el(doc, tag, attrs = {}, children = []) {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) n.appendChild(c);
  return n;
}

/**
 * @param {{doc?: Document, showBubble?: boolean, onBubble: () => void, onChip: () => Promise<boolean>,
 *          onChipDismiss: () => void, onSend: (s: {note: string, notify: boolean}) => Promise<{issueUrl?: string, rid?: string}>,
 *          onClose: () => void}} opts
 */
export function createUI(opts) {
  const doc = opts.doc || document;
  const host = el(doc, 'div', { id: 'shakefix-root', 'data-shakefix': 'ui' });
  const root = host.attachShadow({ mode: 'open' });
  root.appendChild(el(doc, 'style', { text: CSS }));

  const bubble = el(doc, 'button', { class: 'bubble', type: 'button', 'aria-label': 'Report bug', part: 'bubble', onclick: () => opts.onBubble() },
    [el(doc, 'span', { class: 'dot' }), el(doc, 'span', { text: 'Report bug' })]);
  if (opts.showBubble === false) bubble.classList.add('hidden');
  root.appendChild(bubble);

  let chip = null;
  let demoPill = null;
  let toast = null;
  let toastTimer = null;
  let sheet = null;

  function mount() {
    if (!host.isConnected) (doc.body || doc.documentElement).appendChild(host);
  }

  function showChip() {
    if (chip) return;
    chip = el(doc, 'div', { class: 'chip', role: 'group' }, [
      el(doc, 'button', { class: 'go', type: 'button', text: 'Enable shake to report', onclick: async () => { const ok = await opts.onChip(); if (ok) hideChip(); } }),
      el(doc, 'button', { class: 'x', type: 'button', 'aria-label': 'Dismiss', text: '×', onclick: () => { hideChip(); opts.onChipDismiss(); } }),
    ]);
    root.appendChild(chip);
  }
  function hideChip() {
    if (chip) chip.remove();
    chip = null;
  }

  /** DEMO_MODE: the intake replays a recorded run. Say so on screen, always. */
  function setDemo(on = true) {
    if (on && !demoPill) {
      demoPill = el(doc, 'div', { class: 'demo', role: 'note', 'data-shakefix-demo': '1', text: 'DEMO REPLAY' });
      root.appendChild(demoPill);
    } else if (!on && demoPill) {
      demoPill.remove();
      demoPill = null;
    }
  }

  function showToast(text, onTap, ms = 6000) {
    if (toast) toast.remove();
    clearTimeout(toastTimer);
    if (demoPill) text = `DEMO REPLAY · ${text}`;
    toast = el(doc, 'button', { class: 'toast', type: 'button', role: 'status', text, onclick: () => { hideToast(); onTap && onTap(); } });
    root.appendChild(toast);
    toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() {
    if (toast) toast.remove();
    toast = null;
  }

  /**
   * Reporter sheet. Options for the 👎 re-report: `note` pre-fills the textarea, `heading`
   * replaces "Report a bug", `sentHeading` / `sentSub` replace the confirmation text.
   */
  function openSheet({ screenshot, note: prefill = '', heading = 'Report a bug', sentHeading = 'Sent to the ER', sentSub, callMeOption = true } = {}) {
    if (sheet) return;
    hideToast();
    let notify = false;
    const thumb = el(doc, 'div', { class: 'thumb', 'aria-hidden': 'true' });
    const note = el(doc, 'textarea', { placeholder: 'What went wrong? (optional)', maxlength: '500', 'aria-label': 'What went wrong?' });
    if (prefill) note.value = prefill;
    const sw = el(doc, 'button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Notify me when fixed',
      onclick: () => { notify = !notify; sw.setAttribute('aria-checked', String(notify)); } });
    const err = el(doc, 'p', { class: 'err hidden', role: 'alert' });
    const showErr = (text) => { err.textContent = text; err.classList.remove('hidden'); };

    // Voice note: tap to record, tap to stop (max 30 s). Transcribed by the intake.
    let voiceNote = null;
    let recorder = null;
    const micLabel = el(doc, 'span', { text: '🎙️ Say it instead' });
    const mic = el(doc, 'button', { class: 'mic', type: 'button', 'data-state': 'idle', 'aria-label': 'Record a voice note' }, [micLabel]);
    const voiceInfo = el(doc, 'span', { class: 'hidden' });
    const voiceDel = el(doc, 'button', { class: 'linkbtn hidden', type: 'button', text: 'Delete' });
    const voiceRow = el(doc, 'div', { class: 'voice' }, [mic, voiceInfo, voiceDel]);
    if (!opts.voice?.canRecord) voiceRow.classList.add('hidden');
    const secs = (ms) => `0:${String(Math.min(59, Math.round(ms / 1000))).padStart(2, '0')}`;
    async function finishRecording() {
      if (!recorder) return;
      const r = recorder;
      recorder = null;
      const out = await r.stop();
      mic.setAttribute('data-state', 'idle');
      micLabel.textContent = '🎙️ Record again';
      if (out?.blob?.size) {
        voiceNote = out;
        voiceInfo.textContent = `Voice note ✓ ${secs(out.ms)}`;
        voiceInfo.classList.remove('hidden');
        voiceDel.classList.remove('hidden');
      }
    }
    mic.addEventListener('click', async () => {
      if (recorder) return finishRecording();
      err.classList.add('hidden');
      recorder = opts.voice.createRecorder({ onTick: (ms) => { micLabel.textContent = `Stop ${secs(ms)}`; }, onAutoStop: () => finishRecording() });
      try {
        await recorder.start();
        mic.setAttribute('data-state', 'recording');
        micLabel.textContent = `Stop ${secs(0)}`;
      } catch {
        recorder = null;
        showErr('Microphone not available. You can type instead.');
      }
    });
    voiceDel.addEventListener('click', () => {
      voiceNote = null;
      voiceInfo.classList.add('hidden');
      voiceDel.classList.add('hidden');
      micLabel.textContent = '🎙️ Say it instead';
    });

    // "Call me": one phone call after the fix ships, asking if it works. Opt-in, own number only.
    let callMe = false;
    const phone = el(doc, 'input', { class: 'phone hidden', type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '+91 98765 43210', 'aria-label': 'Your phone number' });
    const fine = el(doc, 'p', { class: 'fine hidden', text: "We'll call this number once, after the fix ships, to ask if it works. It is never added to the bug report." });
    const sw2 = el(doc, 'button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': "Call me to check it's fixed",
      onclick: () => {
        callMe = !callMe;
        sw2.setAttribute('aria-checked', String(callMe));
        phone.classList.toggle('hidden', !callMe);
        fine.classList.toggle('hidden', !callMe);
        if (callMe) setTimeout(() => phone.focus(), 30);
      } });
    const callRow = el(doc, 'div', { class: 'toggle' }, [el(doc, 'span', { text: "Call me to check it's fixed" }), sw2]);
    if (!callMeOption || !opts.callMe) { callRow.classList.add('hidden'); }

    const send = el(doc, 'button', { class: 'btn primary', type: 'button', text: 'Send' });
    const cancel = el(doc, 'button', { class: 'btn ghost', type: 'button', text: 'Cancel', onclick: () => { if (recorder) recorder.stop(); closeSheet(); } });
    const body = el(doc, 'div', {}, [
      el(doc, 'h2', { text: heading }),
      el(doc, 'p', { class: 'sub', text: 'We attach your last steps, a screenshot and errors — never what you typed.' }),
      el(doc, 'div', { class: 'row' }, [thumb, note]),
      voiceRow,
      el(doc, 'div', { class: 'toggle' }, [el(doc, 'span', { text: 'Notify me when fixed' }), sw]),
      callRow,
      phone,
      fine,
      err,
      el(doc, 'div', { class: 'actions' }, [cancel, send]),
    ]);
    const panel = el(doc, 'div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': heading }, [el(doc, 'div', { class: 'grab' }), body]);
    sheet = el(doc, 'div', { class: 'backdrop', onclick: (e) => { if (e.target === sheet) closeSheet(); } }, [panel]);
    root.appendChild(sheet);
    bubble.classList.add('hidden');
    if (chip) chip.classList.add('hidden'); // the sheet is taller than the chip's offset
    if (screenshot) screenshot.then((b64) => { if (b64) thumb.style.backgroundImage = `url(data:image/png;base64,${b64})`; });
    setTimeout(() => note.focus(), 50);

    send.addEventListener('click', async () => {
      err.classList.add('hidden');
      let callbackPhone = null;
      if (callMe) {
        callbackPhone = normalizePhone(phone.value);
        if (!callbackPhone) return showErr('Enter your number with the country code, e.g. +91 98765 43210.');
      }
      send.disabled = true;
      send.textContent = 'Sending…';
      try {
        await finishRecording();
        const res = (await opts.onSend({ note: note.value.trim(), notify, voice: voiceNote, phone: callbackPhone })) || {};
        body.replaceChildren(
          el(doc, 'div', { class: 'ok' }, [
            el(doc, 'div', { class: 'big', text: '✓' }),
            el(doc, 'h2', { text: sentHeading }),
            el(doc, 'p', { class: 'sub', text: sentSub || (callbackPhone ? "We'll call you when it's fixed." : notify ? "We'll ping you when it's fixed." : 'Thanks — agents are on it.') }),
            // Reporters follow their own case on the public ER Board; the GitLab issue may be private.
            ...(res.trackUrl
              ? [el(doc, 'p', {}, [el(doc, 'a', { href: res.trackUrl, target: '_blank', rel: 'noopener', text: 'Track your fix →' })])]
              : res.issueUrl ? [el(doc, 'p', {}, [el(doc, 'a', { href: res.issueUrl, target: '_blank', rel: 'noopener', text: issueLabel(res.issueUrl) })])] : []),
          ]),
          el(doc, 'div', { class: 'actions' }, [el(doc, 'button', { class: 'btn primary', type: 'button', text: 'Done', onclick: () => closeSheet() })]),
        );
      } catch (e) {
        err.textContent = "Couldn't send. Check your connection and try again.";
        err.classList.remove('hidden');
        send.disabled = false;
        send.textContent = 'Send';
      }
    });
  }

  /**
   * Small "Fixed ✓ — is it working for you now?" sheet.
   * @param {{question?: string, onYes: () => Promise<void>, onNo: () => void}} o
   */
  function openVerdict({ question = 'Fixed ✓ — is it working for you now?', onYes, onNo }) {
    if (sheet) return false;
    const err = el(doc, 'p', { class: 'err hidden', role: 'alert' });
    const yes = el(doc, 'button', { class: 'btn yes', type: 'button', 'data-verdict': 'yes', text: '👍 Yes, fixed' });
    const no = el(doc, 'button', { class: 'btn no', type: 'button', 'data-verdict': 'no', text: '👎 Still broken' });
    const body = el(doc, 'div', { class: 'verdict' }, [
      el(doc, 'p', { class: 'q', text: question }),
      err,
      el(doc, 'div', { class: 'actions' }, [no, yes]),
    ]);
    const panel = el(doc, 'div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Is it fixed?' }, [el(doc, 'div', { class: 'grab' }), body]);
    sheet = el(doc, 'div', { class: 'backdrop', onclick: (e) => { if (e.target === sheet) closeSheet(); } }, [panel]);
    root.appendChild(sheet);
    bubble.classList.add('hidden');

    yes.addEventListener('click', async () => {
      yes.disabled = true;
      no.disabled = true;
      err.classList.add('hidden');
      try {
        await onYes();
        body.replaceChildren(
          el(doc, 'div', { class: 'ok' }, [
            el(doc, 'div', { class: 'big', text: '✓' }),
            el(doc, 'h2', { text: 'Thanks for confirming' }),
            el(doc, 'p', { class: 'sub', text: 'Glad it works. The case is closed.' }),
          ]),
          el(doc, 'div', { class: 'actions' }, [el(doc, 'button', { class: 'btn primary', type: 'button', text: 'Done', onclick: () => closeSheet() })]),
        );
      } catch {
        err.textContent = "Couldn't send. Check your connection and try again.";
        err.classList.remove('hidden');
        yes.disabled = false;
        no.disabled = false;
      }
    });
    no.addEventListener('click', () => {
      closeSheet();
      onNo();
    });
    return true;
  }

  function closeSheet() {
    if (!sheet) return;
    sheet.remove();
    sheet = null;
    if (opts.showBubble !== false) bubble.classList.remove('hidden');
    if (chip) chip.classList.remove('hidden');
    opts.onClose && opts.onClose();
  }

  return {
    host,
    root,
    mount,
    showChip,
    hideChip,
    showToast,
    hideToast,
    openSheet,
    openVerdict,
    closeSheet,
    setDemo,
    get isDemo() { return !!demoPill; },
    get isOpen() { return !!sheet; },
  };
}

function issueLabel(url) {
  const m = /\/issues\/(\d+)/.exec(url);
  return m ? `View issue #${m[1]} →` : 'View issue →';
}
