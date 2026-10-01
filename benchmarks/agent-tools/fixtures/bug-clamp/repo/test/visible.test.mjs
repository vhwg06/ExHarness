import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp } from "../clamp.mjs";
test("clamp below min", () => { assert.equal(clamp(-5, 0, 10), 0); });
