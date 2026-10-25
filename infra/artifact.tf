resource "google_artifact_registry_repository" "shakefix" {
  project       = var.project_id
  location      = var.region
  repository_id = "shakefix"
  description   = "ShakeFix container images (splitpal, intake), tagged by commit SHA."
  format        = "DOCKER"
  labels        = local.labels

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 30
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "2592000s" # 30 days
    }
  }

  depends_on = [google_project_service.apis]
}

# Cloud Build source staging bucket. `gcloud builds submit` uploads to gs://<project>_cloudbuild;
# creating it here lets the CI service account use it with bucket-scoped rights only.
resource "google_storage_bucket" "cloudbuild" {
  project                     = var.project_id
  name                        = "${var.project_id}_cloudbuild"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true
  labels                      = local.labels

  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }
}
