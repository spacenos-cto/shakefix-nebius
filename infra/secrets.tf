# Secrets are created EMPTY. Add values out of band (never in Terraform state):
#   printf '%s' "$VALUE" | gcloud secrets versions add <secret-id> --data-file=-
# Then set intake_secrets_ready = true and apply again.
locals {
  intake_secrets = {
    "gitlab-human-pat"      = "GITLAB_HUMAN_PAT"
    "gitlab-webhook-secret" = "GITLAB_WEBHOOK_SECRET"
    "intake-hook-secret"    = "INTAKE_HOOK_SECRET"
    "vapid-private"         = "VAPID_PRIVATE_KEY"
  }
}

resource "google_secret_manager_secret" "intake" {
  for_each = local.intake_secrets

  project   = var.project_id
  secret_id = each.key
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

# Voice (docs/VOICE.md). Same rule: created empty, values added out of band, then voice_ready = true.
# ONCALL_PHONE is a personal number, so it is a secret too (the repo is public).
locals {
  voice_secrets = {
    "elevenlabs-api-key"        = "ELEVENLABS_API_KEY"
    "elevenlabs-webhook-secret" = "ELEVENLABS_WEBHOOK_SECRET"
    "oncall-phone"              = "ONCALL_PHONE"
  }
}

resource "google_secret_manager_secret" "voice" {
  for_each = local.voice_secrets

  project   = var.project_id
  secret_id = each.key
  labels    = local.labels

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "voice_access" {
  for_each = google_secret_manager_secret.voice

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.intake.email}"
}

resource "google_secret_manager_secret_iam_member" "intake_access" {
  for_each = google_secret_manager_secret.intake

  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.intake.email}"
}
