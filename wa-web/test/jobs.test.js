"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { renderWelcome, buildReport, runGroups } = require("../src/jobs");

const groups = [
  {
    name: "MMM IT",
    members: [{ name: "Raja", phone: "9884802726", waId: "919884802726@c.us" }],
  },
  {
    name: "MNM SM",
    members: [
      { name: "Raja", phone: "9361700068", waId: "919361700068@c.us" },
      { name: "Asha", phone: "9000000001", waId: "919000000001@c.us" },
    ],
  },
];

test("treats an error string from WhatsApp as a failed create", async () => {
  const client = {
    async createGroup() {
      return "CreateGroupError: An unknown error occupied while creating a group";
    },
    async sendMessage() {
      throw new Error("should not send");
    },
  };

  const steps = await runGroups({
    groups: [groups[0]],
    welcomeMessage: "Welcome to {group}.",
    client,
    pauseMs: 0,
    createAttempts: 1,
  });

  assert.equal(steps[0].status, "error");
  assert.match(steps[0].detail, /limiting new groups/);
  assert.equal(steps[1].status, "skipped");
  assert.equal(steps[2].status, "skipped");
});

test("retries a rate-limited group and then creates it", async () => {
  let calls = 0;
  const client = {
    async createGroup() {
      calls += 1;
      if (calls === 1) {
        return "CreateGroupError: An unknown error occupied while creating a group";
      }
      return {
        gid: { _serialized: "second@g.us" },
        participants: { "919884802726@c.us": { statusCode: 200 } },
      };
    },
    async sendMessage() {},
  };

  const steps = await runGroups({
    groups: [groups[0]],
    welcomeMessage: "Welcome to {group}.",
    client,
    pauseMs: 0,
    retryWaitMs: 0,
  });

  assert.equal(calls, 2);
  assert.equal(steps[0].status, "done");
  assert.equal(steps[1].status, "done");
  assert.equal(steps[2].status, "done");
});

test("reuses a group that shows up after WhatsApp rejects the create", async () => {
  let finds = 0;
  let creates = 0;
  const client = {
    async findGroup() {
      finds += 1;
      return finds > 1 ? "existing@g.us" : "";
    },
    async createGroup() {
      creates += 1;
      return "CreateGroupError: An unknown error occupied while creating a group";
    },
    async addParticipants() {
      return { "919884802726@c.us": { code: 200 } };
    },
    async sendMessage() {},
  };

  const steps = await runGroups({
    groups: [groups[0]],
    welcomeMessage: "Welcome to {group}.",
    client,
    pauseMs: 0,
    retryWaitMs: 0,
  });

  assert.equal(creates, 1);
  assert.equal(steps[0].status, "done");
  assert.equal(steps[0].detail, "Using the existing group");
  assert.equal(steps[1].status, "done");
});

test("reuses a group that already exists", async () => {
  const sent = [];
  const client = {
    async findGroup(name) {
      return name === "MMM IT" ? "existing@g.us" : "";
    },
    async addParticipants() {
      return { "919884802726@c.us": { code: 409, message: "already a member" } };
    },
    async createGroup() {
      throw new Error("should reuse the group");
    },
    async sendMessage(groupId, text) {
      sent.push({ groupId, text });
    },
  };

  const steps = await runGroups({
    groups: [groups[0]],
    welcomeMessage: "Welcome to {group}.",
    client,
    pauseMs: 0,
  });

  assert.equal(steps[0].status, "done");
  assert.equal(steps[0].detail, "Using the existing group");
  assert.equal(steps[1].status, "done");
  assert.equal(steps[1].detail, "Already in the group");
  assert.equal(steps[2].status, "skipped");
  assert.deepEqual(sent, []);
});

test("treats the generic add error as already in the group when the number is a member", async () => {
  const client = {
    async findGroup() {
      return "existing@g.us";
    },
    async addParticipants() {
      return {
        "919884802726@c.us": {
          code: 400,
          message: "An unknown error occupied while adding a participant",
        },
      };
    },
    async participantIds() {
      return ["919884802726"];
    },
    async createGroup() {
      throw new Error("should reuse the group");
    },
    async sendMessage() {
      throw new Error("should not send");
    },
  };

  const steps = await runGroups({
    groups: [groups[0]],
    welcomeMessage: "Welcome to {group}.",
    client,
    pauseMs: 0,
  });
  const report = buildReport(steps);

  assert.equal(steps[1].status, "done");
  assert.equal(steps[1].detail, "Already in the group");
  assert.equal(report.rows[0].memberStatus, "Already in the group");
  assert.equal(report.rows[0].welcome, "Not sent");
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.already, 1);
});

