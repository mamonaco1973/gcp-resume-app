# ================================================================================
# 04-hosting/hosting.tf
# Firebase Hosting site, custom domain association, and Cloud DNS CNAME record.
#
# Flow:
#   1. Firebase Hosting site created → default URL is <site_id>.web.app
#   2. CNAME added to Cloud DNS → myjobs.mikes-cloud-solutions.net → <site_id>.web.app
#   3. Custom domain registered with Firebase → Firebase provisions SSL cert
#      once it can resolve the CNAME to its own infrastructure
# ================================================================================

locals {
  # Deterministic site ID scoped to this project — globally unique in Firebase.
  site_id      = "myjobs-${local.project_id}"
  custom_domain = "myjobs.mikes-cloud-solutions.net"
  dns_zone     = "mikes-cloud-solutions-net"
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
# Cloud DNS — CNAME record
# Points the custom subdomain at the Firebase Hosting default URL.
# Firebase verifies ownership by resolving this CNAME to its own CDN.
# ================================================================================

resource "google_dns_record_set" "myjobs_cname" {
  project      = local.project_id
  managed_zone = local.dns_zone
  name         = "${local.custom_domain}."
  type         = "CNAME"
  ttl          = 300
  rrdatas      = ["${google_firebase_hosting_site.myjobs.site_id}.web.app."]
}

# ================================================================================
# Firebase Hosting — Custom Domain
# Registers the subdomain with Firebase and triggers SSL cert provisioning.
# DNS record is created first so Firebase can verify immediately on apply.
# ================================================================================

resource "google_firebase_hosting_custom_domain" "myjobs" {
  provider      = google-beta
  project       = local.project_id
  site_id       = google_firebase_hosting_site.myjobs.site_id
  custom_domain = local.custom_domain

  depends_on = [google_dns_record_set.myjobs_cname]
}

# ================================================================================
# Outputs
# ================================================================================

output "hosting_url" {
  value = "https://${local.custom_domain}"
}

output "firebase_site_id" {
  value = google_firebase_hosting_site.myjobs.site_id
}

output "firebase_default_url" {
  value = "https://${google_firebase_hosting_site.myjobs.site_id}.web.app"
}
