# ================================================================================
# worker/main.py
#
# Purpose
# Pub/Sub-triggered Cloud Function that performs async resume scoring.
# Consumes job messages from the resume-job-requests topic and calls Vertex AI
# Gemini in two phases: extract job metadata, then score the resume.
#
# Key Responsibilities
# - Fetch and clean HTML for URL-sourced job postings (BeautifulSoup)
# - Phase 1 Gemini call: extract job title, company name, and cleaned job text
# - Phase 2 Gemini call: score resume 0-100 with strengths/weaknesses analysis
# - Write all artifacts (job description, analysis) to GCS
# - Update Firestore job document with final score and status
# ================================================================================

import base64
import json
import logging
import os
import socket
import time
import urllib.error
import urllib.request

import functions_framework
import vertexai
from bs4 import BeautifulSoup
from google.cloud import firestore, storage
from vertexai.generative_models import GenerationConfig, GenerativeModel

logger = logging.getLogger(__name__)

PROJECT_ID      = os.environ["GOOGLE_CLOUD_PROJECT"]
MEDIA_BUCKET    = os.environ["MEDIA_BUCKET_NAME"]
GEMINI_MODEL_ID = os.environ["GEMINI_MODEL_ID"]
REGION          = "global"

vertexai.init(project=PROJECT_ID, location=REGION)
# temperature=0 eliminates sampling randomness — scores become deterministic
model = GenerativeModel(
    GEMINI_MODEL_ID,
    generation_config=GenerationConfig(temperature=0),
)
db     = firestore.Client(project=PROJECT_ID)
gcs    = storage.Client(project=PROJECT_ID)
bucket = gcs.bucket(MEDIA_BUCKET)


# ================================================================================
# Prompts
# ================================================================================

_EXTRACTION_PROMPT = """\
Extract structured information from the job posting below.

Return ONLY valid JSON (no markdown fences) in this exact format:
{{
  "job_title":    "<short title, e.g. Senior Software Engineer>",
  "company_name": "<company name only, e.g. Acme Corp>",
  "job_text":     "<cleaned job description, max 3000 words — remove boilerplate, \
benefits, legal text>"
}}

Job posting:
---
{job_posting}
---
"""

_SCORING_PROMPT = """\
You are an expert resume reviewer. Score the resume against the job description \
on a scale of 0–100 and provide analysis.

Scoring guide:
  90–100  Exceptional match — nearly all requirements met
  70–89   Strong match — most requirements met, minor gaps
  50–69   Moderate match — some relevant experience, notable gaps
  30–49   Weak match — limited relevant experience, significant gaps
  0–29    Poor match — little to no relevant experience

Return ONLY valid JSON (no markdown fences) in this exact format:
{{
  "score":      <integer 0-100>,
  "strengths":  ["<strength 1>", "<strength 2>", "<strength 3>"],
  "weaknesses": ["<gap 1>", "<gap 2>", "<gap 3>"],
  "summary":    "<2-3 sentence overall assessment>"
}}

Job Title:   {job_title}
Company:     {company_name}

Job Description:
---
{job_text}
---

Resume:
---
{resume_text}
---
"""

# Variant for raw_text — no pre-extracted title/company, so ask Gemini to
# pull them from the description as part of the single scoring call.
_SCORING_PROMPT_RAW = """\
You are an expert resume reviewer. Score the resume against the job description \
on a scale of 0–100 and provide analysis. Also extract the job title and \
company name from the job description.

Scoring guide:
  90–100  Exceptional match — nearly all requirements met
  70–89   Strong match — most requirements met, minor gaps
  50–69   Moderate match — some relevant experience, notable gaps
  30–49   Weak match — limited relevant experience, significant gaps
  0–29    Poor match — little to no relevant experience

Return ONLY valid JSON (no markdown fences) in this exact format:
{{
  "job_title":   "<short job title, e.g. Senior Software Engineer>",
  "company_name": "<company name only, e.g. Acme Corp>",
  "score":       <integer 0-100>,
  "strengths":   ["<strength 1>", "<strength 2>", "<strength 3>"],
  "weaknesses":  ["<gap 1>", "<gap 2>", "<gap 3>"],
  "summary":     "<2-3 sentence overall assessment>"
}}

Job Description:
---
{job_text}
---

Resume:
---
{resume_text}
---
"""


# ================================================================================
# Helpers
# ================================================================================

