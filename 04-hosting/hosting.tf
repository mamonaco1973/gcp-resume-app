# ================================================================================
# 04-hosting/hosting.tf
# Firebase Hosting site — serves the SPA at <site_id>.web.app with automatic
# HTTPS. No custom domain needed for a portfolio demo.
# ================================================================================

locals {
  # Deterministic site ID scoped to this project — globally unique in Firebase.
  site_id = "myjobs-${local.project_id}"
}

# ================================================================================
# Firebase Hosting Site
# ================================================================================

resource "google_firebase_hosting_site" "myjobs" {
  provider = google-beta
  project  = local.project_id
  site_id  = local.site_id
}

# ================================================================================
# Outputs
# ================================================================================

output "hosting_url" {
  value = "https://${google_firebase_hosting_site.myjobs.site_id}.web.app"
}

output "firebase_site_id" {
  value = google_firebase_hosting_site.myjobs.site_id
}
