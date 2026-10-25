variable "project_id" {
  description = "Google Cloud project ID, for example shakefix-hack."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run, Artifact Registry and Firestore. asia-south1 (Mumbai) or us-central1."
  type        = string
  default     = "asia-south1"
}

variable "firestore_location" {
  description = "Firestore location. Defaults to the region. Multi-region values like nam5 also work."
  type        = string
  default     = ""
}

variable "gitlab_url" {
  description = "GitLab instance URL used as the OIDC issuer."
  type        = string
  default     = "https://gitlab.com"
}

variable "gitlab_project_paths" {
  description = "GitLab project paths allowed to impersonate the CI service account (OIDC claim project_path)."
  type        = list(string)
  default     = ["nxt-spacenos-global/shakefix", "nxt-spacenos-global/shakefix-live"]
}

variable "gitlab_project_id" {
  description = "Numeric GitLab project ID the intake files issues in (GITLAB_PROJECT_ID)."
  type        = string
  default     = ""
}

variable "flow_service_account" {
  description = "Username of the Duo flow service account, without @ (used for re-operation mentions)."
  type        = string
  default     = ""
}

variable "allowed_origins" {
  description = "Comma-separated CORS origins for the intake (the SplitPal URL). Empty until the first apply prints it."
  type        = string
  default     = ""
}

variable "intake_secrets_ready" {
  description = "Set to true after adding a version to every intake secret. Until then the intake runs without secret env vars (Cloud Run refuses to start with a secret that has no version)."
  type        = bool
  default     = false
}

variable "voice_ready" {
  description = "Set to true after adding versions to the elevenlabs-api-key, elevenlabs-webhook-secret and oncall-phone secrets (docs/VOICE.md)."
  type        = bool
  default     = false
}

variable "elevenlabs_confirm_agent_id" {
  description = "ElevenLabs agent that asks the reporter \"is it fixed for you?\" (docs/VOICE.md)."
  type        = string
  default     = ""
}

variable "elevenlabs_oncall_agent_id" {
  description = "ElevenLabs agent that phones the on-call developer after a rollback (docs/VOICE.md)."
  type        = string
  default     = ""
}

variable "elevenlabs_phone_number_id" {
  description = "ElevenLabs id of the Twilio number the agents call from (docs/VOICE.md)."
  type        = string
  default     = ""
}

variable "placeholder_image" {
  description = "Image used until CI deploys the real ones. Terraform ignores later image changes."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "max_instances" {
  description = "Cloud Run max instances per service."
  type        = number
  default     = 2
}

variable "billing_account_id" {
  description = "Billing account ID (XXXXXX-XXXXXX-XXXXXX). Empty disables the budget alert."
  type        = string
  default     = ""
}

variable "budget_amount_usd" {
  description = "Budget alert amount in USD."
  type        = number
  default     = 20
}

variable "vapid_public_key" {
  description = "Web Push VAPID public key (base64url). Empty = poll mode."
  type        = string
  default     = ""
}

variable "vapid_subject" {
  description = "Web Push contact, e.g. mailto:you@example.com"
  type        = string
  default     = "mailto:shakefix@users.noreply.gitlab.com"
}

variable "public_url" {
  description = "Public base URL of the intake service (used in push payloads)."
  type        = string
  default     = ""
}
