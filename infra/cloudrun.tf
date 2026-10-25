# Both services start from a placeholder image. CI owns the image, env and traffic after that,
# so Terraform ignores those fields (see lifecycle blocks).

resource "google_cloud_run_v2_service" "splitpal" {
  # Public without an allUsers IAM binding: works under domain-restricted-sharing org policies.
  invoker_iam_disabled = true
  project              = var.project_id
  name                 = "splitpal"
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  deletion_protection  = false
  labels               = local.labels

  template {
    service_account = google_service_account.splitpal.email

    # One instance: SplitPal keeps demo data in memory, so a test reset and the replay that
    # follows must hit the same instance (two instances made Second Opinion diffs flaky).
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      image = var.placeholder_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      env {
        name  = "SHAKEFIX_TEST_HOOKS"
        value = "0"
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].containers[0].env,
      template[0].revision,
      template[0].labels,
      template[0].annotations,
      traffic,
      client,
      client_version,
    ]
  }

  depends_on = [google_project_service.apis]
}

# CareRx: the demo app ShakeFix fixes (prescription refills). SplitPal above is kept for the evals.
resource "google_cloud_run_v2_service" "carerx" {
  # Public without an allUsers IAM binding: works under domain-restricted-sharing org policies.
  invoker_iam_disabled = true
  project              = var.project_id
  name                 = "carerx"
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  deletion_protection  = false
  labels               = local.labels

  template {
    service_account = google_service_account.splitpal.email

    # One instance: CareRx keeps demo data in memory, so a test reset and the replay that
    # follows must hit the same instance (two instances made Second Opinion diffs flaky).
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      image = var.placeholder_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      env {
        name  = "SHAKEFIX_TEST_HOOKS"
        value = "0"
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].containers[0].env,
      template[0].revision,
      template[0].labels,
      template[0].annotations,
      traffic,
      client,
      client_version,
    ]
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service" "intake" {
  # Public without an allUsers IAM binding: works under domain-restricted-sharing org policies.
  invoker_iam_disabled = true
  project              = var.project_id
  name                 = "intake"
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  deletion_protection  = false
  labels               = local.labels

  template {
    service_account = google_service_account.intake.email

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    containers {
      image = var.placeholder_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      env {
        name  = "GITLAB_URL"
        value = var.gitlab_url
      }
      env {
        name  = "GITLAB_PROJECT_ID"
        value = var.gitlab_project_id
      }
      env {
        name  = "FLOW_SERVICE_ACCOUNT"
        value = var.flow_service_account
      }
      env {
        name  = "STORE"
        value = "firestore"
      }
      env {
        name  = "FIRESTORE_COLLECTION"
        value = "reports"
      }
      env {
        name  = "ALLOWED_ORIGINS"
        value = var.allowed_origins
      }
      env {
        name  = "PUSH_MODE"
        value = var.vapid_public_key == "" ? "poll" : "webpush"
      }
      env {
        name  = "VAPID_PUBLIC_KEY"
        value = var.vapid_public_key
      }
      env {
        name  = "VAPID_SUBJECT"
        value = var.vapid_subject
      }
      env {
        name  = "PUBLIC_URL"
        value = var.public_url
      }

      dynamic "env" {
        for_each = var.intake_secrets_ready ? local.intake_secrets : {}
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.intake[env.key].secret_id
              version = "latest"
            }
          }
        }
      }

      # Voice (docs/VOICE.md): ids are not secret; keys and the on-call number are.
      dynamic "env" {
        for_each = var.voice_ready ? {
          ELEVENLABS_CONFIRM_AGENT_ID = var.elevenlabs_confirm_agent_id
          ELEVENLABS_ONCALL_AGENT_ID  = var.elevenlabs_oncall_agent_id
          ELEVENLABS_PHONE_NUMBER_ID  = var.elevenlabs_phone_number_id
        } : {}
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.voice_ready ? local.voice_secrets : {}
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.voice[env.key].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].revision,
      template[0].labels,
      template[0].annotations,
      traffic,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.intake_access,
    google_secret_manager_secret_iam_member.voice_access,
  ]
}

# Public demo: anyone can invoke both services.

