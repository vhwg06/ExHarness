import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
test("format.mjs exists", () => { assert.ok(existsSync(new URL("../format.mjs", import.meta.url))); });
