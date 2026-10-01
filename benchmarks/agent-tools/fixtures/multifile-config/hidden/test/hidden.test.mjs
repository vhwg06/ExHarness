import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadConfig } from "../config.mjs";
import { greet } from "../greeting.mjs";
test("greeting comes from config", () => { assert.deepEqual(loadConfig(), { greeting: "Hello" }); assert.equal(JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8")).greeting, "Hello"); assert.equal(greet("Bob"), "Hello, Bob!"); assert.match(readFileSync(new URL("../greeting.mjs", import.meta.url), "utf8"), /loadConfig/); });
