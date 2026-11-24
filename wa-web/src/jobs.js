"use strict";

function fill(template, token, value) {
  return String(template).split(token).join(value);
}

function renderWelcome(template, group) {
  const names = group.members.map((member) => member.name).filter(Boolean).join(", ");
  return fill(fill(template, "{group}", group.name), "{names}", names);
}

function buildSteps(groups) {
  const steps = [];
  groups.forEach((group, groupIndex) => {
    steps.push({
      id: `g${groupIndex}-create`,
      type: "create",
      group: group.name,
      status: "pending",
      detail: "",
    });
    group.members.forEach((member, memberIndex) => {
      steps.push({
        id: `g${groupIndex}-add-${memberIndex}`,
        type: "add",
        group: group.name,
        phone: member.phone,
        name: member.name,
        status: "pending",
        detail: "",
      });
    });
    steps.push({
      id: `g${groupIndex}-welcome`,
      type: "welcome",
      group: group.name,
      status: "pending",
      detail: "",
    });
  });
  return steps;
}

function snapshot(steps) {
  return steps.map((step) => ({ ...step }));
}

function lookupParticipant(participants, waId) {
  if (!participants) return null;
  if (Array.isArray(participants)) {
    return (
      participants.find((entry) => {
        const id = entry?.id?._serialized || entry?.id || entry?.wid || "";
        return id === waId || String(id).startsWith(waId.split("@")[0]);
      }) || null
    );
  }
  if (participants[waId]) return participants[waId];
  const bare = waId.split("@")[0];
  for (const [key, value] of Object.entries(participants)) {
    if (key === waId || key.startsWith(bare)) return value;
  }
  return null;
}

function memberResult(participants, waId) {
  const info = lookupParticipant(participants, waId);
  if (!info) {
    const empty =
      !participants ||
      (Array.isArray(participants) ? participants.length === 0 : Object.keys(participants).length === 0);
    if (empty) return { ok: true, detail: "" };
    return { ok: false, detail: "WhatsApp did not return a result for this number" };
  }
  if (info.isInviteV4Sent) {
    return {
      ok: false,
      detail: info.message || "WhatsApp sent an invite instead of adding this number",
    };
  }
  const message = info.message || info.error || "";
  const code = Number(info.statusCode ?? info.code ?? info.status ?? 200);
  if (code === 409 || isAlreadyMemberMessage(message)) {
    return { ok: true, detail: "Already in the group" };
  }
  if (code === 200) return { ok: true, detail: "" };
  return {
    ok: false,
    detail: message || `WhatsApp could not add this number (${code})`,
  };
}

function isAlreadyMemberMessage(message) {
  return /already (a )?(group )?member|already in the group/i.test(message || "");
}

function isUnknownAddError(message) {
  return /unknown error occupied while adding a participant/i.test(message || "");
}

function samePhone(left, right) {
  const a = String(left || "").split("@")[0].replace(/\D/g, "");
  const b = String(right || "").split("@")[0].replace(/\D/g, "");
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return shorter.length >= 10 && longer.endsWith(shorter);
}

async function reconcileAlreadyMembers(client, groupId, members, participants) {
  const original = participants;
  const unknown =
    typeof original === "string"
      ? isUnknownAddError(original)
      : members.some((member) => {
          const info = lookupParticipant(original, member.waId);
          const message = info?.message || info?.error || "";
          return Boolean(info) && isUnknownAddError(message);
        });
  if (!unknown || typeof client.participantIds !== "function") return original;

  let present = [];
  try {
    present = await client.participantIds(groupId);
  } catch {
    return original;
  }

  const result = typeof original === "string" ? {} : { ...original };
  for (const member of members) {
    if (!present.some((id) => samePhone(id, member.waId))) continue;
    const info = lookupParticipant(original, member.waId);
    const message = typeof original === "string" ? original : info?.message || info?.error || "";
    if (typeof original === "string" || isUnknownAddError(message)) {
      result[member.waId] = { statusCode: 409, message: "Already in the group" };
    }
  }
  return result;
}

