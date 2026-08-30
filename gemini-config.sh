#!/usr/bin/env bash
# ================================================================================
# gemini-config.sh
# Single source of truth for the Vertex AI Gemini model used by the worker.
# Sourced by apply.sh, destroy.sh, and check_env.sh so all scripts agree.
# ================================================================================
# gemini-2.5-flash retires on Vertex 2026-10-16 and the rest of the 2.5 family
# follows it, so this moved off 2.5-flash-lite before the deadline rather than
# during an outage. 3.1 Flash-Lite is the same tier: cheapest, lowest latency,
# built for high-volume calls, which is what resume scoring is.
#
# Confirm the id actually resolves for your project before deploying:
#     ./probe_vertex.py --check "$GEMINI_MODEL_ID"
export GEMINI_MODEL_ID="gemini-3.1-flash-lite"
