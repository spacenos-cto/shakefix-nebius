# --- CI service account (impersonated by GitLab CI through Workload Identity Federation)
resource "google_service_account" "ci" {
  project      = var.project_id
  account_id   = "shakefix-ci"
  display_name = "ShakeFix GitLab CI"
  description  = "Deploys SplitPal and the intake from GitLab CI via WIF. No keys."
}

locals {
  ci_project_roles = [
    "roles/run.admin",
    "roles/iam.serviceAccountUser",
    "roles/artifactregistry.writer",
    "roles/cloudbuild.builds.editor",
    "roles/logging.logWriter", # builds run as this SA (CLOUD_LOGGING_ONLY)
    "roles/logging.viewer",    # gcloud streams build logs from Cloud Logging
    "roles/serviceusage.serviceUsageConsumer",
  ]
}

resource "google_project_iam_member" "ci" {
  for_each = toset(local.ci_project_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.ci.email}"
}

resource "google_storage_bucket_iam_member" "ci_cloudbuild_bucket" {
  bucket = google_storage_bucket.cloudbuild.name
  role   = "roles/storage.admin"
  member = "serviceAccount:${google_service_account.ci.email}"
}

# --- Runtime service accounts (least privilege)
resource "google_service_account" "splitpal" {
  project      = var.project_id
  account_id   = "splitpal-run"
  display_name = "SplitPal Cloud Run runtime"
}

resource "google_service_account" "intake" {
  project      = var.project_id
  account_id   = "shakefix-intake-run"
  display_name = "ShakeFix intake Cloud Run runtime"
}

resource "google_project_iam_member" "intake_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.intake.email}"
}

resource "google_project_iam_member" "splitpal_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.splitpal.email}"
}

# --- Planner: read-only identity for `terraform plan` on infra MRs ("Plan, explained").
# It can read the project and the state, never change it. Applies stay with humans.
resource "google_service_account" "planner" {
  project      = var.project_id
  account_id   = "shakefix-plan"
  display_name = "ShakeFix Terraform planner (read-only)"
  description  = "terraform plan in GitLab CI for infra MRs. Read-only."
}

locals {
  planner_project_roles = [
    "roles/viewer",
    "roles/iam.securityReviewer",          # read IAM policies in the plan
    "roles/iam.workloadIdentityPoolViewer", # read the WIF pool/provider
  ]
}

resource "google_project_iam_member" "planner" {
  for_each = toset(local.planner_project_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.planner.email}"
}

resource "google_storage_bucket_iam_member" "planner_state" {
  bucket = "shakefix-tfstate"
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.planner.email}"
}

resource "google_service_account_iam_member" "planner_wif" {
  for_each = toset(var.gitlab_project_paths)

  service_account_id = google_service_account.planner.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.gitlab.name}/attribute.project_path/${each.value}"
}
