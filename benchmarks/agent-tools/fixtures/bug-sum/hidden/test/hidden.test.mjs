import { test } from "node:test";
import assert from "node:assert/strict";
import { sum } from "../sum.mjs";
test("sum handles negatives and zero", () => { assert.equal(sum(-4, 1), -3); assert.equal(sum(0, 0), 0); assert.equal(sum(10, 5), 15); });
