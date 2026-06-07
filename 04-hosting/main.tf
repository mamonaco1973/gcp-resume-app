# ================================================================================
# 04-hosting/main.tf
# Provider config for Firebase Hosting and Cloud DNS custom domain wiring.
# google-beta required for google_firebase_hosting_* resources.
# ================================================================================

terraform {
  required_providers {
    google      = { source = "hashicorp/google",      version = "~> 5.0" }
    google-beta = { source = "hashicorp/google-beta", version = "~> 5.0" }
  }
}

locals {
  credentials = jsondecode(file("${path.module}/../credentials.json"))
  project_id  = local.credentials.project_id
}

provider "google" {
  credentials = file("${path.module}/../credentials.json")
  project     = local.project_id
  region      = "us-central1"
}

provider "google-beta" {
  credentials = file("${path.module}/../credentials.json")
  project     = local.project_id
  region      = "us-central1"
}
