# Voice: the person who hit the bug, in their own words

Three voice features, each off until its keys are set.

| Feature | What happens | Lifecycle stages | Code |
|---|---|---|---|
| **Voice note** | After the shake, the reporter taps **🎙️ Say it instead** and says what went wrong (max 30 s). ElevenLabs Scribe transcribes it, and the issue gets an **"In their words"** section. | plan | `packages/sdk/src/voice.js`, `services/intake/src/voice.js` |
| **"Is it fixed for you?" call** | Reporters who opt in (**Call me to check it's fixed**) get one phone call per fix round after the deploy. A spoken *yes* verifies the case; a spoken *no* reopens it and sends it back to the agents. | release, monitor | `/v1/reports/:rid/fixed`, `/v1/hooks/elevenlabs` |
| **On-call call** | After an automatic rollback, the on-call developer is phoned: "send it back to the agents, or hold?". *Retry* re-triggers the flow on each reopened issue; *hold* leaves it for a human. **Rollback itself is never gated on the call.** | monitor, release, govern | `scripts/ci/rollback.sh`, `/v1/oncall/call` |

Every call ends with a **📞 call note** on the GitLab issue (decision, duration, ElevenLabs summary, conversation id): the audit trail for what was decided by voice. An unclear answer never counts as a yes.

## Privacy

1. **Phone numbers stay in the intake's store.** They never go into an issue, a note, the ER Board, a certificate or a log line.
2. **Calls are opt-in.** The reporter types their own number and turns the switch on. The on-call number is a secret.
3. **Audio is not kept by default.** Only the transcript goes into the issue. `VOICE_KEEP_AUDIO=1` also attaches the audio file. The repository is public, so leave it off.
4. **Transcripts are data, not instructions.** The issue section tells agents to treat the reporter's words as intent only.

## Setup

### 1. ElevenLabs agents (dashboard → Agents)

Create two agents. Both use the variables below in their prompt; ShakeFix passes them on each call.

**Agent "ShakeFix confirm"**
- First message: `Hi, this is ShakeFix, calling about the problem you reported in {{app_name}}: {{issue_title}}. We've shipped a fix. Could you open the app and check whether it works for you now?`
- System prompt: `You are a short, friendly follow-up call. Ask once whether the problem is fixed. Wait while the person checks. If they are unsure, ask them to try once more. Never ask for personal information. Never promise anything beyond "the team will look again". End the call politely once you have an answer.`
- **Data collection** field `fixed` (string): `"yes" if the person said the problem is fixed, "no" if it is still broken, "unsure" otherwise.`

**Agent "ShakeFix on-call"**
- First message: `Hi, this is ShakeFix. Production was rolled back: {{reason}} on version {{version}}. Traffic is back on {{prev_revision}}. The case is: {{issue_title}}. Should I send it back to the agents for another try, or hold until you look?`
- System prompt: `You are calling an on-call developer. Be brief. Get one decision: retry or hold. Do not take any other action.`
- **Data collection** field `decision` (string): `"retry" if the developer approved another automated attempt, "hold" if they want to look first, "unsure" otherwise.`

### 2. Phone number

Dashboard → Phone numbers → import your **Twilio** number (Account SID, Auth Token). Assign both agents. Copy the **phone number id**.

### 3. Post-call webhook

Dashboard → Settings → Webhooks → **post-call transcription** → `https://<intake>/v1/hooks/elevenlabs`. Copy the **webhook secret**. The intake checks the `ElevenLabs-Signature` header (HMAC-SHA256 of `t.body`, 30-minute window, the same as the official SDK).

### 4. Intake configuration

| Variable | Secret? | For |
|---|---|---|
| `ELEVENLABS_API_KEY` | yes | all three |
| `ELEVENLABS_STT_MODEL` | no (default `scribe_v2`) | voice note |
| `ELEVENLABS_CONFIRM_AGENT_ID` | no | reporter call |
| `ELEVENLABS_ONCALL_AGENT_ID` | no | on-call call |
| `ELEVENLABS_PHONE_NUMBER_ID` | no | both calls |
| `ELEVENLABS_WEBHOOK_SECRET` | yes | both calls |
| `ONCALL_PHONE` | yes (personal number, E.164) | on-call call |
| `VOICE_KEEP_AUDIO` | no (default off) | voice note |

Terraform: add secret versions for `elevenlabs-api-key`, `elevenlabs-webhook-secret` and `oncall-phone` (see `infra/secrets.tf`), set the three agent/number ids in `terraform.tfvars`, then `voice_ready = true`. `/v1/health` shows which voice features are on (`voice.transcribe`, `voice.confirmCall`, `voice.oncallCall`).

### 5. The app

The CareRx script tag has `data-call-me="true"`. The mic button appears wherever the browser supports recording (HTTPS only); `data-voice="false"` hides it.

## Costs

Speech-to-text, agent call minutes (ElevenLabs) and call minutes plus the number (Twilio) are paid. Check current prices before turning calls on. A demo is a handful of calls of under a minute each.
