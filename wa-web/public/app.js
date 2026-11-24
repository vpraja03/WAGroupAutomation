const SESSION_KEY = "wa-session-id";
const connectHelp = document.querySelector("#connect-help");
const connectCard = document.querySelector("#connect");
const connectSetup = document.querySelector("#connect-setup");
const connectedNote = document.querySelector("#connected-note");
const split = document.querySelector(".split");
const sheetCard = document.querySelector("#sheet");
const switchButton = document.querySelector("#switch");
const downloadButton = document.querySelector("#download");
const fileInput = document.querySelector("#file");
const fileNameEl = document.querySelector("#file-name");
const fileHintEl = document.querySelector("#file-hint");
const fileField = document.querySelector(".file-field");
const welcomeInput = document.querySelector("#welcome");
const previewButton = document.querySelector("#preview");
const runButton = document.querySelector("#run");
const statusEl = document.querySelector("#status");
const qrEl = document.querySelector("#qr");
const messageEl = document.querySelector("#message");
const previewPanel = document.querySelector("#preview-panel");
const groupsEl = document.querySelector("#groups");
const skippedEl = document.querySelector("#skipped");
const resultsPanel = document.querySelector("#results-panel");
const summaryEl = document.querySelector("#summary");
const progressEl = document.querySelector("#progress");
const resultsBody = document.querySelector("#results-body");

let whatsappReady = false;
let jobTimer = 0;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setMessage(text, isError) {
  messageEl.textContent = text;
  messageEl.classList.toggle("error", Boolean(isError));
}

function countText(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function pillClass(value) {
  if (["Created", "Added", "Sent", "Existing", "Already in the group"].includes(value)) return "good";
  if (value === "Failed") return "bad";
  if (["Running", "Pending", "Sending"].includes(value)) return "wait";
  return "";
}

function reportGroups(report) {
  if (Array.isArray(report?.groups) && report.groups.length) return report.groups;
  const grouped = new Map();
  for (const row of report?.rows || []) {
    const bucket = grouped.get(row.group) || {
      name: row.group,
      groupStatus: row.groupStatus,
      members: 0,
      added: 0,
      already: 0,
      failed: 0,
      welcome: row.welcome,
      detail: "",
    };
    bucket.members += 1;
    if (row.memberStatus === "Added") bucket.added += 1;
    else if (row.memberStatus === "Already in the group") bucket.already += 1;
    else if (row.memberStatus === "Failed") bucket.failed += 1;
    if (!bucket.detail && row.detail) bucket.detail = row.detail;
    grouped.set(row.group, bucket);
  }
  return [...grouped.values()];
}

function renderReport(report) {
  const groups = reportGroups(report);
  if (!groups.length) {
    resultsPanel.hidden = true;
    return;
  }
  const summary = report.summary || {};
  const chips = [
    ["Created", summary.created || 0],
    ["Existing", summary.existing || 0],
    ["Added", summary.added || 0],
    ["Already in group", summary.already || 0],
    ["Needs attention", summary.failed || 0],
  ];
  const settled = groups.filter((group) => !["Pending", "Running"].includes(group.groupStatus)).length;
  progressEl.textContent =
    settled === groups.length
      ? `${countText(groups.length)} groups`
      : `${countText(settled)} of ${countText(groups.length)} groups`;
  summaryEl.innerHTML = chips.map(([label, count]) => `<span>${label}: <strong>${countText(count)}</strong></span>`).join("");
  resultsBody.innerHTML = groups
    .map((group) => {
      const failed = Number(group.failed || 0);
      return `<tr>
        <td>${escapeHtml(group.name || "")}</td>
        <td><span class="pill ${pillClass(group.groupStatus)}">${escapeHtml(group.groupStatus || "")}</span></td>
        <td class="num">${countText(group.members)}</td>
        <td class="num">${countText(group.added)}</td>
        <td class="num">${countText(group.already)}</td>
        <td class="num">${failed ? `<strong class="bad-count">${countText(failed)}</strong>` : "0"}</td>
        <td><span class="pill ${pillClass(group.welcome)}">${escapeHtml(group.welcome || "")}</span></td>
        <td class="detail">${escapeHtml(group.detail || "")}</td>
      </tr>`;
    })
    .join("");
  resultsPanel.hidden = false;
}

function renderPreview(payload) {
  const groups = payload.groups || [];
  const members = groups.reduce((sum, group) => sum + group.members.length, 0);
  groupsEl.innerHTML = groups.length
    ? groups
        .map(
          (group) =>
            `<div class="group"><strong>${escapeHtml(group.name)}</strong><span>${countText(group.members.length)} members</span></div>`,
        )
        .join("")
    : "<p>No groups to create.</p>";

  const skipped = payload.skipped || [];
  const shown = skipped.slice(0, 8);
  const extra = skipped.length - shown.length;
  skippedEl.innerHTML = skipped.length
    ? `<p class="hint">Skipped ${countText(skipped.length)} row(s): ${shown
        .map((row) => `row ${row.row} (${escapeHtml(row.reason)})`)
        .join(", ")}${extra ? `, and ${countText(extra)} more` : ""}.</p>`
    : "";

  previewPanel.hidden = false;
  setMessage(`${countText(groups.length)} groups, ${countText(members)} members.`);
}

function selectedFile() {
  return fileInput.files && fileInput.files[0];
}

function showChosenFile() {
  const file = selectedFile();
  if (!file) {
    fileNameEl.textContent = "Choose an Excel sheet";
    fileHintEl.textContent = "Click to browse, or drop a .xlsx file here";
    fileField.classList.remove("has-file");
    return;
  }
  fileNameEl.textContent = file.name;
  fileHintEl.textContent = "Ready to preview";
  fileField.classList.add("has-file");
}

function sessionHeaders(extra = {}) {
  return { ...extra, "x-session-id": localStorage.getItem(SESSION_KEY) || "" };
}

async function readJson(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

async function ensureSession() {
  const existing = localStorage.getItem(SESSION_KEY) || "";
  const payload = await readJson(
    await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(existing ? { id: existing } : {}),
    }),
  );
  localStorage.setItem(SESSION_KEY, payload.id);
}