# Job boards rate-limit by source IP, and Cloud Run fans this function out
# across instances that all egress from Google ranges.  Three jobs submitted
# together produced simultaneous fetches of the same posting and LinkedIn
# answered 429 (2026-08-30).  Retrying here keeps a transient limit inside one
# invocation: the alternative is raising, which makes Pub/Sub redeliver and
# re-run the whole job -- including both Gemini calls for a job that only
# failed on the fetch.
# Half the delay _call_gemini uses (10/20/40): a web fetch that is going to
# recover does so sooner than a model quota window resets, and a long sleep
# here just holds the instance open against Pub/Sub's ack deadline.
FETCH_ATTEMPTS = 4
FETCH_BACKOFF  = 5          # seconds; doubles each attempt (5, 10, 20)

# 429 and 5xx are worth waiting out.  A 404 or 403 will not improve with time,
# so those fail immediately rather than burning 30s to reach the same answer.
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


def is_transient(exc):
    """Return True when retrying exc has a realistic chance of succeeding.

    Args:
        exc: The exception raised while processing a job.

    Returns:
        bool: True for rate limits, server errors and network timeouts.
    """
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code in RETRYABLE_STATUS
    if isinstance(exc, (urllib.error.URLError, TimeoutError, socket.timeout)):
        return True
    # Vertex surfaces throttling as a google.api_core error whose text leads
    # with the status code; match on that rather than importing the class.
    return "429" in str(exc) or "503" in str(exc)


def _fetch_url(url):
    """Fetch a URL and return visible text with scripts/styles stripped.

    Args:
        url: The job posting URL to retrieve.

    Returns:
        str: Visible page text, truncated to 50k characters.

    Raises:
        urllib.error.HTTPError: On a non-retryable status, or once the
            retryable attempts are exhausted.
    """
    req  = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    html = None

    for attempt in range(FETCH_ATTEMPTS):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                html = resp.read().decode("utf-8", errors="replace")
            break
        except urllib.error.HTTPError as exc:
            last = attempt == FETCH_ATTEMPTS - 1
            if exc.code not in RETRYABLE_STATUS or last:
                raise
            wait = FETCH_BACKOFF * (2 ** attempt)
            logger.warning(
                "Fetch of %s returned %s — retrying in %ss (%d/%d)",
                url, exc.code, wait, attempt + 1, FETCH_ATTEMPTS,
            )
            time.sleep(wait)

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()
    return soup.get_text(separator="\n", strip=True)[:50000]


def _call_gemini(prompt):
    """Call Gemini with exponential backoff retry on 429 rate limit errors.

    Returns:
        Tuple of (response_text, total_token_count).
    """
    for attempt in range(4):
        try:
            resp   = model.generate_content(prompt)
            tokens = getattr(resp.usage_metadata, "total_token_count", 0) or 0
            return resp.text.strip(), tokens
        except Exception as exc:
            if "429" in str(exc) and attempt < 3:
                wait = 10 * (2 ** attempt)
                logger.warning("Gemini rate limited, retrying in %ss...", wait)
                time.sleep(wait)
            else:
                raise


