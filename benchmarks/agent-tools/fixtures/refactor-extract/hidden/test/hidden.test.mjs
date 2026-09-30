import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatName } from "../format.mjs";
import { describe } from "../user.mjs";
test("extracted formatter is used", () => { assert.equal(formatName("Ada", "Lovelace"), "LOVELACE, Ada"); assert.equal(describe({ first: "Ada", last: "Lovelace", age: 36 }), "LOVELACE, Ada (36)"); assert.match(readFileSync(new URL("../user.mjs", import.meta.url), "utf8"), /format\.mjs/); });
