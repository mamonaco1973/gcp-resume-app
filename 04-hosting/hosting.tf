# ================================================================================
# 04-hosting/hosting.tf
# Firebase Hosting site — serves the SPA at <site_id>.web.app with automatic
# HTTPS. No custom domain needed for a portfolio demo.
# ================================================================================

variable "site_id" {
  default = "myjobs-resume-app"
}

# ================================================================================
# Firebase Hosting Site
# ================================================================================

resource "google_firebase_hosting_site" "myjobs" {
  provider = google-beta
  project  = local.project_id
  site_id  = var.site_id
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