function groupIdFrom(result) {
  if (!result || typeof result !== "object") return "";
  const gid = result.gid || result.id;
  if (typeof gid === "string") return gid.includes("@g.us") ? gid : "";
  if (gid && typeof gid._serialized === "string") return gid._serialized;
  if (gid && gid.user && gid.server) return `${gid.user}@${gid.server}`;
  return "";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimit(error) {
  return /CreateGroupError|rate-overlimit|unknown error occupied while creating/i.test(error.message || "");
}

async function reuseGroup(client, group, groupId) {
  const ids = group.members.map((member) => member.waId);
  let participants = null;
  if (ids.length && typeof client.addParticipants === "function") {
    try {
      participants = await client.addParticipants(groupId, ids);
    } catch (error) {
      participants = error.message;
    }
    participants = await reconcileAlreadyMembers(client, groupId, group.members, participants);
  }
  return { groupId, participants, created: false };
}

async function openGroup(client, group, { attempts, retryWaitMs, onWait }) {
  const ids = group.members.map((member) => member.waId);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (typeof client.findGroup === "function") {
      const existingId = await client.findGroup(group.name);
      if (existingId) return reuseGroup(client, group, existingId);
    }
    try {
      const emptyOnly = attempt === attempts && attempt > 1;
      const result = await client.createGroup(group.name, emptyOnly ? [] : ids);
      if (typeof result === "string") throw new Error(result);
      const groupId = groupIdFrom(result);
      if (!groupId) throw new Error("WhatsApp did not return a group id");
      let participants = result.participants || null;
      if (emptyOnly && ids.length && typeof client.addParticipants === "function") {
        try {
          participants = await client.addParticipants(groupId, ids);
        } catch (error) {
          participants = error.message;
        }
        participants = await reconcileAlreadyMembers(client, groupId, group.members, participants);
      }
      return { groupId, participants, created: true };
    } catch (error) {
      lastError = error;
      if (isRateLimit(error) && typeof client.findGroup === "function") {
        const existingId = await client.findGroup(group.name);
        if (existingId) return reuseGroup(client, group, existingId);
      }
      if (!isRateLimit(error) || attempt === attempts) throw error;
      const wait = retryWaitMs * attempt;
      onWait?.(attempt, wait);
      await delay(wait);
    }
  }
  throw lastError;
}

async function runGroups({
  groups,
  welcomeMessage,
  client,
  onUpdate,
  pauseMs = 30000,
  createAttempts = 3,
  retryWaitMs = 30000,
}) {
  const steps = buildSteps(groups);
  const notify = () => onUpdate?.(snapshot(steps));

  const setStep = (id, patch) => {
    const step = steps.find((item) => item.id === id);
    if (step) Object.assign(step, patch);
    notify();
  };

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const createId = `g${groupIndex}-create`;
    setStep(createId, { status: "running" });

    let groupId = "";
    let participants = null;
    let created = false;
    try {
      const opened = await openGroup(client, group, {
        attempts: createAttempts,
        retryWaitMs,
        onWait(attempt, waitSeconds) {
          const seconds = Math.round(waitSeconds / 1000);
          setStep(createId, {
            status: "running",
            detail: `WhatsApp is limiting new groups. Retrying in ${seconds}s (${attempt + 1} of ${createAttempts}).`,
          });
        },
      });
      groupId = opened.groupId;
      participants = opened.participants;
      created = opened.created;
      if (typeof participants === "string") {
        const message = participants;
        participants = Object.fromEntries(
          group.members.map((member) => [member.waId, { statusCode: 500, message }]),
        );
      }
      setStep(createId, {
        status: "done",
        detail: created ? "" : "Using the existing group",
      });
    } catch (error) {
      const detail = isRateLimit(error)
        ? "WhatsApp is still limiting new groups. Wait a few minutes, then run the sheet again. Existing groups are reused."
        : error.message;
      setStep(createId, { status: "error", detail });
      for (const step of steps) {
        if (step.group === group.name && step.id !== createId && step.status === "pending") {
          step.status = "skipped";
          step.detail = "Group was not created";
        }
      }
      notify();
      if (groupIndex < groups.length - 1) await delay(pauseMs);
      continue;
    }

    for (let memberIndex = 0; memberIndex < group.members.length; memberIndex += 1) {
      const member = group.members[memberIndex];
      const addId = `g${groupIndex}-add-${memberIndex}`;
      setStep(addId, { status: "running" });
      const outcome = memberResult(participants, member.waId);
      setStep(addId, { status: outcome.ok ? "done" : "error", detail: outcome.detail });
    }

    const welcomeId = `g${groupIndex}-welcome`;
    const newlyAdded = group.members.some((_, memberIndex) => {
      const step = steps.find((item) => item.id === `g${groupIndex}-add-${memberIndex}`);
      return step && step.status === "done" && !step.detail;
    });
    if (!created && !newlyAdded) {
      const anyFailed = group.members.some((_, memberIndex) => {
        const step = steps.find((item) => item.id === `g${groupIndex}-add-${memberIndex}`);
        return step && step.status === "error";
      });
      setStep(welcomeId, {
        status: "skipped",
        detail: anyFailed ? "No new members were added" : "This group already had these members",
      });
    } else {
      setStep(welcomeId, { status: "running" });
      try {
        await client.sendMessage(groupId, renderWelcome(welcomeMessage, group));
        setStep(welcomeId, { status: "done", detail: "" });
      } catch (error) {
        setStep(welcomeId, { status: "error", detail: error.message });
      }
    }

    if (created && groupIndex < groups.length - 1 && pauseMs > 0) {
      const seconds = Math.round(pauseMs / 1000);
      setStep(`g${groupIndex + 1}-create`, {
        status: "running",
        detail: `Waiting ${seconds}s so WhatsApp will allow another group.`,
      });
      await delay(pauseMs);
    }
  }

  return snapshot(steps);
}

