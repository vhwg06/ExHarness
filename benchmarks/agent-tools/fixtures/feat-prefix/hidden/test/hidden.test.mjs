import { test } from "node:test";
import assert from "node:assert/strict";
import { addPrefix, upper } from "../strings.mjs";
test("addPrefix is idempotent", () => { assert.equal(addPrefix("x-", "x-a"), "x-a"); assert.equal(addPrefix("", "a"), "a"); assert.equal(upper("a"), "A"); });
