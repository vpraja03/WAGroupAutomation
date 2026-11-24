"use strict";

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const { parseSheet, buildTemplate } = require("./sheet");
const { buildSteps, buildReport, runGroups } = require("./jobs");
const { createWhatsApp } = require("./whatsapp");

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SESSIONS = 5;

process.on("unhandledRejection", (error) => {
  const message = error && error.message ? error.message : String(error);
  if (/EBUSY/.test(message) && /wwebjs_auth/.test(message)) {
    console.error("[server] WhatsApp session cleanup was locked. The page is still running.");
    return;
  }
  console.error(error);
  process.exit(1);
});

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
const sessions = new Map();

function emptyJob() {
  return { status: "idle", steps: [], error: "", report: { rows: [], summary: {} } };
}

function remember(entry, status, steps, error = "") {
  entry.job = { status, steps, error, report: buildReport(steps) };
}

function viewJob(job) {
  const report = job?.report || {};
  return {
    status: job?.status || "idle",
    error: job?.error || "",
    report: {
      summary: report.summary || {},
      groups: report.groups || [],
    },
  };
}

function openSession(requested) {
  if (SESSION_ID.test(requested) && sessions.has(requested)) return sessions.get(requested);
  if (sessions.size >= MAX_SESSIONS) {
    const error = new Error("Five WhatsApp logins are already open. Disconnect one, then try again.");
    error.status = 429;
    throw error;
  }
  const id = SESSION_ID.test(requested) ? requested : crypto.randomUUID();
  const entry = { id, wa: createWhatsApp(id), running: false, job: emptyJob() };
  sessions.set(id, entry);
  return entry;
}

function requireSession(req) {
  const id = req.get("x-session-id") || "";
  const entry = sessions.get(id);
  if (!entry) {
    const error = new Error("Scan the QR code to connect WhatsApp.");
    error.status = 401;
    throw error;
  }
  return entry;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.post("/api/sessions", (req, res) => {
  try {
    const entry = openSession(String(req.body?.id || ""));
    res.json({ id: entry.id });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

app.post("/api/sessions/logout", async (req, res) => {
  const id = req.get("x-session-id") || "";
  const entry = sessions.get(id);
  if (entry) {
    sessions.delete(id);
    await entry.wa.destroy();
  }
  res.json({ ok: true });
});

app.get("/api/status", (req, res) => {
  try {
    res.json(requireSession(req).wa.getStatus());
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

app.post("/api/preview", upload.single("file"), (req, res) => {
  try {
    res.json(readUpload(req.file));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

app.post("/api/jobs", upload.single("file"), (req, res) => {
  let entry;
  try {
    entry = requireSession(req);
    if (!entry.wa.isReady()) {
      res.status(409).json({ error: "Scan the QR code and wait until WhatsApp is connected." });
      return;
    }
    if (entry.running) {
      res.status(409).json({ error: "A run is already in progress for this WhatsApp login." });
      return;
    }
    const welcomeMessage = String(req.body.welcomeMessage || "").trim();
    if (!welcomeMessage) {
      res.status(400).json({ error: "Enter a welcome message." });
      return;
    }
    const parsed = readUpload(req.file);
    if (!parsed.groups.length) {
      res.status(400).json({ error: "No groups to create. Check the sheet and the skipped rows." });
      return;
    }

    entry.running = true;
    const steps = buildSteps(parsed.groups);
    remember(entry, "running", steps);
    res.json({ ok: true, ...viewJob(entry.job) });

    runGroups({
      groups: parsed.groups,
      welcomeMessage,
      client: entry.wa,
      onUpdate(next) {
        remember(entry, "running", next);
      },
    })
      .then((finalSteps) => {
        const failed = finalSteps.some((step) => step.status === "error");
        remember(entry, failed ? "error" : "done", finalSteps);
      })
      .catch((error) => {
        remember(entry, "error", entry.job.steps, error.message);
      })
      .finally(() => {
        entry.running = false;
      });
  } catch (error) {
    if (entry) entry.running = false;
    res.status(error.status || 400).json({ error: error.message });
  }
});

app.get("/api/jobs/current", (req, res) => {
  try {
    res.json(viewJob(requireSession(req).job));
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

app.get("/api/template.xlsx", (_req, res) => {
  const buffer = buildTemplate();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="group-template.xlsx"');
  res.send(buffer);
});

app.get("/api/jobs/results.xlsx", (req, res) => {
  let rows = [];
  try {
    rows = requireSession(req).job.report?.rows || [];
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
    return;
  }
  const sheetRows = rows.map((row) => ({
    Name: row.name,
    Mobile: row.mobile,
    Group: row.group,
    "Group result": row.groupStatus,
    "Member result": row.memberStatus,
    Welcome: row.welcome,
    Detail: row.detail,
  }));
  const sheet = XLSX.utils.json_to_sheet(
    sheetRows.length
      ? sheetRows
      : [{ Name: "", Mobile: "", Group: "", "Group result": "", "Member result": "", Welcome: "", Detail: "" }],
  );
  sheet["!cols"] = [18, 16, 22, 16, 22, 12, 42].map((width) => ({ wch: width }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Results");
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="group-results.xlsx"');
  res.send(buffer);
});

function readUpload(file) {
  if (!file) {
    const error = new Error("Choose an Excel file (.xlsx)");
    error.status = 400;
    throw error;
  }
  if (!file.originalname.toLowerCase().endsWith(".xlsx")) {
    const error = new Error("Upload an .xlsx Excel file");
    error.status = 400;
    throw error;
  }
  return parseSheet(file.buffer);
}

app.use((error, _req, res, _next) => {
  res.status(400).json({ error: error.message || "Upload failed" });
});

function start(port = 3210) {
  return app.listen(port, "127.0.0.1", () => {
    console.log(`WhatsApp group page at http://127.0.0.1:${port}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
