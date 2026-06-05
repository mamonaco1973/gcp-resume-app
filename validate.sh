#!/usr/bin/env bash
# ================================================================================
# validate.sh
# Post-deploy summary: prints the API Gateway URL and the webapp GCS URL.
# ================================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ================================================================================
# Read Terraform Outputs
# ================================================================================

GATEWAY_URL=$(cd "${SCRIPT_DIR}/02-functions" && terraform output -raw gateway_url 2>/dev/null || echo "")
WEBAPP_URL=$(cd "${SCRIPT_DIR}/03-webapp" && terraform output -raw webapp_url 2>/dev/null || echo "")
PROJECT_ID=$(jq -r '.project_id' "${SCRIPT_DIR}/credentials.json" 2>/dev/null || echo "")
FIREBASE_REDIRECT_URI="https://${PROJECT_ID}.firebaseapp.com/__/auth/handler"

echo ""
echo "==================================================================================="
echo "  Resume Scorer — Deployment validated!"
echo "==================================================================================="
echo "  App : ${WEBAPP_URL}"
echo "==================================================================================="

if [ -n "${GOOGLE_OAUTH_CLIENT_ID:-}" ] && [ -n "${GOOGLE_OAUTH_CLIENT_SECRET:-}" ]; then
  echo ""
  echo "  Google sign-in is configured. Ensure your OAuth client has these set:"
  echo "    Authorized JavaScript origins : https://storage.googleapis.com"
  echo "    Authorized redirect URIs      : ${FIREBASE_REDIRECT_URI}"
  echo ""
else
  echo ""
  echo "  WARNING: Google sign-in is not configured."
  echo "  To enable it, export GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET"
  echo "  then re-run apply.sh."
  echo ""
  echo "  When configured, set these on your OAuth client:"
  echo "    Authorized JavaScript origins : https://storage.googleapis.com"
  echo "    Authorized redirect URIs      : ${FIREBASE_REDIRECT_URI}"
  echo ""
fi
