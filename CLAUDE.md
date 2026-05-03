# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working
with code in this repository.

## What This App Does

AWS-based Resume Scoring Application. Users upload resumes and submit
job postings (URL or raw text); the app uses AWS Bedrock (Claude Sonnet)
to score resume-to-job compatibility (0--100) asynchronously.

## Deployment Commands

All deployment runs from the repo root:

``` bash
./apply.sh      # Full deploy: installs Python deps, runs Terraform, uploads frontend to S3
./destroy.sh    # Tear down entire stack
./check_env.sh  # Validate required tools: aws, terraform, jq
./validate.sh   # Post-deploy validation (partially implemented)
```

Python dependencies are installed into the Lambda source directory
directly:

``` bash
cd 01-core/code && pip install -r requirements.txt -t .
```

There are no test or lint commands configured.

## Architecture

    01-core/           # Backend: Terraform IaC + Python Lambda source
      code/            # Lambda functions (Python)
      *.tf             # Terraform files
    02-webapp/         # Frontend: vanilla JS SPA, deployed to S3
      js/config.js.tmpl  # Config template populated by apply.sh at deploy time

### Request Flow

**Resume upload:** POST /resumes → API Lambda → S3 (text) + DynamoDB
(metadata)

**Job scoring:**

1.  POST /jobs → API Lambda → copies resume snapshot to S3, sends SQS
    message → returns job with `submitted` status
2.  Worker Lambda (SQS trigger) → fetches URL if needed → Bedrock for
    field extraction → Bedrock for score → saves analysis to S3 →
    updates DynamoDB with score and `Scored` status
3.  Frontend polls GET /jobs periodically to show updated scores

### Lambda Functions

-   **`code/handler.py`** --- API Lambda entry point; routes to
    `jobs.py` or `resumes.py`
-   **`code/worker.py`** --- Worker Lambda; SQS-triggered scoring
    pipeline using Bedrock
-   **`code/jobs.py`** --- Job CRUD logic
-   **`code/resumes.py`** --- Resume CRUD logic

### Data Model (DynamoDB single-table)

-   `pk`: `USER#<user_id>`, `sk`: `RESUME#<id>` or `JOB#<id>`

### S3 Layout (backend bucket)

    users/USER#{id}/resumes/RESUME#{id}.txt
    users/USER#{id}/jobs/JOB#{id}/job_description.txt
    users/USER#{id}/jobs/JOB#{id}/resume_snapshot.txt
    users/USER#{id}/jobs/JOB#{id}/job_analysis.txt
    users/USER#{id}/jobs/JOB#{id}/notes.txt

### Key Terraform Variables (`01-core/variables.tf`)

-   `region` --- default `us-east-1`
-   `bedrock_model_id` --- default
    `us.anthropic.claude-sonnet-4-5-20250929-v1:0`
-   `frontend_bucket_base_name` / `backend_bucket_base_name`

### Authentication

Cognito User Pool with hosted UI, OAuth2 authorization code flow. All
API routes require JWT Bearer token. Tokens stored in `localStorage` on
the frontend.

### Frontend Config

`02-webapp/js/config.js.tmpl` is a template --- `apply.sh` substitutes
`API_BASE_URL`, `COGNITO_DOMAIN`, and `COGNITO_CLIENT_ID` at deploy time
to produce `config.js`. Never edit `config.js` directly.

## Code Commenting Standards

Claude should apply consistent, professional commenting when modifying
code.

### General Rules

-   Keep comment lines **≤ 80 characters**
-   Do **not change code behavior**
-   Preserve existing variable names and structure
-   Comments should explain **intent**, not restate obvious code
-   Prefer concise, structured comments

### Python Files

Modules should begin with a structured header:

```python
# ================================================================================
# Module Name
#
# Purpose
# Brief explanation of what this module does.
#
# Key Responsibilities
# - Responsibility 1
# - Responsibility 2
# ================================================================================
```

Functions should include a short structured description:

```python
# --------------------------------------------------------------------------------
# Function: function_name
#
# Purpose
# Explain what the function does.
#
# Arguments
# - arg_name : description
#
# Returns
# - description
# --------------------------------------------------------------------------------
```

### Terraform Files

Use section banners to describe infrastructure blocks:

```hcl
# ================================================================================
# Section Name
# Description of resources created in this block
# ================================================================================
```

Comments should explain **why infrastructure exists**, not repeat the
resource definition.

### JavaScript Files

- Keep comment lines <= 80 characters
- Do not change UI behavior unless explicitly asked
- Preserve existing function names, IDs, and DOM structure
- Prefer concise section banners for major areas
- Use comments to explain intent, data flow, and UI behavior
- Do not add noisy comments for obvious one-line DOM operations
- Keep comments professional and compact
- Prefer small, reviewable diffs

Use section banners like:

```javascript
/* ================================================================================ */
/* Section Name */
/* Purpose of this section */
/* ================================================================================ */
```

For functions, use short block comments when helpful:

```javascript
/* -------------------------------------------------------------------------------- */
/* Function: functionName                                                            */
/* Purpose: Explain what this function does                                         */
/* -------------------------------------------------------------------------------- */
```

### Shell Scripts

- Keep comment lines <= 80 characters
- Preserve strict bash style: set -euo pipefail
- Use your quick start comment style
- Prefer bannered sections for each major operation
- Explain why a command block exists, not what obvious flags do
- Keep comments concise and operational
- Do not rewrite working command structure unless explicitly asked
- Preserve variable names unless a rename is necessary
- Prefer readable step-by-step execution flow
- Keep scripts idempotent where possible

Scripts should use section banners like:

```bash
# ================================================================================
# Section Name
# Purpose of this block
# ================================================================================
```

For smaller subsections:

```bash
# --------------------------------------------------------------------------------
# Subsection Name
# Brief operational note
# --------------------------------------------------------------------------------
```