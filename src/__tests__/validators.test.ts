import assert from "node:assert/strict";
import {
  validateDate,
  validateInvoice,
  validatePhone,
  validatePrice,
  validateQuantity,
  validateWeight,
} from "../utils/validators";

assert.equal(validateInvoice("656").valid, false);
assert.equal(validateInvoice("65612").valid, true);
assert.equal(validateInvoice("B656").valid, false);

assert.equal(validatePhone("0663406290").valid, true);
assert.equal(validatePhone("0163406290").valid, false);

assert.equal(validateDate("09/07/2026").valid, true);
assert.equal(validateDate("2026-07-09").valid, false);

assert.equal(validateQuantity(4).valid, true);
assert.equal(validateQuantity(0).valid, false);

assert.equal(validateWeight(1.3, "weight").valid, true);
assert.equal(validateWeight(null, "piece").valid, true);

assert.equal(validatePrice(500).valid, true);
assert.equal(validatePrice(-1).valid, false);

console.log("validators.test.ts — all passed");
