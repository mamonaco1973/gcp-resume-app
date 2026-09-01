/* ========================================================================== */
/* api.js                                                                      */
/* HTTP client for the Resume Scorer backend API.                              */
/* Attaches a fresh Firebase ID token as a Bearer header on every request.   */
/* On 401 the session has genuinely ended, so sign out once and hand the     */
/* user back to sign-in. Redirecting unconditionally to index.html looped:   */
/* the dashboard IS index.html, so it reloaded, restored the session from    */
/* local persistence, re-called the API, and 401'd again forever.            */
/* ========================================================================== */

import { CONFIG }     from "./config.js";
import { getIdToken, signOut } from "./auth.js";

const API_BASE_URL = CONFIG.API_BASE_URL;

// -----------------------------------------------------------------------------
// Common request helper
// -----------------------------------------------------------------------------

async function buildHeaders() {
  const token = await getIdToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// -----------------------------------------------------------------------------
// Session termination
// -----------------------------------------------------------------------------
// Several requests are usually in flight at once, so every one of them sees the
// 401. The guard makes sign-out and navigation happen once instead of N times.
// On the dashboard we do not navigate at all: signOut() fires onAuthChange,
// which already shows the auth modal. Navigating there is what created the
// reload loop, since index.html is the page doing the redirecting.

let sessionEnded = false;

function onDashboard() {
  const path = window.location.pathname;
  return path.endsWith("/") || path.endsWith("/index.html");
}

async function endSession() {
  if (sessionEnded) return;
  sessionEnded = true;

  try {
    await signOut();
  } catch (error) {
    console.error("Sign-out after 401 failed:", error);
  }

  if (!onDashboard()) {
    window.location.href = "index.html";
  }
}

async function apiRequest(path, options = {}) {
  const headers  = await buildHeaders();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    await endSession();
    throw new Error("Your session has expired. Please sign in again.");
  }

  // Re-arm the guard: signing back in via the modal does not reload the page,
  // and a latched flag would stop the next expiry from signing out.
  sessionEnded = false;

  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return data;
}

// -----------------------------------------------------------------------------
// Keep-alive
// -----------------------------------------------------------------------------
// Deliberately bypasses apiRequest. That helper ends the session and throws on
// a 401, which is right for a user action and wrong for a background timer: an
// expired token would sign the user out from a tick they never asked for.
// Every failure is swallowed instead — a missed ping just means the next real
// request pays a cold start.
export async function heartbeat() {
  try {
    const token = await getIdToken();
    if (!token) return;
    await fetch(`${API_BASE_URL}/heartbeat`, {
      method:  "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (_) {
    /* Intentionally ignored — best-effort warmth, never user-visible. */
  }
}

// -----------------------------------------------------------------------------
// Jobs API
// -----------------------------------------------------------------------------

export async function listJobs() {
  return apiRequest("/jobs", { method: "GET" });
}

export async function getJob(jobId) {
  return apiRequest(`/jobs/${jobId}`, { method: "GET" });
}

export async function createJob(payload) {
  return apiRequest("/jobs", {
    method: "POST",
    body:   JSON.stringify(payload),
  });
}

export async function updateJobNotes(jobId, notes) {
  return apiRequest(`/jobs/${jobId}/notes`, {
    method: "PATCH",
    body:   JSON.stringify({ notes }),
  });
}

export async function deleteJob(jobId) {
  return apiRequest(`/jobs/${jobId}`, { method: "DELETE" });
}

// -----------------------------------------------------------------------------
// Folders API
// -----------------------------------------------------------------------------

export async function listFolders() {
  return apiRequest("/folders", { method: "GET" });
}

export async function createFolder(payload) {
  return apiRequest("/folders", {
    method: "POST",
    body:   JSON.stringify(payload),
  });
}

export async function deleteFolder(folderId) {
  return apiRequest(`/folders/${folderId}`, { method: "DELETE" });
}

export async function moveJobToFolder(jobId, folderId) {
  return apiRequest(`/jobs/${jobId}/folder`, {
    method: "PATCH",
    body:   JSON.stringify({ folder_id: folderId }),
  });
}

// -----------------------------------------------------------------------------
// Attachments API
// -----------------------------------------------------------------------------

export async function listAttachments(jobId) {
  return apiRequest(`/jobs/${jobId}/attachments`, { method: "GET" });
}

export async function uploadAttachment(jobId, filename, contentType, base64Data) {
  return apiRequest(`/jobs/${jobId}/attachments`, {
    method: "POST",
    body:   JSON.stringify({ filename, content_type: contentType, data: base64Data }),
  });
}

export async function downloadAttachment(jobId, attachmentId) {
  return apiRequest(`/jobs/${jobId}/attachments/${attachmentId}`, { method: "GET" });
}

export async function deleteAttachment(jobId, attachmentId) {
  return apiRequest(`/jobs/${jobId}/attachments/${attachmentId}`, { method: "DELETE" });
}

// -----------------------------------------------------------------------------
// Registration API
// -----------------------------------------------------------------------------

// Throws with message "user_limit_reached" when the user cap is full
export async function register() {
  return apiRequest("/register", { method: "POST", body: JSON.stringify({}) });
}

// -----------------------------------------------------------------------------
// Usage API
// -----------------------------------------------------------------------------

export async function getUsage() {
  return apiRequest("/usage", { method: "GET" });
}

// -----------------------------------------------------------------------------
// Resumes API
// -----------------------------------------------------------------------------

export async function listResumes() {
  return apiRequest("/resumes", { method: "GET" });
}

export async function getResume(resumeId) {
  return apiRequest(`/resumes/${resumeId}`, { method: "GET" });
}

export async function createResume(payload) {
  return apiRequest("/resumes", {
    method: "POST",
    body:   JSON.stringify(payload),
  });
}

export async function updateResume(resumeId, payload) {
  return apiRequest(`/resumes/${resumeId}`, {
    method: "PUT",
    body:   JSON.stringify(payload),
  });
}

export async function deleteResume(resumeId) {
  return apiRequest(`/resumes/${resumeId}`, { method: "DELETE" });
}
