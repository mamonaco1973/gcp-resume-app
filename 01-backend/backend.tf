terraform {
  backend "gcs" {
    bucket = "gcp-resume-app-build"
    prefix = "terraform/state/01-backend"
  }
}
