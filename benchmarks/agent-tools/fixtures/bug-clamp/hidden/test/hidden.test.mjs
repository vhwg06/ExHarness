import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp } from "../clamp.mjs";
test("clamp bounds", () => { assert.equal(clamp(15, 0, 10), 10); assert.equal(clamp(4, 0, 10), 4); assert.equal(clamp(0, 0, 10), 0); });