test("keeps a real add failure when the number is not in the group", async () => {
  const client = {
    async findGroup() {
      return "existing@g.us";
    },
    async addParticipants() {
      return {
        "919884802726@c.us": {
          code: 400,
          message: "An unknown error occupied while adding a participant",
        },
      };
    },
    async participantIds() {
      return [];
    },
    async createGroup() {
      throw new Error("should reuse the group");
    },
    async sendMessage() {
      throw new Error("should not send");
    },
  };

  const steps = await runGroups({
    groups: [groups[0]],
    welcomeMessage: "Welcome to {group}.",
    client,
    pauseMs: 0,
  });
  const report = buildReport(steps);

  assert.equal(steps[1].status, "error");
  assert.equal(report.rows[0].memberStatus, "Failed");
  assert.equal(report.summary.failed, 1);
});

test("adds a new number to an existing group and sends the welcome", async () => {
  const sent = [];
  const client = {
    async findGroup() {
      return "existing@g.us";
    },
    async addParticipants(_groupId, ids) {
      return {
        [ids[0]]: { code: 409, message: "already a member" },
        [ids[1]]: { code: 200, message: "added" },
      };
    },
    async createGroup() {
      throw new Error("should reuse the group");
    },
    async sendMessage(groupId, text) {
      sent.push({ groupId, text });
    },
  };

  const steps = await runGroups({
    groups: [groups[1]],
    welcomeMessage: "Welcome to {group}, {names}.",
    client,
    pauseMs: 0,
  });
  const report = buildReport(steps);

  assert.equal(steps[0].detail, "Using the existing group");
  assert.equal(steps[1].detail, "Already in the group");
  assert.equal(steps[2].status, "done");
  assert.equal(steps[2].detail, "");
  assert.equal(steps[3].status, "done");
  assert.deepEqual(sent, [{ groupId: "existing@g.us", text: "Welcome to MNM SM, Raja, Asha." }]);
  assert.equal(report.summary.existing, 1);
  assert.equal(report.summary.added, 1);
  assert.equal(report.summary.already, 1);
  assert.equal(report.rows[1].memberStatus, "Added");
  assert.equal(report.rows[1].welcome, "Sent");
  assert.deepEqual(report.groups, [
    {
      name: "MNM SM",
      groupStatus: "Existing",
      members: 2,
      added: 1,
      already: 1,
      failed: 0,
      welcome: "Sent",
      detail: "",
    },
  ]);
});

test("fills the welcome message for a group", () => {
  assert.equal(
    renderWelcome("Welcome to {group}, {names}.", groups[0]),
    "Welcome to MMM IT, Raja.",
  );
  assert.equal(
    renderWelcome("Welcome to {group}, {names}.", groups[1]),
    "Welcome to MNM SM, Raja, Asha.",
  );
});

test("creates each group, records a refused add, and still sends the welcome", async () => {
  const sent = [];
  const client = {
    async createGroup(name, ids) {
      if (name === "MMM IT") {
        throw new Error("create failed");
      }
      return {
        gid: { _serialized: "group@g.us" },
        participants: {
          [ids[0]]: { statusCode: 403, message: "privacy blocks the add" },
          [ids[1]]: { statusCode: 200 },
        },
      };
    },
    async sendMessage(groupId, text) {
      sent.push({ groupId, text });
    },
  };

  const steps = await runGroups({
    groups,
    welcomeMessage: "Welcome to {group}, {names}.",
    client,
    pauseMs: 0,
    createAttempts: 1,
  });

  assert.equal(steps[0].status, "error");
  assert.equal(steps[0].detail, "create failed");
  assert.equal(steps[1].status, "skipped");
  assert.equal(steps[2].status, "skipped");
  assert.equal(steps[3].status, "done");
  assert.equal(steps[4].status, "error");
  assert.equal(steps[4].detail, "privacy blocks the add");
  assert.equal(steps[5].status, "done");
  assert.equal(steps[6].status, "done");
  assert.deepEqual(sent, [
    { groupId: "group@g.us", text: "Welcome to MNM SM, Raja, Asha." },
  ]);
});
