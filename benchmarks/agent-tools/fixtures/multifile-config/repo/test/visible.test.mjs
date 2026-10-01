import { test } from "node:test";
import assert from "node:assert/strict";
import { greet } from "../greeting.mjs";
test("greet uses Hello", () => { assert.equal(greet("Ada"), "Hello, Ada!"); });
