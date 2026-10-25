terraform {
  required_version = ">= 1.7"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Remote state (versioned, private bucket) so CI can run `terraform plan` on infra MRs.
  # Bootstrap once: gcloud storage buckets create gs://<project>-tfstate --uniform-bucket-level-access
  #   --public-access-prevention && gcloud storage buckets update gs://<project>-tfstate --versioning
  backend "gcs" {
    bucket = "shakefix-tfstate"
    prefix = "shakefix"
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  apis = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "secretmanager.googleapis.com",
    "firestore.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "logging.googleapis.com",
    "billingbudgets.googleapis.com",
  ]

  labels = {
    app     = "shakefix"
    managed = "terraform"
  }
}

resource "google_project_service" "apis" {
  for_each = toset(local.apis)

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
