output "splitpal_url" {
  description = "SplitPal production URL (Cloud Run). Use as PROD_URL and in ALLOWED_ORIGINS."
  value       = google_cloud_run_v2_service.splitpal.uri
}

output "intake_url" {
  description = "Intake URL. Set as the INTAKE_URL CI/CD variable and the SDK data-endpoint base."
  value       = google_cloud_run_v2_service.intake.uri
}

output "gcp_wif_provider" {
  description = "Full provider resource name. Set as the GCP_WIF_PROVIDER CI/CD variable."
  value       = google_iam_workload_identity_pool_provider.gitlab.name
}

output "gcp_sa_email" {
  description = "CI service account. Set as the GCP_SA_EMAIL CI/CD variable."
  value       = google_service_account.ci.email
}

output "artifact_registry" {
  description = "Docker repository prefix for images."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.shakefix.repository_id}"
}

output "intake_secret_ids" {
  description = "Secrets to fill with `gcloud secrets versions add` before setting intake_secrets_ready = true."
  value       = [for s in google_secret_manager_secret.intake : s.secret_id]
}

output "planner_sa_email" {
  description = "Read-only planner service account (CI variable GCP_PLAN_SA_EMAIL)."
  value       = google_service_account.planner.email
}

output "carerx_url" {
  description = "CareRx (demo app) production URL. Use as PROD_URL and in ALLOWED_ORIGINS."
  value       = google_cloud_run_v2_service.carerx.uri
}
