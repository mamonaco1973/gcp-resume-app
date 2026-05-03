/* ========================================================================== */
/* job.js                                                                      */
/* Job detail page: loads a single job record by URL query param and renders  */
/* all fields. Also handles inline notes saving.                               */
/* ========================================================================== */

import { getJob, updateJobNotes } from "./api.js";

document.addEventListener("DOMContentLoaded", async () => {
  const jobId = getJobIdFromUrl();

  if (!jobId) {
    renderError("Missing job ID.");
    return;
  }

  bindNotesHandler(jobId);

  try {
    const job = await getJob(jobId);
    renderJob(job);
  } catch (error) {
    renderError(`Failed to load job: ${error.message}`);
  }
});

/* -------------------------------------------------------------------------- */
/* Function: getJobIdFromUrl                                                   */
/* Purpose: Read the job ID from the "id" query parameter of the current URL. */
/* -------------------------------------------------------------------------- */
function getJobIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id")?.trim() || "";
}

/* -------------------------------------------------------------------------- */
/* Function: renderJob                                                         */
/* Purpose: Populate every field in the job detail view from the API response */
/*          object, then reveal the content panel and hide the loading state. */
/* -------------------------------------------------------------------------- */
function renderJob(job) {
  setText("job-title", job.job_title || "—");
  setText("job-company", job.company || "—");
  setText("job-status", job.status || "—");
  setText("job-status-message", job.status_message || "—");
  setText("job-score", formatScore(job.score));
  setText("job-scored-at", formatDate(job.created_at));
  setText("job-source-type", job.source_type || "—");

  renderJobUrl(job.job_url);
  renderTextBlock("job-analysis", job.job_analysis);
  renderTextBlock("job-description", job.job_description);
  renderTextBlock("job-resume", job.resume_snapshot);
  renderJobNotes(job.notes || "");

  document.getElementById("job-detail-loading")?.classList.add("hidden");
  document.getElementById("job-detail-content")?.classList.remove("hidden");
}

/* -------------------------------------------------------------------------- */
/* Function: renderJobUrl                                                      */
/* Purpose: Render the job URL as a safe anchor tag, or a dash if absent.     */
/* -------------------------------------------------------------------------- */
function renderJobUrl(value) {
  const element = document.getElementById("job-url");

  if (!element) {
    return;
  }

  if (!value) {
    element.textContent = "—";
    return;
  }

  element.innerHTML = `
    <a
      href="${escapeHtml(value)}"
      target="_blank"
      rel="noopener noreferrer"
    >
      ${escapeHtml(value)}
    </a>
  `;
}

/* -------------------------------------------------------------------------- */
/* Function: renderTextBlock                                                   */
/* Purpose: Set the text content of an element to the trimmed value, or a    */
/*          dash placeholder if the value is empty or absent.                 */
/* -------------------------------------------------------------------------- */
function renderTextBlock(elementId, value) {
  const element = document.getElementById(elementId);

  if (!element) {
    return;
  }

  const text = String(value || "").trim();

  if (!text) {
    element.textContent = "—";
    return;
  }

  element.textContent = text;
}

function renderJobNotes(value) {
  const element = document.getElementById("job-notes");

  if (!element) {
    return;
  }

  element.value = value;
}

/* -------------------------------------------------------------------------- */
/* Function: bindNotesHandler                                                  */
/* Purpose: Wire the "Update Notes" button to save the textarea value via     */
/*          the API and display inline success or error feedback.             */
/* -------------------------------------------------------------------------- */
function bindNotesHandler(jobId) {
  const button = document.getElementById("update-job-notes-btn");
  const textarea = document.getElementById("job-notes");

  if (!button || !textarea) {
    return;
  }

  button.addEventListener("click", async () => {
    clearNotesMessages();

    const notes = textarea.value;

    button.disabled = true;
    button.textContent = "Updating...";

    try {
      await updateJobNotes(jobId, notes);
      showNotesSuccess("Notes updated.");
    } catch (error) {
      showNotesError(`Failed to update notes: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = "Update Notes";
    }
  });
}

function clearNotesMessages() {
  const errorElement = document.getElementById("job-notes-error");
  const successElement = document.getElementById("job-notes-success");

  if (errorElement) {
    errorElement.textContent = "";
    errorElement.classList.add("hidden");
  }

  if (successElement) {
    successElement.textContent = "";
    successElement.classList.add("hidden");
  }
}

/* -------------------------------------------------------------------------- */
/* Function: showNotesError                                                    */
/* Purpose: Display an inline error message below the notes field. Falls back */
/*          to window.alert if the error element is missing.                  */
/* -------------------------------------------------------------------------- */
function showNotesError(message) {
  const element = document.getElementById("job-notes-error");

  if (!element) {
    window.alert(message);
    return;
  }

  element.textContent = message;
  element.classList.remove("hidden");
}

/* -------------------------------------------------------------------------- */
/* Function: showNotesSuccess                                                  */
/* Purpose: Display an inline success message below the notes field.          */
/* -------------------------------------------------------------------------- */
function showNotesSuccess(message) {
  const element = document.getElementById("job-notes-success");

  if (!element) {
    return;
  }

  element.textContent = message;
  element.classList.remove("hidden");
}

function formatScore(score) {
  return score == null ? "—" : String(score);
}

function setText(elementId, value) {
  const element = document.getElementById(elementId);

  if (!element) {
    return;
  }

  element.textContent = value;
}

/* -------------------------------------------------------------------------- */
/* Function: renderError                                                       */
/* Purpose: Show a page-level error and hide the loading state. Falls back to */
/*          window.alert if the error container element is missing.           */
/* -------------------------------------------------------------------------- */
function renderError(message) {
  document.getElementById("job-detail-loading")?.classList.add("hidden");

  const errorElement = document.getElementById("job-detail-error");

  if (!errorElement) {
    window.alert(message);
    return;
  }

  errorElement.textContent = message;
  errorElement.classList.remove("hidden");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) {
    return "—";
  }

  try {
    const date = new Date(value);
    return date.toLocaleString();
  } catch {
    return value;
  }
}