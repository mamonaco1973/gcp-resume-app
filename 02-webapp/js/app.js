/* ========================================================================== */
/* app.js                                                                      */
/* Dashboard controller. Initializes auth state, wires up the new-job form,  */
/* resume selector, and job list on DOMContentLoaded.                         */
/* ========================================================================== */

import { createJob, listResumes } from "./api.js";
import { loadJobs, hasPendingJobs } from "./jobs.js";
import { bindResumeHandlers, openResumeManager } from "./resumes.js";
import { getLoginUrl, getLogoutUrl, isLoggedIn } from "./auth.js";

let lastSelectedResumeId = "";
let autoRefreshTimer = null;
let countdownInterval = null;
const AUTO_REFRESH_SECONDS = 5;

document.addEventListener("DOMContentLoaded", async () => {
  updateAuthButtons();
  bindUiHandlers();
  bindResumeHandlers();

  if (!isLoggedIn()) {
    showNotLoggedInMessage();
    return;
  }

  try {
    await refreshApp();
  } catch (error) {
    console.error("Failed to load dashboard:", error);
  }
});

/* -------------------------------------------------------------------------- */
/* Function: bindUiHandlers                                                    */
/* Purpose: Attach all event listeners for the dashboard: modal open/close,  */
/*          source type toggle, form submit, live validation, and auth        */
/*          buttons. Called once on DOMContentLoaded.                         */
/* -------------------------------------------------------------------------- */
function bindUiHandlers() {
  const newJobModal = document.getElementById("new-job-modal");
  const resumeModal = document.getElementById("resume-modal");

  const btnNewJob = document.getElementById("btn-new-job");
  const btnManageResumes = document.getElementById("btn-manage-resumes");
  const cancelNewJob = document.getElementById("cancel-new-job");
  const btnSignIn = document.getElementById("btn-sign-in");
  const btnSignOut = document.getElementById("btn-sign-out");
  
  const sourceType = document.getElementById("source-type");
  const resumeSelect = document.getElementById("resume-select");
  const newJobForm = document.getElementById("new-job-form");
  
  // ---------------------------------------------------------------------------
  // Track last selected resume
  // ---------------------------------------------------------------------------

  resumeSelect?.addEventListener("change", () => {
    lastSelectedResumeId = resumeSelect.value;
  });

  // ---------------------------------------------------------------------------
  // Open "Score New Job"
  // ---------------------------------------------------------------------------

  btnNewJob?.addEventListener("click", async () => {
    try {
      resumeModal?.classList.add("hidden");
      resetNewJobForm();
      await populateResumeSelect();
      updateSourceFields();
      newJobModal?.classList.remove("hidden");
      updateNewJobFormValidation();
    } catch (error) {
      console.error("Failed to load resumes:", error);
      window.alert(`Failed to load resumes: ${error.message}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Open "Manage Resumes"
  // ---------------------------------------------------------------------------

  btnManageResumes?.addEventListener("click", async () => {
    newJobModal?.classList.add("hidden");
    await openResumeManager();
  });

  // ---------------------------------------------------------------------------
  // Cancel new job modal
  // ---------------------------------------------------------------------------

  cancelNewJob?.addEventListener("click", () => {
    newJobModal?.classList.add("hidden");
  });

  // ---------------------------------------------------------------------------
  // Source type toggle
  // ---------------------------------------------------------------------------

  sourceType?.addEventListener("change", () => {
    updateSourceFields();
  });

// ---------------------------------------------------------------------------
// Live validation listeners
// ---------------------------------------------------------------------------

resumeSelect?.addEventListener("change", updateNewJobFormValidation);

sourceType?.addEventListener("change", updateNewJobFormValidation);

document
  .getElementById("job-url")
  ?.addEventListener("input", updateNewJobFormValidation);

document
  .getElementById("job-description")
  ?.addEventListener("input", updateNewJobFormValidation);

document
  .getElementById("linkedin-job-ids")
  ?.addEventListener("input", updateNewJobFormValidation);


  newJobForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const validation = validateNewJobForm();

  clearNewJobFormErrors();

  if (!validation.isValid) {
    renderNewJobFormErrors(validation.errors);
    return;
  }

  await submitJobScoringRequest();
  document.getElementById("new-job-modal")?.classList.add("hidden");
  resetNewJobForm();
  await refreshApp();

});

  document.getElementById("btn-refresh")?.addEventListener("click", refreshApp);

  // ---------------------------------------------------------------------------
  // Sign in
  // ---------------------------------------------------------------------------

  btnSignIn?.addEventListener("click", () => {
    window.location.href = getLoginUrl();
  });

  // ---------------------------------------------------------------------------
  // Sign out
  // ---------------------------------------------------------------------------

  btnSignOut?.addEventListener("click", () => {
  localStorage.removeItem("id_token");
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");

  window.location.href = getLogoutUrl();
  });

}

/* -------------------------------------------------------------------------- */
/* Function: updateSourceFields                                                */
/* Purpose: Show only the input field group that matches the selected source  */
/*          type (url, raw_text, or linkedin_job_id); hide the others.       */
/* -------------------------------------------------------------------------- */
function updateSourceFields() {
  const sourceType = document.getElementById("source-type");
  const urlField = document.getElementById("url-field");
  const textField = document.getElementById("text-field");
  const linkedinField = document.getElementById("linkedin-field");

  if (!sourceType) {
    return;
  }

  urlField?.classList.add("hidden");
  textField?.classList.add("hidden");
  linkedinField?.classList.add("hidden");

  if (sourceType.value === "url") {
    urlField?.classList.remove("hidden");
    return;
  }

  if (sourceType.value === "raw_text") {
    textField?.classList.remove("hidden");
    return;
  }

  if (sourceType.value === "linkedin_job_id") {
    linkedinField?.classList.remove("hidden");
  }
}

/* -------------------------------------------------------------------------- */
/* Function: populateResumeSelect                                              */
/* Purpose: Fetch all resumes and rebuild the resume dropdown. Restores the   */
/*          last-used selection when possible; falls back to the first item.  */
/* -------------------------------------------------------------------------- */
async function populateResumeSelect() {
  const resumeSelect = document.getElementById("resume-select");

  if (!resumeSelect) {
    return;
  }

  const resumes = await listResumes();

  resumeSelect.innerHTML = "";

  if (!Array.isArray(resumes) || resumes.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No resumes available";
    option.disabled = true;
    option.selected = true;
    resumeSelect.appendChild(option);
    return;
  }

  resumes.forEach((resume) => {
    const option = document.createElement("option");
    option.value = resume.resume_id;
    option.textContent = resume.name || "Untitled Resume";
    resumeSelect.appendChild(option);
  });

  const hasSavedSelection = resumes.some(
    (resume) => resume.resume_id === lastSelectedResumeId
  );

  if (hasSavedSelection) {
    resumeSelect.value = lastSelectedResumeId;
  } else {
    resumeSelect.value = resumes[0].resume_id;
    lastSelectedResumeId = resumes[0].resume_id;
  }
}

/* -------------------------------------------------------------------------- */
/* Function: resetNewJobForm                                                   */
/* Purpose: Clear all new-job form fields and restore the default source type */
/*          (url), then update the visible source field group.                */
/* -------------------------------------------------------------------------- */
function resetNewJobForm() {
  document.getElementById("new-job-form")?.reset();

  document.getElementById("source-type").value = "url";
  document.getElementById("job-url").value = "";
  document.getElementById("job-description").value = "";
  document.getElementById("linkedin-job-ids").value = "";

  updateSourceFields();
}

/* -------------------------------------------------------------------------- */
/* Function: validateNewJobForm                                                */
/* Purpose: Collect and validate all new-job form inputs. Returns an object   */
/*          with isValid and an errors map keyed by field name.               */
/* -------------------------------------------------------------------------- */
function validateNewJobForm() {
  const errors = {};

  const resumeId = document.getElementById("resume-select")?.value.trim() || "";
  const sourceType = document.getElementById("source-type")?.value || "url";
  const jobUrl = document.getElementById("job-url")?.value.trim() || "";
  const jobDescription =
    document.getElementById("job-description")?.value.trim() || "";
  const linkedinRaw =
    document.getElementById("linkedin-job-ids")?.value.trim() || "";

  const resumeSelect = document.getElementById("resume-select");
  const hasAvailableResumes = Array.from(resumeSelect?.options || []).some((option) => option.value.trim() !== "");

  if (!resumeId) {
    if (hasAvailableResumes) {
      errors.resume = "You must select a resume.";
    } else {
    errors.resume = "Please add a resume with Manage Resumes.";
    }
  }

  if (sourceType === "url") {
  if (!jobUrl) {
    errors.jobUrl = "Job URL is required.";
  } else if (!isValidUrl(jobUrl)) {
    errors.jobUrl = "URL is invalid. Enter a valid http or https URL.";
  }
  }

  if (sourceType === "raw_text") {
    if (!jobDescription) {
      errors.jobDescription = "Job description is required.";
    } else if (jobDescription.length < 100) {
      errors.jobDescription = "Job description is too short.";
    }
  }

 if (sourceType === "linkedin_job_id") {
  const jobIds = parseLinkedInJobIds(linkedinRaw);

  if (jobIds.length === 0) {
    errors.linkedinJobIds = "Enter at least one LinkedIn job ID.";
  } else if (!jobIds.every(isValidLinkedInJobId)) {
    errors.linkedinJobIds =
      "Each LinkedIn Job ID must be numeric and 7 to 12 digits long.";
  }
}

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/* -------------------------------------------------------------------------- */
/* Function: parseLinkedInJobIds                                               */
/* Purpose: Split newline-separated input into a trimmed array of job ID      */
/*          strings, discarding blank lines.                                  */
/* -------------------------------------------------------------------------- */
function parseLinkedInJobIds(value) {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Function: isValidLinkedInJobId                                              */
/* Purpose: Validate that a LinkedIn job ID is purely numeric and 7–12 digits.*/
/* -------------------------------------------------------------------------- */
function isValidLinkedInJobId(value) {
  return /^\d{7,12}$/.test(value);
}


/* -------------------------------------------------------------------------- */
/* Function: renderNewJobFormErrors                                            */
/* Purpose: Map the errors object from validateNewJobForm to the corresponding*/
/*          inline error elements in the DOM.                                 */
/* -------------------------------------------------------------------------- */
function renderNewJobFormErrors(errors) {
  setFieldError("resume-error", errors.resume);
  setFieldError("job-url-error", errors.jobUrl);
  setFieldError("job-description-error", errors.jobDescription);
  setFieldError("linkedin-job-ids-error", errors.linkedinJobIds);
}

function clearNewJobFormErrors() {
  renderNewJobFormErrors({});
}

/* -------------------------------------------------------------------------- */
/* Function: setFieldError                                                     */
/* Purpose: Show or hide an inline error element. When message is truthy the  */
/*          element is revealed; when falsy it is cleared and hidden.         */
/* -------------------------------------------------------------------------- */
function setFieldError(elementId, message) {
  const element = document.getElementById(elementId);

  if (!element) {
    return;
  }

  if (message) {
    element.textContent = message;
    element.classList.remove("hidden");
  } else {
    element.textContent = "";
    element.classList.add("hidden");
  }
}

/* -------------------------------------------------------------------------- */
/* Function: updateNewJobFormValidation                                        */
/* Purpose: Run live validation on every input change and enable or disable   */
/*          the submit button based on the result.                            */
/* -------------------------------------------------------------------------- */
function updateNewJobFormValidation() {
  const validation = validateNewJobForm();

  renderNewJobFormErrors(validation.errors);

  const submitButton = document.getElementById("submit-new-job");

  if (submitButton) {
    submitButton.disabled = !validation.isValid;
  }
}

/* -------------------------------------------------------------------------- */
/* Function: isValidUrl                                                        */
/* Purpose: Return true only if the value is a well-formed http or https URL. */
/* -------------------------------------------------------------------------- */
function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Function: scheduleAutoRefresh                                               */
/* Purpose: If any job is still pending (submitted/Scoring), schedule a       */
/*          15-second refresh. Clears any existing timer first so manual      */
/*          refreshes reset the countdown rather than stacking timers.        */
/*          Stops automatically once all jobs reach a terminal status.        */
/* -------------------------------------------------------------------------- */
function scheduleAutoRefresh() {
  if (autoRefreshTimer !== null) {
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (countdownInterval !== null) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  const indicator = document.getElementById("auto-refresh-indicator");
  const text = document.getElementById("auto-refresh-text");
  const spinner = indicator?.querySelector(".spinner");

  if (hasPendingJobs()) {
    spinner?.classList.remove("hidden");
    indicator?.classList.remove("hidden");

    let remaining = AUTO_REFRESH_SECONDS;
    if (text) text.textContent = `Auto-refreshing in ${remaining}s...`;

    countdownInterval = setInterval(() => {
      remaining -= 1;
      if (text) text.textContent = `Auto-refreshing in ${remaining}s...`;
    }, 1000);

    autoRefreshTimer = setTimeout(() => {
      clearInterval(countdownInterval);
      countdownInterval = null;
      autoRefreshTimer = null;
      refreshApp();
    }, AUTO_REFRESH_SECONDS * 1000);
  } else {
    indicator?.classList.add("hidden");
  }
}

/* -------------------------------------------------------------------------- */
/* Function: refreshApp                                                        */
/* Purpose: Reload the job list from the API and re-render the table.         */
/*          Disables the refresh button while in-flight, then schedules an    */
/*          auto-refresh if any jobs are still pending.                       */
/* -------------------------------------------------------------------------- */
async function refreshApp() {
  // Stop any running countdown before fetching.
  if (countdownInterval !== null) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  const refreshButton = document.getElementById("btn-refresh");
  const table = document.getElementById("jobs-table");

  try {
    if (refreshButton) refreshButton.disabled = true;
    table?.classList.add("loading");

    await loadJobs();
  } catch (error) {
    console.error("Failed to refresh dashboard:", error);
    window.alert(`Failed to refresh jobs: ${error.message}`);
  } finally {
    if (refreshButton) refreshButton.disabled = false;
    table?.classList.remove("loading");
    scheduleAutoRefresh();
  }
}

/* -------------------------------------------------------------------------- */
/* Function: submitJobScoringRequest                                           */
/* Purpose: Read the selected source type and dispatch the appropriate        */
/*          createJob call. LinkedIn job IDs are expanded into individual     */
/*          URL-based job submissions.                                        */
/* -------------------------------------------------------------------------- */
async function submitJobScoringRequest() {
  const resumeId = document.getElementById("resume-select")?.value.trim() || "";
  const sourceType = document.getElementById("source-type")?.value || "url";

  // ---------------------------------------------------------------------------
  // URL source
  // ---------------------------------------------------------------------------
  if (sourceType === "url") {
    const jobUrl = document.getElementById("job-url")?.value.trim() || "";

    await createJob({
      resume_id: resumeId,
      source_type: "url",
      job_url: jobUrl
    });

    return;
  }

  // ---------------------------------------------------------------------------
  // Raw job description source
  // ---------------------------------------------------------------------------
  if (sourceType === "raw_text") {
    const jobDescription =
      document.getElementById("job-description")?.value.trim() || "";

    await createJob({
      resume_id: resumeId,
      source_type: "raw_text",
      job_description: jobDescription
    });

    return;
  }

  // ---------------------------------------------------------------------------
  // LinkedIn job IDs
  // ---------------------------------------------------------------------------
  if (sourceType === "linkedin_job_id") {
    const jobIdsText =
      document.getElementById("linkedin-job-ids")?.value.trim() || "";

    const jobIds = jobIdsText
      .split("\n")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    for (const jobId of jobIds) {
      const jobUrl = `https://www.linkedin.com/jobs/view/${jobId}`;

      await createJob({
        resume_id: resumeId,
        source_type: "url",
        job_url: jobUrl
      });
    }

    return;
  }
}

/* -------------------------------------------------------------------------- */
/* Function: updateAuthButtons                                                 */
/* Purpose: Toggle sign-in/sign-out visibility and enable or disable action   */
/*          buttons based on whether the user is currently authenticated.     */
/* -------------------------------------------------------------------------- */
function updateAuthButtons() {
  const signIn = document.getElementById("btn-sign-in");
  const signOut = document.getElementById("btn-sign-out");

  const refresh = document.getElementById("btn-refresh");
  const scoreJob = document.getElementById("btn-new-job");
  const manageResumes = document.getElementById("btn-manage-resumes");

  const loggedIn = isLoggedIn();

  if (loggedIn) {
    signIn?.classList.add("hidden");
    signOut?.classList.remove("hidden");

    refresh?.removeAttribute("disabled");
    scoreJob?.removeAttribute("disabled");
    manageResumes?.removeAttribute("disabled");

  } else {
    signIn?.classList.remove("hidden");
    signOut?.classList.add("hidden");

    refresh?.setAttribute("disabled", "true");
    scoreJob?.setAttribute("disabled", "true");
    manageResumes?.setAttribute("disabled", "true");
  }
}

/* -------------------------------------------------------------------------- */
/* Function: showNotLoggedInMessage                                            */
/* Purpose: Hide the jobs table and replace the empty state with a sign-in   */
/*          prompt for unauthenticated visitors.                              */
/* -------------------------------------------------------------------------- */
function showNotLoggedInMessage() {
  const table = document.getElementById("jobs-table");
  const emptyState = document.getElementById("empty-state");

  table?.classList.add("hidden");

  if (emptyState) {
    emptyState.classList.remove("hidden");
    emptyState.innerHTML = `
      <p>Please sign in to use the application.</p>
    `;
  }
}
