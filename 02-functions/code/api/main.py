# ================================================================================
# api/main.py
#
# Purpose
# HTTP Cloud Function that serves as the single API entry point for the Resume
# Scorer application. Routes requests to resume and job handlers internally.
#
# Key Responsibilities
# - Extract the authenticated Firebase UID from the API Gateway header
# - CRUD operations for resumes (Firestore metadata + GCS content)
# - CRUD operations for jobs (Firestore metadata + GCS artifacts + Pub/Sub)
# - Return CORS headers on every response so the SPA can call the API
# ================================================================================

import base64
import json
import logging
import os
import uuid
from datetime import datetime, timezone

import functions_framework
from google.cloud import firestore, pubsub_v1, storage

logger = logging.getLogger(__name__)

PROJECT_ID   = os.environ["GOOGLE_CLOUD_PROJECT"]
MEDIA_BUCKET = os.environ["MEDIA_BUCKET_NAME"]
JOBS_TOPIC   = os.environ["JOBS_TOPIC"]
CORS_ORIGIN  = os.environ.get("CORS_ALLOW_ORIGIN", "*")

# Initialise clients once at cold-start; reused across warm invocations
db        = firestore.Client(project=PROJECT_ID)
publisher = pubsub_v1.PublisherClient()
gcs       = storage.Client(project=PROJECT_ID)
bucket    = gcs.bucket(MEDIA_BUCKET)
topic_path = publisher.topic_path(PROJECT_ID, JOBS_TOPIC)

# 90-day TTL — long enough that scored jobs remain available for reference
TTL_SECONDS = 90 * 24 * 3600

# Lifetime token cap applied per user — enforced at job submission time
TOKEN_LIMIT_DEFAULT = 100_000

# Hard cap on attachment size — documents rarely exceed this
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024  # 10 MB

# Maximum number of registered users — enforced at registration time
USER_CAP = 100


# ================================================================================
# Helpers
# ================================================================================

def _cors_headers():
    return {
        "Access-Control-Allow-Origin":  CORS_ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age":       "3600",
    }


def _response(status, body):
    """Build a JSON response tuple with CORS headers."""
    return (
        json.dumps(body),
        status,
        {**_cors_headers(), "Content-Type": "application/json"},
    )


