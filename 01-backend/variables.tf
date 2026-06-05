# ================================================================================
# 01-backend/variables.tf
# Optional Google OAuth credentials for Identity Platform Google sign-in.
# Leave empty to deploy without Google sign-in support.
# ================================================================================

variable "google_oauth_client_id" {
  description = "Google OAuth 2.0 client ID for Identity Platform Google sign-in"
  type        = string
  default     = ""
}

variable "google_oauth_client_secret" {
  description = "Google OAuth 2.0 client secret for Identity Platform Google sign-in"
  type        = string
  default     = ""
  sensitive   = true
}
