"use strict";

function normalizePhone(raw) {
  const original = String(raw ?? "").trim();
  if (!original) {
    throw new Error("empty phone number");
  }

  const compact = original.replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(compact)) {
    throw new Error(`not a possible number: ${original}`);
  }

  let digits = compact.startsWith("+") ? compact.slice(1) : compact;
  if (!compact.startsWith("+")) {
    if (digits.startsWith("00")) {
      digits = digits.slice(2);
    } else if (digits.length === 11 && digits.startsWith("0")) {
      digits = `91${digits.slice(1)}`;
    } else if (digits.length === 10) {
      digits = `91${digits}`;
    }
  }

  if (!/^\d{8,15}$/.test(digits)) {
    throw new Error(`not a possible number: ${original}`);
  }
  if (digits.startsWith("91") && !/^91[6-9]\d{9}$/.test(digits)) {
    throw new Error(`not a possible number: ${original}`);
  }

  return {
    e164: digits,
    waId: `${digits}@c.us`,
  };
}

module.exports = { normalizePhone };
