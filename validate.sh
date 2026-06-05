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

echo ""
echo "==================================================================================="
echo "  Resume Scorer — Deployment validated!"
echo "==================================================================================="
echo "  App : ${WEBAPP_URL}"
echo "==================================================================================="

if [ -z "${GOOGLE_OAUTH_CLIENT_ID:-}" ] || [ -z "${GOOGLE_OAUTH_CLIENT_SECRET:-}" ]; then
  echo ""
  echo "  WARNING: Google sign-in is not configured."
  echo "  To enable it, export GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET"
  echo "  then re-run apply.sh."
  echo ""
fi
