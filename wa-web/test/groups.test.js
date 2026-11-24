"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { groupIdFromChats } = require("../src/whatsapp");

test("matches a group by its subject when the chat name is blank", () => {
  const id = groupIdFromChats(
    [
      { id: "person@c.us", isGroup: false, name: "Raja" },
      { id: "mnm-sm@g.us", isGroup: true, name: "", subject: "MNM SM - Test" },
      { id: "other@g.us", isGroup: true, formattedTitle: "MMM IT - Test" },
    ],
    "MNM SM - Test",
  );
  assert.equal(id, "mnm-sm@g.us");
});

test("prefers the exact group name over a different case", () => {
  const id = groupIdFromChats(
    [
      { id: "lower@g.us", isGroup: true, subject: "mnm sm - test" },
      { id: "exact@g.us", isGroup: true, subject: "MNM SM - Test" },
    ],
    "MNM SM - Test",
  );
  assert.equal(id, "exact@g.us");
});