def _get_owner(request):
    """Extract Firebase UID from the base64-encoded header injected by API Gateway."""
    header = request.headers.get("X-Apigateway-Api-Userinfo", "")
    if not header:
        return None
    try:
        padded = header + "=" * (-len(header) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
        return claims.get("sub") or claims.get("user_id")
    except Exception:
        return None


def _now():
    return int(datetime.now(timezone.utc).timestamp())


def _ts_ms(epoch_seconds):
    """Convert epoch seconds to milliseconds for JavaScript Date compatibility."""
    return epoch_seconds * 1000 if epoch_seconds else 0


# ================================================================================
# User Registration
# ================================================================================

def _handle_register(owner):
    """Register a new user, or confirm an existing one.

    Returns 403 user_limit_reached if the user cap has been hit so the
    frontend can show the waitlist message and sign the user out.
    """
    user_ref = db.collection("resume_app_users").document(owner)
    if user_ref.get().exists:
        return _response(200, {"status": "ok"})

    # Count before creating — avoids phantom reads under concurrent signups
    total = db.collection("resume_app_users").count().get()[0][0].value
    if total >= USER_CAP:
        return _response(403, {"error": "user_limit_reached"})

    user_ref.set({
        "owner":       owner,
        "tokens_used": 0,
        "token_limit": TOKEN_LIMIT_DEFAULT,
        "created_at":  _now(),
    })
    return _response(200, {"status": "ok"})


# ================================================================================
# Token Usage Helpers
# ================================================================================

def _check_token_limit(owner):
    """Return True if the user is under their lifetime token cap."""
    doc = db.collection("resume_app_users").document(owner).get()
    if not doc.exists:
        return True
    d     = doc.to_dict()
    used  = d.get("tokens_used", 0) or 0
    limit = d.get("token_limit", TOKEN_LIMIT_DEFAULT)
    return used < limit


def _handle_get_usage(owner):
    """Return the user's current token usage and limit."""
    doc = db.collection("resume_app_users").document(owner).get()
    if not doc.exists:
        return _response(200, {
            "tokens_used":  0,
            "token_limit":  TOKEN_LIMIT_DEFAULT,
        })
    d = doc.to_dict()
    return _response(200, {
        "tokens_used": d.get("tokens_used", 0) or 0,
        "token_limit": d.get("token_limit", TOKEN_LIMIT_DEFAULT),
    })


# ================================================================================
# Resume Handlers
# ================================================================================

def _handle_list_resumes(owner):
    docs = (
        db.collection("resume_app_resumes")
        .where("owner", "==", owner)
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .stream()
    )
    return _response(200, [
        {
            "resume_id":  d["resume_id"],
            "name":       d.get("name", ""),
            "created_at": _ts_ms(d.get("created_at")),
            "updated_at": _ts_ms(d.get("updated_at")),
        }
        for doc in docs
        for d in [doc.to_dict()]
    ])


def _handle_create_resume(owner, body):
    name    = (body.get("name")   or "").strip()
    content = (body.get("resume") or "").strip()
    if not name or not content:
        return _response(400, {"error": "name and resume are required"})

    resume_id = f"RESUME-{uuid.uuid4().hex[:12]}"
    gcs_key   = f"users/{owner}/resumes/{resume_id}.txt"
    now       = _now()

    bucket.blob(gcs_key).upload_from_string(content, content_type="text/plain")
    db.collection("resume_app_resumes").document(f"{owner}_{resume_id}").set({
        "owner":      owner,
        "resume_id":  resume_id,
        "name":       name,
        "gcs_key":    gcs_key,
        "created_at": now,
        "updated_at": now,
        "ttl":        now + TTL_SECONDS,
    })
    return _response(200, {"resume_id": resume_id, "name": name})


def _handle_get_resume(owner, resume_id):
    doc = db.collection("resume_app_resumes").document(f"{owner}_{resume_id}").get()
    if not doc.exists:
        return _response(404, {"error": "not found"})
    d = doc.to_dict()
    if d.get("owner") != owner:
        return _response(403, {"error": "forbidden"})

    content = bucket.blob(d["gcs_key"]).download_as_text()
    return _response(200, {
        "resume_id":  d["resume_id"],
        "name":       d.get("name", ""),
        "resume":     content,
        "created_at": _ts_ms(d.get("created_at")),
        "updated_at": _ts_ms(d.get("updated_at")),
    })


def _handle_update_resume(owner, resume_id, body):
    doc_ref = db.collection("resume_app_resumes").document(f"{owner}_{resume_id}")
    doc     = doc_ref.get()
    if not doc.exists:
        return _response(404, {"error": "not found"})
    d = doc.to_dict()
    if d.get("owner") != owner:
        return _response(403, {"error": "forbidden"})

    updates = {"updated_at": _now()}
    if "name" in body:
        updates["name"] = (body["name"] or "").strip()
    if "resume" in body:
        bucket.blob(d["gcs_key"]).upload_from_string(
            body["resume"], content_type="text/plain"
        )
    doc_ref.update(updates)
    return _response(200, {"resume_id": resume_id})


def _handle_delete_resume(owner, resume_id):
    doc_ref = db.collection("resume_app_resumes").document(f"{owner}_{resume_id}")
    doc     = doc_ref.get()
    if not doc.exists:
        return _response(404, {"error": "not found"})
    d = doc.to_dict()
    if d.get("owner") != owner:
        return _response(403, {"error": "forbidden"})

    bucket.blob(d["gcs_key"]).delete()
    doc_ref.delete()
    return _response(200, {"deleted": resume_id})


# ================================================================================
# Folder Handlers
# ================================================================================

def _handle_list_folders(owner):
    docs = (
        db.collection("resume_app_folders")
        .where("owner", "==", owner)
        .stream()
    )
    folders = [
        {
            "folder_id":  d["folder_id"],
            "name":       d.get("name", ""),
            "created_at": _ts_ms(d.get("created_at")),
        }
        for doc in docs
        for d in [doc.to_dict()]
    ]
    # Sort in Python — avoids requiring a composite index on this collection
    folders.sort(key=lambda f: f["created_at"])
    return _response(200, folders)


def _handle_create_folder(owner, body):
    name = (body.get("name") or "").strip()
    if not name:
        return _response(400, {"error": "name is required"})

    folder_id = f"FOLDER-{uuid.uuid4().hex[:12]}"
    now       = _now()
    db.collection("resume_app_folders").document(f"{owner}_{folder_id}").set({
        "owner":      owner,
        "folder_id":  folder_id,
        "name":       name,
        "created_at": now,
        "ttl":        now + TTL_SECONDS,
    })
    return _response(200, {"folder_id": folder_id, "name": name})


def _handle_delete_folder(owner, folder_id):
    doc_ref = db.collection("resume_app_folders").document(f"{owner}_{folder_id}")
    doc     = doc_ref.get()
    if not doc.exists:
        return _response(404, {"error": "not found"})
    if doc.to_dict().get("owner") != owner:
        return _response(403, {"error": "forbidden"})

    # Clear folder_id from any jobs that referenced this folder
    jobs = (
        db.collection("resume_app_jobs")
        .where("owner", "==", owner)
        .where("folder_id", "==", folder_id)
        .stream()
    )
    for job_doc in jobs:
        job_doc.reference.update({"folder_id": None})

    doc_ref.delete()
    return _response(200, {"deleted": folder_id})


def _handle_move_job_to_folder(owner, job_id, body):
    doc_ref = db.collection("resume_app_jobs").document(f"{owner}_{job_id}")
    doc     = doc_ref.get()
    if not doc.exists:
        return _response(404, {"error": "not found"})
    if doc.to_dict().get("owner") != owner:
        return _response(403, {"error": "forbidden"})

    folder_id = body.get("folder_id") or None

    # Verify the folder exists if one was specified
    if folder_id:
        folder_doc = db.collection("resume_app_folders").document(
            f"{owner}_{folder_id}"
        ).get()
        if not folder_doc.exists:
            return _response(404, {"error": "folder not found"})

    doc_ref.update({"folder_id": folder_id})
    return _response(200, {"job_id": job_id, "folder_id": folder_id})


# ================================================================================
# Job Handlers
# ================================================================================

def _handle_list_jobs(owner):
    docs = (
        db.collection("resume_app_jobs")
        .where("owner", "==", owner)
        .order_by("created_at", direction=firestore.Query.DESCENDING)
        .limit(100)
        .stream()
    )
    return _response(200, [
        {
            "job_id":      d["job_id"],
            "resume_id":   d.get("resume_id", ""),
            "resume_name": d.get("resume_name", ""),
            "job_title":   d.get("job_title", ""),
            "company":     d.get("company_name", ""),
            "job_url":     d.get("source_url", ""),
            "score":       d.get("score"),
            "status":      d.get("status", "submitted"),
            "created_at":  _ts_ms(d.get("created_at")),
            "folder_id":        d.get("folder_id"),
            "attachment_count": len(d.get("attachments", [])),
        }
        for doc in docs
        for d in [doc.to_dict()]
    ])


def _handle_create_job(owner, body):
    resume_id   = (body.get("resume_id")    or "").strip()
    source_type = (body.get("source_type")  or "url").strip()
    source_url  = (body.get("job_url")      or "").strip()
    raw_text    = (body.get("job_description") or "").strip()

    if not resume_id:
        return _response(400, {"error": "resume_id is required"})
    if source_type == "url" and not source_url:
        return _response(400, {"error": "job_url required for url source_type"})
    if source_type == "raw_text" and not raw_text:
        return _response(400, {"error": "job_description required for raw_text source_type"})

    # Reject submission if user has exhausted their lifetime token allowance
    if not _check_token_limit(owner):
        return _response(429, {
            "error": (
                "Token limit reached. You have used your "
                f"{TOKEN_LIMIT_DEFAULT:,}-token lifetime allowance."
            )
        })

    # Verify the resume exists and belongs to this user
    resume_doc = db.collection("resume_app_resumes").document(
        f"{owner}_{resume_id}"
    ).get()
    if not resume_doc.exists or resume_doc.to_dict().get("owner") != owner:
        return _response(404, {"error": "resume not found"})

    resume_data = resume_doc.to_dict()
    resume_name = resume_data.get("name", "")

    folder_id = (body.get("folder_id") or "").strip() or None
    if folder_id:
        folder_doc = db.collection("resume_app_folders").document(
            f"{owner}_{folder_id}"
        ).get()
        if not folder_doc.exists:
            return _response(404, {"error": "folder not found"})

    job_id = f"JOB-{uuid.uuid4().hex[:12]}"
    now    = _now()

    # Save a snapshot of the resume at submission time for the worker
    resume_content = bucket.blob(resume_data["gcs_key"]).download_as_text()
    bucket.blob(f"users/{owner}/jobs/{job_id}/resume_snapshot.txt").upload_from_string(
        resume_content, content_type="text/plain"
    )

    # For raw text jobs, pre-save the description for the worker to read
    if source_type == "raw_text":
        bucket.blob(f"users/{owner}/jobs/{job_id}/job_description.txt").upload_from_string(
            raw_text, content_type="text/plain"
        )

    db.collection("resume_app_jobs").document(f"{owner}_{job_id}").set({
        "owner":        owner,
        "job_id":       job_id,
        "resume_id":    resume_id,
        "resume_name":  resume_name,
        "source_type":  source_type,
        "source_url":   source_url if source_type == "url" else "",
        "job_title":    "",
        "company_name": "",
        "score":        None,
        "status":       "submitted",
        "folder_id":    folder_id,
        "created_at":   now,
        "ttl":          now + TTL_SECONDS,
    })

    publisher.publish(topic_path, json.dumps({
        "job_id":      job_id,
        "owner":       owner,
        "resume_id":   resume_id,
        "source_type": source_type,
        "source_url":  source_url,
    }).encode())

    return _response(200, {
        "job_id":    job_id,
        "resume_id": resume_id,
        "status":    "submitted",
    })


def _handle_get_job(owner, job_id):
    doc = db.collection("resume_app_jobs").document(f"{owner}_{job_id}").get()
    if not doc.exists:
        return _response(404, {"error": "not found"})
    d = doc.to_dict()
    if d.get("owner") != owner:
        return _response(403, {"error": "forbidden"})

    result = {
        "job_id":         d["job_id"],
        "resume_id":      d.get("resume_id", ""),
        "resume_name":    d.get("resume_name", ""),
        "job_title":      d.get("job_title", ""),
        "company":        d.get("company_name", ""),
        "score":          d.get("score"),
        "status":         d.get("status", "submitted"),
        "status_message": d.get("error_message", ""),
        "created_at":     _ts_ms(d.get("created_at")),
        "source_type":    d.get("source_type", ""),
        "job_url":        d.get("source_url", ""),
        "folder_id":      d.get("folder_id") or "",
        "job_analysis":   "",
        "job_description": "",
        "resume_snapshot": "",
        "notes":          "",
    }

    # Load GCS artifacts when available; fail gracefully if any are missing
    base = f"users/{owner}/jobs/{job_id}"
    for field, key in [
        ("job_analysis",    f"{base}/job_analysis.txt"),
        ("job_description", f"{base}/job_description.txt"),
        ("resume_snapshot", f"{base}/resume_snapshot.txt"),
        ("notes",           f"{base}/notes.txt"),
    ]:
        try:
            result[field] = bucket.blob(key).download_as_text()
        except Exception:
            pass

    return _response(200, result)


def _handle_update_job_notes(owner, job_id, body):
    doc = db.collection("resume_app_jobs").document(f"{owner}_{job_id}").get()
    if not doc.exists:
        return _response(404, {"error": "not found"})
    if doc.to_dict().get("owner") != owner:
        return _response(403, {"error": "forbidden"})

    notes = body.get("notes") or ""
    bucket.blob(f"users/{owner}/jobs/{job_id}/notes.txt").upload_from_string(
        notes, content_type="text/plain"
    )
    return _response(200, {"job_id": job_id})


def _handle_delete_job(owner, job_id):
    doc_ref = db.collection("resume_app_jobs").document(f"{owner}_{job_id}")
    doc     = doc_ref.get()
    if not doc.exists:
        return _response(404, {"error": "not found"})
    d = doc.to_dict()
    if d.get("owner") != owner:
        return _response(403, {"error": "forbidden"})

    for blob in gcs.list_blobs(MEDIA_BUCKET, prefix=f"users/{owner}/jobs/{job_id}/"):
        blob.delete()
    doc_ref.delete()
    return _response(200, {"deleted": job_id})


# ================================================================================
# Attachment Handlers
# ================================================================================

def _handle_list_attachments(owner, job_id):
    """Return the attachments array from the job document."""
    doc = db.collection("resume_app_jobs").document(f"{owner}_{job_id}").get()
    if not doc.exists:
        return _response(404, {"error": "not found"})
    d = doc.to_dict()
    if d.get("owner") != owner:
        return _response(403, {"error": "forbidden"})
    return _response(200, d.get("attachments", []))


def _handle_upload_attachment(owner, job_id, body):
    """Decode a base64 file, write it to GCS, and append metadata to the job."""
    doc_ref = db.collection("resume_app_jobs").document(f"{owner}_{job_id}")
    doc     = doc_ref.get()
    if not doc.exists:
        return _response(404, {"error": "not found"})
    if doc.to_dict().get("owner") != owner:
        return _response(403, {"error": "forbidden"})

    filename     = (body.get("filename")     or "").strip()
    content_type = (body.get("content_type") or "application/octet-stream").strip()
    data_b64     = body.get("data")          or ""

    if not filename or not data_b64:
        return _response(400, {"error": "filename and data are required"})

    existing = doc.to_dict().get("attachments", [])
    if len(existing) >= 5:
        return _response(400, {"error": "attachment limit reached (5 max)"})

    try:
        file_bytes = base64.b64decode(data_b64)
    except Exception:
        return _response(400, {"error": "invalid base64 data"})

    if len(file_bytes) > MAX_ATTACHMENT_BYTES:
        return _response(413, {"error": "file exceeds 10 MB limit"})

    attachment_id = f"ATT-{uuid.uuid4().hex[:12]}"
    gcs_key = (
        f"users/{owner}/jobs/{job_id}/attachments/{attachment_id}/{filename}"
    )
    bucket.blob(gcs_key).upload_from_string(file_bytes, content_type=content_type)

    attachment = {
        "attachment_id": attachment_id,
        "filename":      filename,
        "content_type":  content_type,
        "size":          len(file_bytes),
        "uploaded_at":   _now(),
    }
    doc_ref.update({"attachments": firestore.ArrayUnion([attachment])})
    return _response(200, attachment)


def _handle_download_attachment(owner, job_id, attachment_id):
    """Return file bytes as base64 JSON for the browser to decode and save."""
    doc = db.collection("resume_app_jobs").document(f"{owner}_{job_id}").get()
    if not doc.exists:
        return _response(404, {"error": "not found"})
    d = doc.to_dict()
    if d.get("owner") != owner:
        return _response(403, {"error": "forbidden"})

    attachments = d.get("attachments", [])
    att = next(
        (a for a in attachments if a.get("attachment_id") == attachment_id), None
    )
    if not att:
        return _response(404, {"error": "attachment not found"})

    gcs_key = (
        f"users/{owner}/jobs/{job_id}/attachments"
        f"/{attachment_id}/{att['filename']}"
    )
    try:
        file_bytes = bucket.blob(gcs_key).download_as_bytes()
    except Exception:
        return _response(404, {"error": "file not found in storage"})

    return _response(200, {
        "filename":     att["filename"],
        "content_type": att.get("content_type", "application/octet-stream"),
        "data":         base64.b64encode(file_bytes).decode("utf-8"),
    })


def _handle_delete_attachment(owner, job_id, attachment_id):
    """Remove the GCS object and pull the entry from the attachments array."""
    doc_ref = db.collection("resume_app_jobs").document(f"{owner}_{job_id}")
    doc     = doc_ref.get()
    if not doc.exists:
        return _response(404, {"error": "not found"})
    d = doc.to_dict()
    if d.get("owner") != owner:
        return _response(403, {"error": "forbidden"})

    attachments = d.get("attachments", [])
    att = next(
        (a for a in attachments if a.get("attachment_id") == attachment_id), None
    )
    if not att:
        return _response(404, {"error": "attachment not found"})

    gcs_key = (
        f"users/{owner}/jobs/{job_id}/attachments"
        f"/{attachment_id}/{att['filename']}"
    )
    try:
        bucket.blob(gcs_key).delete()
    except Exception:
        pass  # Already gone from GCS; still remove from Firestore

    # Read-modify-write the array — ArrayRemove requires exact dict equality
    updated = [a for a in attachments if a.get("attachment_id") != attachment_id]
    doc_ref.update({"attachments": updated})
    return _response(200, {"deleted": attachment_id})


# ================================================================================
# Entry Point
# ================================================================================

@functions_framework.http
def resume_api(request):
    """Route all API Gateway requests to the appropriate handler."""
    if request.method == "OPTIONS":
        return ("", 204, _cors_headers())

    owner = _get_owner(request)
    if not owner:
        return _response(401, {"error": "unauthorized"})

    path     = request.path.rstrip("/")
    method   = request.method.upper()
    segments = [s for s in path.split("/") if s]

    try:
        body = request.get_json(silent=True) or {}

        # /register
        if len(segments) == 1 and segments[0] == "register":
            if method == "POST":
                return _handle_register(owner)

        # /usage
        if len(segments) == 1 and segments[0] == "usage":
            if method == "GET":
                return _handle_get_usage(owner)

        # /folders
        if len(segments) == 1 and segments[0] == "folders":
            if method == "GET":
                return _handle_list_folders(owner)
            if method == "POST":
                return _handle_create_folder(owner, body)

        # /folders/{id}
        if len(segments) == 2 and segments[0] == "folders":
            if method == "DELETE":
                return _handle_delete_folder(owner, segments[1])

        # /resumes
        if len(segments) == 1 and segments[0] == "resumes":
            if method == "GET":
                return _handle_list_resumes(owner)
            if method == "POST":
                return _handle_create_resume(owner, body)

        # /resumes/{id}
        if len(segments) == 2 and segments[0] == "resumes":
            rid = segments[1]
            if method == "GET":
                return _handle_get_resume(owner, rid)
            if method == "PUT":
                return _handle_update_resume(owner, rid, body)
            if method == "DELETE":
                return _handle_delete_resume(owner, rid)

        # /jobs
        if len(segments) == 1 and segments[0] == "jobs":
            if method == "GET":
                return _handle_list_jobs(owner)
            if method == "POST":
                return _handle_create_job(owner, body)

        # /jobs/{id}
        if len(segments) == 2 and segments[0] == "jobs":
            jid = segments[1]
            if method == "GET":
                return _handle_get_job(owner, jid)
            if method == "DELETE":
                return _handle_delete_job(owner, jid)

        # /jobs/{id}/notes
        if len(segments) == 3 and segments[0] == "jobs" and segments[2] == "notes":
            if method == "PATCH":
                return _handle_update_job_notes(owner, segments[1], body)

        # /jobs/{id}/folder
        if len(segments) == 3 and segments[0] == "jobs" and segments[2] == "folder":
            if method == "PATCH":
                return _handle_move_job_to_folder(owner, segments[1], body)

        # /jobs/{id}/attachments
        if len(segments) == 3 and segments[0] == "jobs" and segments[2] == "attachments":
            jid = segments[1]
            if method == "GET":
                return _handle_list_attachments(owner, jid)
            if method == "POST":
                return _handle_upload_attachment(owner, jid, body)

        # /jobs/{id}/attachments/{att_id}
        if len(segments) == 4 and segments[0] == "jobs" and segments[2] == "attachments":
            jid, att_id = segments[1], segments[3]
            if method == "GET":
                return _handle_download_attachment(owner, jid, att_id)
            if method == "DELETE":
                return _handle_delete_attachment(owner, jid, att_id)

        return _response(404, {"error": "not found"})

    except Exception as exc:
        logger.exception("Unhandled error: %s", exc)
        return _response(500, {"error": "internal server error"})
