terraform {
  backend "gcs" {
    bucket = "gcp-resume-app-build"
    prefix = "terraform/state/03-webapp"
  }
}
