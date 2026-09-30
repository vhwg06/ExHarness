import { test } from "node:test";
import assert from "node:assert/strict";
import * as strings from "../strings.mjs";
test("addPrefix prefixes", () => { assert.equal(strings.addPrefix("x-", "a"), "x-a"); });
