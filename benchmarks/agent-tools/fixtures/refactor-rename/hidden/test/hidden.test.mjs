import { test } from "node:test";
import assert from "node:assert/strict";
import * as cart from "../cart.mjs";
import { checkout } from "../checkout.mjs";
test("rename is complete", () => { assert.equal(cart.calc, undefined); assert.equal(cart.computeTotal([{ price: 2, qty: 3 }, { price: 1, qty: 1 }]), 7); assert.equal(checkout([{ price: 5, qty: 2 }]), "total=10"); });
