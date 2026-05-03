#!/usr/bin/env bash
# ================================================================================
# check_env.sh
# Validates local tooling, GCP credentials, and Vertex AI model access before
# apply.sh or destroy.sh are allowed to proceed.
# ================================================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREDENTIALS="${SCRIPT_DIR}/credentials.json"

# ================================================================================
# Tool Validation
# ================================================================================

echo "NOTE: Validating required commands in PATH."

MISSING=0
for CMD in gcloud terraform jq pip; do
  if ! command -v "${CMD}" > /dev/null 2>&1; then
    echo "ERROR: ${CMD} not found in PATH."
    MISSING=1
  else
    echo "NOTE: ${CMD} found."
  fi
done

[ "${MISSING}" -ne 0 ] && { echo "ERROR: Missing required tools."; exit 1; }

# ================================================================================
# Credentials
# ================================================================================

if [ ! -f "${CREDENTIALS}" ]; then
  echo "ERROR: credentials.json not found at ${CREDENTIALS}."
  exit 1
fi

PROJECT_ID=$(jq -r '.project_id' "${CREDENTIALS}" 2>/dev/null || echo "")
SA_EMAIL=$(jq  -r '.client_email' "${CREDENTIALS}" 2>/dev/null || echo "")

if [ -z "${PROJECT_ID}" ] || [ -z "${SA_EMAIL}" ]; then
  echo "ERROR: credentials.json missing project_id or client_email."
  exit 1
fi

echo "NOTE: credentials.json found — project=${PROJECT_ID}, sa=${SA_EMAIL}"

# ================================================================================
# GCP Authentication
# ================================================================================

gcloud auth activate-service-account --key-file="${CREDENTIALS}" --quiet
gcloud config set project "${PROJECT_ID}" --quiet
echo "NOTE: Authenticated as ${SA_EMAIL}."

# ================================================================================
# API Setup
# ================================================================================

echo "NOTE: Running api_setup.sh (enables APIs, Firestore, Identity Platform)..."
"${SCRIPT_DIR}/api_setup.sh"

# ================================================================================
# Vertex AI API Check
# ================================================================================

GEMINI_MODEL_ID="${GEMINI_MODEL_ID:-gemini-2.0-flash-001}"
echo "NOTE: Checking Vertex AI API is enabled for model ${GEMINI_MODEL_ID}..."

if gcloud services list --enabled --project="${PROJECT_ID}" --quiet \
    | grep -q "aiplatform.googleapis.com"; then
  echo "NOTE: Vertex AI API is enabled."
else
  echo "ERROR: Vertex AI API (aiplatform.googleapis.com) is not enabled."
  echo "       Run api_setup.sh or enable it manually in the GCP console."
  exit 1
fi
