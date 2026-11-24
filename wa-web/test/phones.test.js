"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePhone } = require("../src/phones");

test("normalizes Indian mobiles to WhatsApp ids", () => {
  assert.deepEqual(normalizePhone("9884802726"), {
    e164: "919884802726",
    waId: "919884802726@c.us",
  });
  assert.equal(normalizePhone("+91 98848 02726").e164, "919884802726");
  assert.equal(normalizePhone("919884802726").e164, "919884802726");
  assert.equal(normalizePhone("09884802726").e164, "919884802726");
  assert.equal(normalizePhone("+919884802726").e164, "919884802726");
  assert.equal(normalizePhone("9361700068").e164, "919361700068");
});

test("rejects numbers that cannot be used", () => {
  assert.throws(() => normalizePhone(""), /empty phone number/);
  assert.throws(() => normalizePhone("not-a-number"), /not a possible number/);
  assert.throws(() => normalizePhone("12345"), /not a possible number/);
});
