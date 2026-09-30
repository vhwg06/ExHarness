import { test } from "node:test";
import assert from "node:assert/strict";
import * as cart from "../cart.mjs";
test("computeTotal is exported", () => { assert.equal(typeof cart.computeTotal, "function"); });
