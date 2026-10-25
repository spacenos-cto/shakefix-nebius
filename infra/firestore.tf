resource "google_firestore_database" "default" {
  project                 = var.project_id
  name                    = "(default)"
  location_id             = var.firestore_location != "" ? var.firestore_location : var.region
  type                    = "FIRESTORE_NATIVE"
  deletion_policy         = "ABANDON"
  delete_protection_state = "DELETE_PROTECTION_DISABLED"

  depends_on = [google_project_service.apis]
}
