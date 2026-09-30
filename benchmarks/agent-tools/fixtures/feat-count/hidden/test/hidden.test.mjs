import { test } from "node:test";
import assert from "node:assert/strict";
import { countWords } from "../text.mjs";
test("countWords edge cases", () => { assert.equal(countWords(""), 0); assert.equal(countWords("   "), 0); assert.equal(countWords("  one\ttwo\n three "), 3); });
