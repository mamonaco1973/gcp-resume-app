/* ========================================================================== */
/* jobs.js                                                                     */
/* Fetches the job list, renders the jobs table, and handles column sorting   */
/* and per-row deletion. Exported loadJobs() is the public entry point.       */
/* ========================================================================== */

import { deleteJob, listJobs, moveJobToFolder } from "./api.js";

let jobs = [];
let currentSort = {
  field:     "created_at",
  direction: "desc"
};

// Active filter state — set by app.js via the exported setters below
let filterFolderId = "";   // "" = All Jobs
let filterStatus   = "";   // "" = All statuses
let filterSearch   = "";   // "" = no text search

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function loadJobs() {
  jobs = await listJobs();
  sortJobs();
  renderJobsTable();
  bindSortHandlers();
}

export function setFolderFilter(folderId) { filterFolderId = folderId || ""; }
export function setStatusFilter(status)   { filterStatus   = status   || ""; }
export function setSearchFilter(text)     { filterSearch   = text     || ""; }

// Returns true if any job is still being processed, so the dashboard
// knows to keep polling.
export function hasPendingJobs() {
  return jobs.some(
    (job) => job.status === "submitted" || job.status === "Scoring"
  );
}

// -----------------------------------------------------------------------------
// Sorting
// -----------------------------------------------------------------------------

function bindSortHandlers() {
  const headers = document.querySelectorAll("th[data-sort]");
  headers.forEach((header) => {
    if (header.dataset.bound === "true") return;
    header.addEventListener("click", () => {
      const field = header.dataset.sort;
      if (currentSort.field === field) {
        currentSort.direction = currentSort.direction === "asc" ? "desc" : "asc";
      } else {
        currentSort.field     = field;
        currentSort.direction = "asc";
      }
      sortJobs();
      renderJobsTable();
    });
    header.dataset.bound = "true";
  });
}

/* -------------------------------------------------------------------------- */
/* Function: sortJobs                                                          */
/* Purpose: Sort the jobs array in place using currentSort field/direction.   */
/* -------------------------------------------------------------------------- */
function sortJobs() {
  const { field, direction } = currentSort;
  jobs.sort((a, b) => {
    const aVal = normalizeSortValue(a[field], field);
    const bVal = normalizeSortValue(b[field], field);
    if (aVal < bVal) return direction === "asc" ? -1 : 1;
    if (aVal > bVal) return direction === "asc" ?  1 : -1;
    return 0;
  });
}

/* -------------------------------------------------------------------------- */
/* Function: normalizeSortValue                                                */
/* Purpose: Coerce a field value into a type-appropriate form for comparison. */
/*          API returns timestamps in milliseconds, so new Date() is correct. */
/* -------------------------------------------------------------------------- */
function normalizeSortValue(value, field) {
  if (field === "score") {
    return value == null ? -1 : Number(value);
  }
  if (field === "created_at" || field === "updated_at") {
    return value ? new Date(value).getTime() : 0;
  }
  return (value || "").toString().toLowerCase();
}

// -----------------------------------------------------------------------------
// Filtering
// -----------------------------------------------------------------------------

