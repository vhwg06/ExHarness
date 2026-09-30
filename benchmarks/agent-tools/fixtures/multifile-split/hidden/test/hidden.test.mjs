import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { add } from "../lib/add.mjs";
import { mul } from "../lib/mul.mjs";
import * as math from "../math.mjs";
test("split keeps behaviour", () => { assert.equal(add(2, 3), 5); assert.equal(mul(2, 3), 6); assert.equal(math.add(1, 1), 2); assert.equal(math.mul(3, 3), 9); assert.doesNotMatch(readFileSync(new URL("../math.mjs", import.meta.url), "utf8"), /=>/); });
