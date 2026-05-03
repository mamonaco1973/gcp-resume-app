# ================================================================================
# Lambda API Router
#
# Dispatches API Gateway requests to the appropriate handler functions.
#
# Design
# - Single Lambda handles all API routes
# - Routing is based on HTTP method and request path
# - Business logic lives in domain modules (jobs.py, resumes.py)
# ================================================================================

import json
import logging
from jobs import create_job, delete_job, get_job, list_jobs, update_job_notes
from resumes import (
    create_resume,
    delete_resume,
    get_resume,
    list_resumes,
    update_resume,
)

# --------------------------------------------------------------------------------
# Configure logger
# --------------------------------------------------------------------------------

logger = logging.getLogger()
logger.setLevel(logging.INFO)


# --------------------------------------------------------------------------------
# Main Lambda entry point
#
# API Gateway sends all requests to this function. The router determines which
# handler to call based on HTTP method and request path.
# --------------------------------------------------------------------------------

def lambda_handler(event, context):

    method = event["requestContext"]["http"]["method"]
    path = event["rawPath"]

    # ----------------------------------------------------------------------------
    # Debug log for incoming requests
    # ----------------------------------------------------------------------------

    logger.info("API request: %s %s", method, path)

    try:
        # ------------------------------------------------------------------------
        # Jobs collection endpoints
        # ------------------------------------------------------------------------

        if method == "GET" and path == "/jobs":
            return list_jobs(event)

        if method == "POST" and path == "/jobs":
            return create_job(event)

        # ------------------------------------------------------------------------
        # Individual job endpoints
        # ------------------------------------------------------------------------

        if method == "GET" and path.startswith("/jobs/") and not path.endswith(
            "/notes"
        ):
            return get_job(event)

        if method == "PATCH" and path.endswith("/notes"):
            return update_job_notes(event)

        if method == "DELETE" and path.startswith("/jobs/") and not path.endswith(
            "/notes"
        ):
            return delete_job(event)

        # ------------------------------------------------------------------------
        # Resume collection endpoints
        # ------------------------------------------------------------------------

        if method == "GET" and path == "/resumes":
            return list_resumes(event)

        if method == "POST" and path == "/resumes":
            return create_resume(event)

        # ------------------------------------------------------------------------
        # Individual resume endpoints
        # ------------------------------------------------------------------------

        if method == "GET" and path.startswith("/resumes/"):
            return get_resume(event)

        if method == "PUT" and path.startswith("/resumes/"):
            return update_resume(event)

        if method == "DELETE" and path.startswith("/resumes/"):
            return delete_resume(event)

        # ------------------------------------------------------------------------
        # Default response
        # ------------------------------------------------------------------------

        return {
            "statusCode": 404,
            "body": json.dumps({"error": "not found"})
        }

    except Exception:
        logger.exception("Unhandled exception")
        return {
            "statusCode": 500,
            "body": json.dumps({"error": "internal server error"})
        }