function stepLabel(step, doneText, pendingText) {
  if (!step) return "";
  if (step.status === "done") return doneText;
  if (step.status === "error") return "Failed";
  if (step.status === "skipped") return "Skipped";
  if (step.status === "running") return "Running";
  return pendingText;
}

function buildReport(steps) {
  const grouped = new Map();
  for (const step of steps) {
    const bucket = grouped.get(step.group) || { create: null, welcome: null, adds: [] };
    if (step.type === "create") bucket.create = step;
    else if (step.type === "welcome") bucket.welcome = step;
    else if (step.type === "add") bucket.adds.push(step);
    if (step.group) grouped.set(step.group, bucket);
  }

  const rows = [];
  for (const [group, bucket] of grouped) {
    const existing = /existing group/i.test(bucket.create?.detail || "");
    const groupStatus = stepLabel(bucket.create, existing ? "Existing" : "Created", "Pending");
    const welcome = stepLabel(bucket.welcome, "Sent", "Pending");
    const welcomeDetail = bucket.welcome?.status === "done" ? "" : bucket.welcome?.detail || "";
    const adds = bucket.adds.length ? bucket.adds : [null];
    for (const add of adds) {
      const already = /already in the group/i.test(add?.detail || "");
      rows.push({
        name: add?.name || "",
        mobile: add?.phone || "",
        group,
        groupStatus,
        memberStatus: add ? stepLabel(add, already ? "Already in the group" : "Added", "Pending") : "",
        welcome: welcome === "Skipped" ? "Not sent" : welcome,
        detail: [add?.detail, already ? "" : welcomeDetail].filter(Boolean).join("; "),
      });
    }
  }

  const summary = {
    created: rows.filter((row) => row.groupStatus === "Created").length
      ? new Set(rows.filter((row) => row.groupStatus === "Created").map((row) => row.group)).size
      : 0,
    existing: new Set(rows.filter((row) => row.groupStatus === "Existing").map((row) => row.group)).size,
    added: rows.filter((row) => row.memberStatus === "Added").length,
    already: rows.filter((row) => row.memberStatus === "Already in the group").length,
    failed: rows.filter((row) => row.groupStatus === "Failed" || row.memberStatus === "Failed" || row.welcome === "Failed").length,
  };
  const groups = [...grouped.entries()].map(([group, bucket]) => summarizeGroup(group, bucket));
  return { rows, groups, summary };
}

function summarizeGroup(group, bucket) {
  const existing = /existing group/i.test(bucket.create?.detail || "");
  const groupStatus = stepLabel(bucket.create, existing ? "Existing" : "Created", "Pending");
  const welcomeRaw = stepLabel(bucket.welcome, "Sent", "Pending");
  const welcome = welcomeRaw === "Skipped" ? "Not sent" : welcomeRaw;
  let added = 0;
  let already = 0;
  let failed = 0;
  let firstFailure = "";
  for (const add of bucket.adds) {
    const alreadyMember = /already in the group/i.test(add?.detail || "");
    const memberStatus = stepLabel(add, alreadyMember ? "Already in the group" : "Added", "Pending");
    if (memberStatus === "Added") added += 1;
    else if (memberStatus === "Already in the group") already += 1;
    else if (memberStatus === "Failed") {
      failed += 1;
      if (!firstFailure) firstFailure = add.detail || "Could not add a member";
    }
  }
  const notes = [];
  if (bucket.create?.status === "error" && bucket.create.detail) notes.push(bucket.create.detail);
  if (firstFailure) notes.push(failed > 1 ? `${firstFailure} (+${failed - 1} more)` : firstFailure);
  if (bucket.welcome?.status === "error" && bucket.welcome.detail) notes.push(bucket.welcome.detail);
  return {
    name: group,
    groupStatus,
    members: bucket.adds.length,
    added,
    already,
    failed,
    welcome,
    detail: notes.filter(Boolean).join("; "),
  };
}

module.exports = {
  renderWelcome,
  buildSteps,
  buildReport,
  runGroups,
};
