import assert from "node:assert/strict";
import { parseQuickInput } from "../utils/quickParse";

const piece = parseQuickInput("8x500");
assert.ok(piece);
assert.equal(piece!.chargeType, "piece");
assert.equal(piece!.quantity, 8);
assert.equal(piece!.pricePerPiece, 500);

const weight = parseQuickInput("4 1.3 300");
assert.ok(weight);
assert.equal(weight!.chargeType, "weight");
assert.equal(weight!.quantity, 4);
assert.equal(weight!.weight, 1.3);
assert.equal(weight!.pricePerKg, 300);

const fullPiece = parseQuickInput("SHORT LOFEI 8x500");
assert.ok(fullPiece);
assert.equal(fullPiece!.product, "SHORT");
assert.equal(fullPiece!.customer, "LOFEI");
assert.equal(fullPiece!.quantity, 8);
assert.equal(fullPiece!.pricePerPiece, 500);

const fullWeight = parseQuickInput("TIZANA SALAH 4 1.3 300");
assert.ok(fullWeight);
assert.equal(fullWeight!.product, "TIZANA");
assert.equal(fullWeight!.customer, "SALAH");
assert.equal(fullWeight!.chargeType, "weight");
assert.equal(fullWeight!.weight, 1.3);
assert.equal(fullWeight!.pricePerKg, 300);

assert.equal(parseQuickInput(""), null);
assert.equal(parseQuickInput("hello"), null);

console.log("quickParse.test.ts — all passed");