/* -------------------------------------------------------------------------- */
/* Function: filteredJobs                                                      */
/* Purpose: Apply active folder, status, and search filters to the full       */
/*          jobs array. All filtering is client-side; the API returns all.    */
/* -------------------------------------------------------------------------- */
function filteredJobs() {
  const term = filterSearch.toLowerCase();
  return jobs.filter((job) => {
    if (filterFolderId) {
      if ((job.folder_id || "") !== filterFolderId) return false;
    }
    if (filterStatus) {
      if ((job.status || "").toLowerCase() !== filterStatus.toLowerCase()) {
        return false;
      }
    }
    if (term) {
      const title   = (job.job_title || "").toLowerCase();
      const company = (job.company   || "").toLowerCase();
      if (!title.includes(term) && !company.includes(term)) return false;
    }
    return true;
  });
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

function renderJobsTable() {
  const tbody      = document.getElementById("jobs-body");
  const emptyState = document.getElementById("empty-state");
  const table      = document.getElementById("jobs-table");

  tbody.innerHTML = "";

  const visible = filteredJobs();

  if (!visible.length) {
    table.classList.add("hidden");
    emptyState.classList.remove("hidden");
    emptyState.innerHTML = jobs.length
      ? "<p>No jobs match the current filters.</p>"
      : "<p>No jobs submitted yet.</p><p>Click <b>Score New Job</b> to begin.</p>";
    return;
  }

  table.classList.remove("hidden");
  emptyState.classList.add("hidden");

  visible.forEach((job) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(job.job_title || "—")}</td>
      <td>${escapeHtml(job.company  || "—")}</td>
      <td>${renderStatus(job.status)}</td>
      <td>${formatScore(job.score)}</td>
      <td>${formatDate(job.created_at)}</td>
      <td class="row-actions">
        <button type="button" class="open-job-btn"
          data-job-id="${escapeHtml(job.job_id)}">Open</button>
        <button type="button" class="move-job-btn"
          data-job-id="${escapeHtml(job.job_id)}"
          data-folder-id="${escapeHtml(job.folder_id || "")}">Move</button>
        <button type="button" class="delete-job-btn"
          data-job-id="${escapeHtml(job.job_id)}">Delete</button>
      </td>
    `;
    tbody.appendChild(row);
  });

  bindOpenHandlers();
  bindMoveHandlers();
  bindDeleteHandlers();
}

function renderStatus(status) {
  const label = escapeHtml(status || "unknown");
  return `<span class="status-badge status-${label}">${label}</span>`;
}

function formatScore(score) {
  return score == null ? "—" : score;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

// -----------------------------------------------------------------------------
// Open actions
// -----------------------------------------------------------------------------

function bindOpenHandlers() {
  document.querySelectorAll(".open-job-btn").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.addEventListener("click", () => {
      const jobId = button.dataset.jobId;
      if (jobId) window.open(`job.html?id=${encodeURIComponent(jobId)}`, jobId);
    });
    button.dataset.bound = "true";
  });
}

// -----------------------------------------------------------------------------
// Move actions
// -----------------------------------------------------------------------------

/* -------------------------------------------------------------------------- */
/* Function: bindMoveHandlers                                                  */
/* Purpose: Wire each Move button to swap itself for an inline folder picker, */
/*          call the API on change, then restore the button on cancel.        */
/* -------------------------------------------------------------------------- */
function bindMoveHandlers() {
  document.querySelectorAll(".move-job-btn").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.addEventListener("click", () => {
      const jobId          = button.dataset.jobId;
      const currentFolder  = button.dataset.folderId || "";

      // Build a temporary inline <select> from the filter bar's folder options
      const folderSelect  = document.getElementById("folder-select");
      const inlineSelect  = document.createElement("select");
      inlineSelect.className = "move-folder-select";

      // "Unassigned" is the first option (value = "")
      const unassigned = document.createElement("option");
      unassigned.value       = "";
      unassigned.textContent = "— Unassigned —";
      inlineSelect.appendChild(unassigned);

      if (folderSelect) {
        Array.from(folderSelect.options).forEach((opt) => {
          if (!opt.value) return; // skip the "All Jobs" option
          const o = document.createElement("option");
          o.value       = opt.value;
          o.textContent = opt.textContent;
          inlineSelect.appendChild(o);
        });
      }
      inlineSelect.value = currentFolder;

      // Cancel button restores the Move button
      const cancelBtn = document.createElement("button");
      cancelBtn.type        = "button";
      cancelBtn.textContent = "✕";
      cancelBtn.className   = "move-cancel-btn";

      const wrapper = document.createElement("span");
      wrapper.className = "move-inline";
      wrapper.appendChild(inlineSelect);
      wrapper.appendChild(cancelBtn);

      button.replaceWith(wrapper);

      cancelBtn.addEventListener("click", () => wrapper.replaceWith(button));

      inlineSelect.addEventListener("change", async () => {
        const newFolderId = inlineSelect.value || null;
        try {
          inlineSelect.disabled = true;
          await moveJobToFolder(jobId, newFolderId);
          // Update in-memory record so filters reflect the change immediately
          const job = jobs.find((j) => j.job_id === jobId);
          if (job) job.folder_id = newFolderId || "";
          renderJobsTable();
        } catch (error) {
          window.alert(`Move failed: ${error.message}`);
          wrapper.replaceWith(button);
        }
      });
    });
    button.dataset.bound = "true";
  });
}

// -----------------------------------------------------------------------------
// Delete actions
// -----------------------------------------------------------------------------

function bindDeleteHandlers() {
  document.querySelectorAll(".delete-job-btn").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.addEventListener("click", async () => {
      const jobId = button.dataset.jobId;
      if (!jobId) return;
      if (!window.confirm("Delete this job and its stored data?")) return;

      const originalText = button.textContent;
      try {
        button.disabled    = true;
        button.textContent = "Deleting...";
        await deleteJob(jobId);
        jobs = jobs.filter((job) => job.job_id !== jobId);
        renderJobsTable();
      } catch (error) {
        window.alert(`Delete failed: ${error.message}`);
        button.disabled    = false;
        button.textContent = originalText;
      }
    });
    button.dataset.bound = "true";
  });
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
