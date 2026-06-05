# ================================================================================
# 01-backend/identity.tf
# Browser-safe API key scoped to Identity Platform only.
# Used by the SPA to initialise Firebase Auth without exposing project credentials.
# ================================================================================

resource "google_apikeys_key" "webapp_key" {
  provider = google-beta

  name         = "resume-webapp-key-${random_id.suffix.hex}"
  display_name = "Resume App Browser Key"

  restrictions {
    api_targets {
      service = "identitytoolkit.googleapis.com"
    }
  }
}

output "firebase_api_key" {
  value     = google_apikeys_key.webapp_key.key_string
  sensitive = true
}

# ================================================================================
# Identity Platform Config
# Adds storage.googleapis.com to authorized domains so the GCS-hosted SPA
# can open Google sign-in popups without an unauthorized-domain error.
# Default domains (localhost, firebaseapp.com, web.app) are kept explicitly
# because Terraform replaces the entire list when this resource is managed.
# ================================================================================

resource "google_identity_platform_config" "default" {
  provider = google-beta

  authorized_domains = [
    "localhost",
    "${local.project_id}.firebaseapp.com",
    "${local.project_id}.web.app",
    "storage.googleapis.com",
  ]
}

# ================================================================================
# Google Sign-In Provider
# Only provisioned when both OAuth credentials are supplied.
# ================================================================================

resource "google_identity_platform_default_supported_idp_config" "google_sign_in" {
  count    = (var.google_oauth_client_id != "" && var.google_oauth_client_secret != "") ? 1 : 0
  provider = google-beta

  enabled       = true
  idp_id        = "google.com"
  client_id     = var.google_oauth_client_id
  client_secret = var.google_oauth_client_secret
}
