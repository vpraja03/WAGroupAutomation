"use strict";

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const XLSX = require("xlsx");
const { parseSheet, buildTemplate } = require("../src/sheet");

const samplePath = path.join(__dirname, "..", "..", "data", "group-members.xlsx");

function workbook(rows) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Members");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

test("groups the sample sheet by the Group column", () => {
  const parsed = parseSheet(fs.readFileSync(samplePath));
  assert.deepEqual(
    parsed.groups.map((group) => ({
      name: group.name,
      members: group.members.map((member) => ({ name: member.name, phone: member.phone, waId: member.waId })),
    })),
    [
      {
        name: "MMM IT",
        members: [{ name: "Raja", phone: "9884802726", waId: "919884802726@c.us" }],
      },
      {
        name: "MNM SM",
        members: [{ name: "Raja", phone: "9361700068", waId: "919361700068@c.us" }],
      },
    ],
  );
  assert.deepEqual(parsed.skipped, []);
});

test("keeps one group for repeated names and skips bad rows", () => {
  const parsed = parseSheet(
    workbook([
      ["Name", "Phone", "Group"],
      ["Raja", "9884802726", "MMM IT"],
      ["Raja", "9884802726", "MMM IT"],
      ["Asha", 9361700068, "MMM IT"],
      ["", "", ""],
      ["Bad", "not-a-number", "MMM IT"],
      ["No group", "9884802726", ""],
      ["Amit", "9000000001", "MNM SM"],
    ]),
  );

  assert.deepEqual(parsed.groups.map((group) => group.name), ["MMM IT", "MNM SM"]);
  assert.deepEqual(
    parsed.groups[0].members.map((member) => member.waId),
    ["919884802726@c.us", "919361700068@c.us"],
  );
  assert.equal(parsed.groups[0].members[1].phone, "9361700068");
  assert.equal(parsed.skipped.length, 2);
  assert.equal(parsed.skipped[0].reason.includes("not a possible number"), true);
  assert.equal(parsed.skipped[1].reason, "empty group");
});

test("template includes Name, Mobile, and Group with sample rows", () => {
  const parsed = parseSheet(buildTemplate());
  assert.deepEqual(parsed.skipped, []);
  assert.deepEqual(
    parsed.groups.map((group) => ({
      name: group.name,
      members: group.members.map((member) => ({ name: member.name, waId: member.waId })),
    })),
    [
      {
        name: "Sample group",
        members: [
          { name: "Sample person", waId: "919000000001@c.us" },
          { name: "Another person", waId: "919000000002@c.us" },
        ],
      },
    ],
  );
});

test("requires the three columns", () => {
  assert.throws(
    () => parseSheet(workbook([["Name", "Mobile"], ["Raja", "9884802726"]])),
    /Name, Mobile, and Group/,
  );
});
