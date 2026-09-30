import { test } from "node:test";
import assert from "node:assert/strict";
import * as text from "../text.mjs";
test("countWords counts", () => { assert.equal(text.countWords("a b c"), 3); });
