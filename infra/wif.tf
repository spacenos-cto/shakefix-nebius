# Workload Identity Federation: GitLab CI id_tokens -> short-lived Google credentials.
# The CI job requests an ID token with aud = "https://iam.googleapis.com/<provider name>",
# which is the default allowed audience when allowed_audiences is not set.
resource "google_iam_workload_identity_pool" "gitlab" {
  project                   = var.project_id
  workload_identity_pool_id = "gitlab"
  display_name              = "GitLab"
  description               = "OIDC tokens from GitLab CI/CD for ShakeFix."

  depends_on = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "gitlab" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.gitlab.workload_identity_pool_id
  workload_identity_pool_provider_id = "gitlab"
  display_name                       = "gitlab.com"

  attribute_mapping = {
    "google.subject"           = "assertion.sub"
    "attribute.project_path"   = "assertion.project_path"
    "attribute.ref"            = "assertion.ref"
    "attribute.ref_type"       = "assertion.ref_type"
    "attribute.ref_protected"  = "assertion.ref_protected"
    "attribute.namespace_path" = "assertion.namespace_path"
  }

  # Only the listed GitLab projects can exchange tokens at all.
  attribute_condition = "assertion.project_path in ${jsonencode(var.gitlab_project_paths)}"

  oidc {
    issuer_uri = var.gitlab_url
  }
}

resource "google_service_account_iam_member" "ci_wif" {
  for_each = toset(var.gitlab_project_paths)

  service_account_id = google_service_account.ci.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.gitlab.name}/attribute.project_path/${each.value}"
}
