import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
test("lib modules exist", () => { assert.ok(existsSync(new URL("../lib/add.mjs", import.meta.url))); assert.ok(existsSync(new URL("../lib/mul.mjs", import.meta.url))); });