def _parse_json(raw):
    """Parse JSON from Gemini response, stripping markdown fences if present."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        cleaned = raw.lstrip("```json").lstrip("```").rstrip("```").strip()
        return json.loads(cleaned)


def _update_job(owner, job_id, updates):
    """Update a Firestore job document."""
    db.collection("resume_app_jobs").document(f"{owner}_{job_id}").update(updates)


def _increment_tokens(owner, tokens):
    """Atomically add tokens to the user's lifetime usage counter.

    Uses merge=True so the document is created on first write without
    overwriting an existing token_limit set by an admin.
    """
    db.collection("resume_app_users").document(owner).set(
        {"tokens_used": firestore.Increment(tokens)},
        merge=True,
    )


# ================================================================================
# Core Processing
# ================================================================================

def _process_message(data):
    """Process one job scoring message end-to-end."""
    job_id      = data["job_id"]
    owner       = data["owner"]
    source_type = data.get("source_type", "url")
    source_url  = data.get("source_url", "")

    logger.info("Processing job %s for owner %s", job_id, owner)
    _update_job(owner, job_id, {"status": "Scoring"})

    base = f"users/{owner}/jobs/{job_id}"

    # Load resume snapshot saved by the API at submission time
    resume_text = bucket.blob(f"{base}/resume_snapshot.txt").download_as_text()

    # Obtain raw job text — fetch URL or read pre-saved raw text from GCS
    if source_type == "url":
        raw_job_text = _fetch_url(source_url)
    else:
        raw_job_text = bucket.blob(f"{base}/job_description.txt").download_as_text()

    # ------------------------------------------------------------------------
    # Phase 1: Extract job metadata and clean description
    # Skipped for raw_text — user-supplied text needs no cleaning, and
    # title/company are unknown without a structured source to parse from.
    # ------------------------------------------------------------------------
    if source_type == "raw_text":
        job_title    = ""
        company_name = ""
        job_text     = raw_job_text[:20000]
        tokens1      = 0
    else:
        extraction_raw, tokens1 = _call_gemini(
            _EXTRACTION_PROMPT.format(job_posting=raw_job_text[:20000])
        )
        extraction = _parse_json(extraction_raw)
        job_title    = extraction.get("job_title", "")
        company_name = extraction.get("company_name", "")
        job_text     = extraction.get("job_text", raw_job_text[:20000])

        # Overwrite job_description.txt with the cleaned Gemini-extracted text
        bucket.blob(f"{base}/job_description.txt").upload_from_string(
            job_text, content_type="text/plain"
        )

    # ------------------------------------------------------------------------
    # Phase 2: Score resume against job
    # raw_text uses a combined prompt that extracts title/company in one call.
    # ------------------------------------------------------------------------
    if source_type == "raw_text":
        scoring_raw, tokens2 = _call_gemini(_SCORING_PROMPT_RAW.format(
            job_text=job_text[:10000],
            resume_text=resume_text[:10000],
        ))
    else:
        scoring_raw, tokens2 = _call_gemini(_SCORING_PROMPT.format(
            job_title=job_title,
            company_name=company_name,
            job_text=job_text[:10000],
            resume_text=resume_text[:10000],
        ))
    scoring = _parse_json(scoring_raw)
    if source_type == "raw_text":
        job_title    = scoring.get("job_title", "")
        company_name = scoring.get("company_name", "")
    score     = int(scoring.get("score", 0))
    strengths = scoring.get("strengths", [])
    weaknesses = scoring.get("weaknesses", [])
    summary   = scoring.get("summary", "")

    analysis_text = "\n".join([
        f"Score: {score}/100",
        f"Job Title: {job_title}",
        f"Company: {company_name}",
        "",
        "Summary:",
        summary,
        "",
        "Strengths:",
        *[f"- {s}" for s in strengths],
        "",
        "Weaknesses:",
        *[f"- {w}" for w in weaknesses],
    ])
    bucket.blob(f"{base}/job_analysis.txt").upload_from_string(
        analysis_text, content_type="text/plain"
    )

    _update_job(owner, job_id, {
        "status":       "Scored",
        "job_title":    job_title,
        "company_name": company_name,
        "score":        score,
    })

    # Record token consumption for both Gemini phases against the user's cap
    total_tokens = tokens1 + tokens2
    _increment_tokens(owner, total_tokens)
    logger.info("Job %s scored: %d/100 (%d tokens)", job_id, score, total_tokens)


# ================================================================================
# Entry Point
# ================================================================================

@functions_framework.cloud_event
def resume_worker(cloud_event):
    """Decode the Pub/Sub message and process the scoring job."""
    pubsub_data = base64.b64decode(
        cloud_event.data["message"]["data"]
    ).decode("utf-8")
    data   = json.loads(pubsub_data)
    job_id = data.get("job_id", "unknown")
    owner  = data.get("owner", "unknown")

    try:
        _process_message(data)
    except Exception as exc:
        logger.exception("Failed to process job %s: %s", job_id, exc)
        try:
            _update_job(owner, job_id, {
                "status":        "Failed",
                "error_message": str(exc)[:500],
            })
        except Exception:
            pass

        # Only re-raise what a retry could actually fix.  The trigger is set to
        # RETRY_POLICY_RETRY, so raising here makes Pub/Sub redeliver -- and
        # raising unconditionally meant a permanently bad URL was retried until
        # the message aged out, while a rate-limited fetch generated a burst of
        # redeliveries that sustained the very limit that caused it.  Anything
        # non-transient is recorded as Failed and acked by returning normally.
        if is_transient(exc):
            raise

        logger.error(
            "Job %s failed permanently (%s) — not retrying",
            job_id, type(exc).__name__,
        )
