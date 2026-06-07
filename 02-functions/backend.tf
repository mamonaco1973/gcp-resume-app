terraform {
  backend "gcs" {
    bucket = "gcp-resume-app-build"
    prefix = "terraform/state/02-functions"
  }
}
