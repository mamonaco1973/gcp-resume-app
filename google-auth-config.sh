#!/usr/bin/env bash
# ================================================================================
# google-auth-config.sh
# Google OAuth credentials for Identity Platform Google sign-in.
#
# To enable "Login with Google" in the app:
#   1. Go to GCP Console → APIs & Services → Credentials
#   2. Create an OAuth 2.0 Client ID (Web application type)
#   3. Add your webapp URL to Authorized JavaScript origins
#   4. Copy the client ID and secret into the variables below
#
# Leave both values empty to deploy without Google sign-in.
# ================================================================================

export GOOGLE_OAUTH_CLIENT_ID=""
export GOOGLE_OAUTH_CLIENT_SECRET=""
