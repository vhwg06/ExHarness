import assert from "node:assert/strict";
import test from "node:test";

import { SemanticMemoryRetrievalSemantics } from "../src/index.js";

test("existing retrieval port remains an authority boundary rather than ranking authority", () => {
  assert.equal(SemanticMemoryRetrievalSemantics, "RELEVANCE_ONLY");
});
