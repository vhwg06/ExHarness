import { invariant, requireText } from "./contracts.js";
import { defineContextSelection } from "./context.js";
import { defineModelSelector } from "./model-routing.js";

function requireOptionalParser(parser, label) {
  if (parser == null) return null;
  invariant(typeof parser === "function", `${label} must be a function`);
  return parser;
}

export function defineJudgment(definition) {
  invariant(definition && typeof definition === "object", "judgment definition is required");
  const name = requireText(definition.name, "judgment.name");
  const strategy = definition.strategy ?? null;
  if (strategy != null) {
    invariant(strategy && typeof strategy.run === "function", `judgment ${name} strategy requires run()`);
  }

  return Object.freeze({
    name,
    description: definition.description ?? null,
    parseInput: requireOptionalParser(definition.parseInput, `judgment ${name} parseInput`),
    parseOutput: requireOptionalParser(definition.parseOutput, `judgment ${name} parseOutput`),
    strategy,
    model: defineModelSelector(definition.model ?? null, `judgment ${name} model`),
    context: defineContextSelection(definition.context ?? {})
  });
}

export function judgmentView(judgment) {
  return Object.freeze({
    name: judgment.name,
    description: judgment.description,
    typedInput: judgment.parseInput != null,
    typedOutput: judgment.parseOutput != null,
    strategyOverride: judgment.strategy != null
  });
}
