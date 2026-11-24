"use strict";

const XLSX = require("xlsx");
const { normalizePhone } = require("./phones");

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return String(value).trim();
}

function parseSheet(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("The workbook has no worksheets");
  }

  const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: "",
    raw: true,
  });
  if (!grid.length) {
    throw new Error("The sheet is empty");
  }

  const headers = grid[0].map((cell) => cellText(cell).toLowerCase());
  const nameIndex = headers.indexOf("name");
  const mobileIndex = headers.findIndex((header) => header === "mobile" || header === "phone");
  const groupIndex = headers.indexOf("group");
  if (nameIndex < 0 || mobileIndex < 0 || groupIndex < 0) {
    throw new Error("The sheet must include Name, Mobile, and Group columns");
  }

  const groups = [];
  const byName = new Map();
  const skipped = [];

  for (let index = 1; index < grid.length; index += 1) {
    const row = grid[index] || [];
    const name = cellText(row[nameIndex]);
    const mobile = cellText(row[mobileIndex]);
    const groupName = cellText(row[groupIndex]);
    const rowNumber = index + 1;

    if (!name && !mobile && !groupName) continue;

    if (!groupName) {
      skipped.push({ row: rowNumber, name, mobile, group: "", reason: "empty group" });
      continue;
    }
    if (!mobile) {
      skipped.push({ row: rowNumber, name, mobile: "", group: groupName, reason: "empty mobile number" });
      continue;
    }

    let phone;
    try {
      phone = normalizePhone(mobile);
    } catch (error) {
      skipped.push({ row: rowNumber, name, mobile, group: groupName, reason: error.message });
      continue;
    }

    let group = byName.get(groupName);
    if (!group) {
      group = { name: groupName, members: [] };
      byName.set(groupName, group);
      groups.push(group);
    }
    if (group.members.some((member) => member.waId === phone.waId)) continue;

    group.members.push({
      name,
      phone: mobile,
      waId: phone.waId,
    });
  }

  return { groups, skipped };
}

function buildTemplate() {
  const rows = [
    ["Name", "Mobile", "Group"],
    ["Sample person", "9000000001", "Sample group"],
    ["Another person", "9000000002", "Sample group"],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 22 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Members");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

module.exports = { parseSheet, buildTemplate };
