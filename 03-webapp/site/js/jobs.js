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

// Multi-select state
let selectedJobIds    = new Set();
let bulkHandlersBound = false;

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function loadJobs() {
  jobs = await listJobs();
  sortJobs();
  renderJobsTable();
  bindSortHandlers();
  bindBulkHandlers();
}

export function setFolderFilter(folderId) { filterFolderId = folderId || ""; selectedJobIds.clear(); }
export function setStatusFilter(status)   { filterStatus   = status   || ""; selectedJobIds.clear(); }
export function setSearchFilter(text)     { filterSearch   = text     || ""; selectedJobIds.clear(); }

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
    const row     = document.createElement("tr");
    const checked = selectedJobIds.has(job.job_id) ? "checked" : "";
    row.innerHTML = `
      <td class="checkbox-cell">
        <input type="checkbox" class="job-checkbox"
          data-job-id="${escapeHtml(job.job_id)}" ${checked}>
      </td>
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
  bindCheckboxHandlers(visible);
  updateBulkActionBar();
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
        selectedJobIds.delete(jobId);
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
// Checkbox / Multi-select
// -----------------------------------------------------------------------------

/* -------------------------------------------------------------------------- */
/* Function: bindCheckboxHandlers                                              */
/* Purpose: Wire per-row checkboxes and refresh the master checkbox state.    */
/*          The master checkbox is cloned each render to avoid duplicate      */
/*          listeners accumulating across table refreshes.                    */
/* -------------------------------------------------------------------------- */
function bindCheckboxHandlers(visible) {
  const master = document.getElementById("select-all-jobs");
  if (master) {
    const allChecked  = visible.length > 0 && visible.every((j) => selectedJobIds.has(j.job_id));
    const someChecked = visible.some((j) => selectedJobIds.has(j.job_id));
    const fresh = master.cloneNode(true);
    fresh.checked       = allChecked;
    fresh.indeterminate = someChecked && !allChecked;
    master.replaceWith(fresh);
    fresh.addEventListener("change", () => {
      const vis = filteredJobs();
      if (fresh.checked) vis.forEach((j) => selectedJobIds.add(j.job_id));
      else               vis.forEach((j) => selectedJobIds.delete(j.job_id));
      renderJobsTable();
    });
  }

  document.querySelectorAll(".job-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedJobIds.add(cb.dataset.jobId);
      else            selectedJobIds.delete(cb.dataset.jobId);
      updateBulkActionBar();
      // Sync master checkbox without re-rendering the whole table
      const vis    = filteredJobs();
      const m      = document.getElementById("select-all-jobs");
      if (m) {
        const all  = vis.length > 0 && vis.every((j) => selectedJobIds.has(j.job_id));
        const some = vis.some((j) => selectedJobIds.has(j.job_id));
        m.checked       = all;
        m.indeterminate = some && !all;
      }
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Function: updateBulkActionBar                                               */
/* Purpose: Show or hide the bulk action bar and sync the folder picker from  */
/*          the main folder dropdown (single source of truth for folder list).*/
/* -------------------------------------------------------------------------- */
function updateBulkActionBar() {
  const bar   = document.getElementById("bulk-action-bar");
  const label = document.getElementById("bulk-count");
  const n     = selectedJobIds.size;
  if (!bar) return;
  if (n === 0) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  if (label) label.textContent = `${n} job${n === 1 ? "" : "s"} selected`;
  populateBulkFolderSelect();
}

function populateBulkFolderSelect() {
  const bulk   = document.getElementById("bulk-folder-select");
  const source = document.getElementById("folder-select");
  if (!bulk || !source) return;
  bulk.innerHTML = `<option value="">— Unassigned —</option>`;
  Array.from(source.options).forEach((opt) => {
    if (!opt.value) return;
    const o = document.createElement("option");
    o.value = opt.value; o.textContent = opt.textContent;
    bulk.appendChild(o);
  });
}

/* -------------------------------------------------------------------------- */
/* Function: bindBulkHandlers                                                  */
/* Purpose: Wire the Delete Selected and Move buttons once on first load.     */
/* -------------------------------------------------------------------------- */
function bindBulkHandlers() {
  if (bulkHandlersBound) return;

  document.getElementById("btn-bulk-delete")?.addEventListener("click", async () => {
    const ids = [...selectedJobIds];
    if (!ids.length) return;
    const n = ids.length;
    if (!window.confirm(`Delete ${n} job${n === 1 ? "" : "s"} and all stored data?`)) return;
    const btn = document.getElementById("btn-bulk-delete");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Deleting..."; }
      for (const jobId of ids) {
        await deleteJob(jobId);
        jobs = jobs.filter((j) => j.job_id !== jobId);
        selectedJobIds.delete(jobId);
      }
      renderJobsTable();
    } catch (error) {
      window.alert(`Delete failed: ${error.message}`);
      renderJobsTable();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Delete Selected"; }
    }
  });

  document.getElementById("btn-bulk-move")?.addEventListener("click", async () => {
    const ids      = [...selectedJobIds];
    const folderId = document.getElementById("bulk-folder-select")?.value || null;
    if (!ids.length) return;
    const btn = document.getElementById("btn-bulk-move");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Moving..."; }
      for (const jobId of ids) {
        await moveJobToFolder(jobId, folderId);
        const job = jobs.find((j) => j.job_id === jobId);
        if (job) job.folder_id = folderId || "";
      }
      selectedJobIds.clear();
      renderJobsTable();
    } catch (error) {
      window.alert(`Move failed: ${error.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Move"; }
    }
  });

  bulkHandlersBound = true;
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
