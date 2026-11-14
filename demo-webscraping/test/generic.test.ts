import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMoney } from "../src/generic.js";

test("money in pt, en and es formats", () => {
  assert.deepEqual(parseMoney("R$ 1.299,90"), { value: 1299.9, currency: "BRL" });
  assert.deepEqual(parseMoney("$1,299.90"), { value: 1299.9, currency: "USD" });
  assert.deepEqual(parseMoney("1.299,90 €"), { value: 1299.9, currency: "EUR" });
  assert.deepEqual(parseMoney("£12.5"), { value: 12.5, currency: "GBP" });
  assert.deepEqual(parseMoney("$ 12.999"), { value: 12999, currency: "USD" }, "three digits after the separator are thousands (CLP, COP)");
  assert.deepEqual(parseMoney("49.9", "BRL"), { value: 49.9, currency: "BRL" });
  assert.deepEqual(parseMoney(undefined, "EUR"), { currency: "EUR" });
});