async function previewSheet() {
  const file = selectedFile();
  if (!file) {
    setMessage("Choose an Excel file first.", true);
    return;
  }
  previewButton.disabled = true;
  setMessage("");
  try {
    const body = new FormData();
    body.append("file", file);
    const payload = await readJson(await fetch("/api/preview", { method: "POST", body }));
    renderPreview(payload);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    previewButton.disabled = false;
  }
}

function stopJobPoll() {
  if (jobTimer) {
    clearInterval(jobTimer);
    jobTimer = 0;
  }
}

async function pollJob() {
  try {
    const payload = await readJson(await fetch("/api/jobs/current", { headers: sessionHeaders() }));
    renderReport(payload.report);
    if (payload.status === "done") {
      stopJobPoll();
      runButton.disabled = !whatsappReady;
      setMessage("Finished.");
    } else if (payload.status === "error") {
      stopJobPoll();
      runButton.disabled = !whatsappReady;
      setMessage(payload.error || "Some groups need attention. The Excel file lists every number.", true);
    }
  } catch (error) {
    stopJobPoll();
    runButton.disabled = !whatsappReady;
    setMessage(error.message, true);
  }
}

async function runSheet() {
  const file = selectedFile();
  if (!file) {
    setMessage("Choose an Excel file first.", true);
    return;
  }
  if (!whatsappReady) {
    setMessage("Scan the QR code and wait until WhatsApp is connected.", true);
    return;
  }
  runButton.disabled = true;
  setMessage("Creating groups…");
  try {
    const body = new FormData();
    body.append("file", file);
    body.append("welcomeMessage", welcomeInput.value);
    const payload = await readJson(await fetch("/api/jobs", { method: "POST", body, headers: sessionHeaders() }));
    renderReport(payload.report);
    stopJobPoll();
    jobTimer = setInterval(pollJob, 800);
  } catch (error) {
    runButton.disabled = !whatsappReady;
    setMessage(error.message, true);
  }
}

async function pollStatus() {
  try {
    const payload = await readJson(await fetch("/api/status", { headers: sessionHeaders() }));
    whatsappReady = payload.status === "ready";
    if (!jobTimer) runButton.disabled = !whatsappReady;
    setConnected(whatsappReady);
    statusEl.className = `status ${payload.status || "starting"}`;
    statusEl.textContent = payload.detail || {
      starting: "Preparing a QR code…",
      qr: "Scan the QR code with your WhatsApp.",
      ready: "Connected. Groups will be created from this WhatsApp.",
      disconnected: "WhatsApp is disconnected. Use a different WhatsApp to get a new code.",
    }[payload.status] || payload.status;
    if (payload.qrDataUrl) {
      qrEl.src = payload.qrDataUrl;
      qrEl.hidden = false;
    } else {
      qrEl.hidden = true;
    }
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

fileInput.addEventListener("change", () => {
  showChosenFile();
  previewPanel.hidden = true;
  resultsPanel.hidden = true;
  setMessage("");
});
function setConnected(ready) {
  connectCard.classList.toggle("is-ready", ready);
  split.classList.toggle("is-ready", ready);
  connectSetup.hidden = ready;
  connectedNote.hidden = !ready;
  connectHelp.hidden = ready;
  sheetCard.hidden = !ready;
}

async function switchAccount() {
  switchButton.disabled = true;
  try {
    await fetch("/api/sessions/logout", { method: "POST", headers: sessionHeaders() });
    localStorage.removeItem(SESSION_KEY);
    qrEl.hidden = true;
    setConnected(false);
    statusEl.className = "status starting";
    statusEl.textContent = "Preparing a new QR code…";
    await ensureSession();
    await pollStatus();
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    switchButton.disabled = false;
  }
}

async function downloadResults() {
  const response = await fetch("/api/jobs/results.xlsx", { headers: sessionHeaders() });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    setMessage(payload.error || "Could not download the results.", true);
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "group-results.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

previewButton.addEventListener("click", previewSheet);
runButton.addEventListener("click", runSheet);
switchButton.addEventListener("click", switchAccount);
downloadButton.addEventListener("click", downloadResults);
ensureSession()
  .then(() => {
    pollStatus();
    setInterval(pollStatus, 2000);
  })
  .catch((error) => {
    statusEl.textContent = error.message;
  });
window.renderReport = renderReport;
