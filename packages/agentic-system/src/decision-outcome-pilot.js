import { randomUUID } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import { join } from "node:path";

import {
  canonicalize,
  digestValue
} from "../../core-harness/src/index.js";

const SUMMARY_KIND = "DECISION_OUTCOME_SUMMARY";
const SUMMARY_VERSION = 1;
const SUMMARY_REF_PREFIX = "decision-outcome://";
const BACKEND_QA_WORKFLOW_KIND = "BACKEND_QA_WORKFLOW";
const QA_COMPLETED_STAGE = "QA_COMPLETED";
const SEMANTIC_MEMORY_KINDS = new Set([
  "EPISODIC",
  "SEMANTIC",
  "PROCEDURAL",
  "REFLECTION",
  "INTENT"
]);

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function requireRecord(value, name) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
  return value;
}

function freezeClone(value) {
  return Object.freeze(structuredClone(value));
}

function normalizeRevision(value, name) {
  if (value == null) return null;
  if (Number.isInteger(value)) {
    invariant(value > 0, `${name} must be positive`);
    return value;
  }
  return requireText(value, name);
}

function normalizeRef(raw, name) {
  const value = requireRecord(raw, name);
  const revision = normalizeRevision(value.revision, `${name}.revision`);
  return Object.freeze({
    kind: requireText(value.kind, `${name}.kind`),
    id: requireText(value.id, `${name}.id`),
    ...(revision == null ? {} : { revision })
  });
}

function normalizeRefs(raw, name) {
  invariant(Array.isArray(raw), `${name} must be an array`);
  return Object.freeze(raw.map((ref, index) => normalizeRef(ref, `${name}[${index}]`)));
}

function sameRef(left, right) {
  if (!left || !right) return false;
  if (left.kind !== right.kind || left.id !== right.id) return false;
  return (left.revision ?? null) === (right.revision ?? null);
}

function hasRef(refs, target) {
  return refs.some((ref) => sameRef(ref, target));
}

function artifactIdentity(artifact, refKind = null) {
  if (artifact?.artifactRef?.kind && artifact?.artifactRef?.id) return artifact.artifactRef;
  if (refKind === "MEMORY" && artifact?.id && SEMANTIC_MEMORY_KINDS.has(artifact.kind)) {
    return { kind: "MEMORY", id: artifact.id, ...(artifact.revision == null ? {} : { revision: artifact.revision }) };
  }
  if (artifact?.kind && artifact?.id) return { kind: artifact.kind, id: artifact.id, ...(artifact.revision == null ? {} : { revision: artifact.revision }) };
  if (artifact?.operationId) return { kind: "EFFECT_OPERATION", id: artifact.operationId };
  if (artifact?.id) return { kind: null, id: artifact.id, ...(artifact.revision == null ? {} : { revision: artifact.revision }) };
  return null;
}

function assertArtifactMatchesRef(artifact, ref, label) {
  invariant(artifact && typeof artifact === "object", `${label} artifact is required`);
  const identity = artifactIdentity(artifact, ref.kind);
  invariant(identity?.id === ref.id, `${label} id mismatch`);
  if (identity.kind != null) invariant(identity.kind === ref.kind, `${label} kind mismatch`);
  if (ref.revision != null) {
    const actualRevision = artifact.revision ?? identity?.revision ?? null;
    invariant(actualRevision === ref.revision, `${label} revision mismatch`);
  }
}

function pin(ref, artifact) {
  return Object.freeze({ ref: freezeClone(ref), digest: digestValue(artifact) });
}

function normalizeChain(raw) {
  const value = requireRecord(raw, "decision outcome chain");
  return Object.freeze({
    deliberationRef: normalizeRef(value.deliberationRef, "decision outcome chain.deliberationRef"),
    actionIntentRef: normalizeRef(value.actionIntentRef, "decision outcome chain.actionIntentRef"),
    evaluationRef: normalizeRef(value.evaluationRef, "decision outcome chain.evaluationRef"),
    intentRef: normalizeRef(value.intentRef, "decision outcome chain.intentRef"),
    reflectionRef: normalizeRef(value.reflectionRef, "decision outcome chain.reflectionRef"),
    groundingRef: normalizeRef(value.groundingRef, "decision outcome chain.groundingRef"),
    alignmentRef: normalizeRef(value.alignmentRef, "decision outcome chain.alignmentRef"),
    counterEvidenceRefs: normalizeRefs(value.counterEvidenceRefs ?? [], "decision outcome chain.counterEvidenceRefs")
  });
}

function normalizeJudgment(raw) {
  const value = requireRecord(raw, "deliberation.judgment");
  invariant(Array.isArray(value.alternatives) && value.alternatives.length > 0, "deliberation.judgment.alternatives must be non-empty");
  const uncertainty = value.uncertainty == null
    ? []
    : Array.isArray(value.uncertainty)
      ? value.uncertainty.map((item, index) => requireText(item, `deliberation.judgment.uncertainty[${index}]`))
      : [requireText(value.uncertainty, "deliberation.judgment.uncertainty")];
  return Object.freeze({
    hypothesis: requireText(value.hypothesis, "deliberation.judgment.hypothesis"),
    alternatives: Object.freeze(value.alternatives.map((item, index) => requireText(item, `deliberation.judgment.alternatives[${index}]`))),
    selected: requireText(value.selected, "deliberation.judgment.selected"),
    rationale: requireText(value.rationale, "deliberation.judgment.rationale"),
    uncertainty: Object.freeze(uncertainty)
  });
}

function observedOutcomeStatus(evaluation) {
  if (evaluation?.verdict === "PASS") return "SUCCESS";
  if (evaluation?.verdict === "BLOCKED") return "BLOCKED";
  return "PARTIAL_FAILURE";
}

async function readResolved(resolver, ref, label) {
  const artifact = await resolver.readArtifact({ ref: freezeClone(ref) });
  invariant(artifact != null, `${label} unavailable`);
  assertArtifactMatchesRef(artifact, ref, label);
  return freezeClone(artifact);
}

function assertChainRelations({ chain, deliberation, actionIntent, effect, evaluation, intent, reflection, grounding, alignment }) {
  const judgment = normalizeJudgment(deliberation.judgment);
  invariant(sameRef(deliberation.actionIntentRef, chain.actionIntentRef), "deliberation ActionIntent ref mismatch");
  invariant(sameRef(actionIntent.deliberationRef, chain.deliberationRef), "ActionIntent deliberation ref mismatch");
  invariant(actionIntent.status === "EXECUTED", "decision outcome summary requires an EXECUTED ActionIntent");
  invariant(actionIntent.authorization?.decision === "ALLOW", "decision outcome summary requires authorized action");
  invariant(Array.isArray(actionIntent.outcomeRefs) && actionIntent.outcomeRefs.length > 0, "decision outcome summary requires ActionIntent outcome refs");

  const effectRef = actionIntent.outcomeRefs.find((ref) => ref.kind === "EFFECT_OPERATION") ?? null;
  invariant(effectRef != null, "decision outcome summary requires an EFFECT_OPERATION outcome ref");
  invariant(effect.status === "CONFIRMED", "decision outcome summary effect must be CONFIRMED");
  invariant(sameRef(effect.actionIntentRef, chain.actionIntentRef), "effect ActionIntent ref mismatch");
  if (effect.resultRef != null) invariant(hasRef(actionIntent.outcomeRefs, effect.resultRef), "effect result ref is missing from ActionIntent outcomes");

  invariant(evaluation.validity == null || evaluation.validity === "VALID", "decision outcome evaluation must be VALID when validity is present");
  invariant(typeof evaluation.verdict === "string", "decision outcome evaluation verdict is required");
  invariant(intent.kind === "INTENT" && intent.status === "ACTIVE", "decision outcome intent memory must be ACTIVE INTENT");
  invariant(reflection.kind === "REFLECTION" && reflection.status === "ACTIVE", "decision outcome reflection memory must be ACTIVE REFLECTION");
  invariant(hasRef(reflection.sourceRefs ?? [], chain.evaluationRef), "reflection omits current evaluation source");
  invariant(hasRef(reflection.sourceRefs ?? [], chain.intentRef), "reflection omits exact intent source");

  invariant(grounding.verdict === "GROUNDED", "decision outcome reflection grounding must be GROUNDED");
  invariant((grounding.sourceSnapshots ?? []).some((snapshot) => sameRef(snapshot.ref, chain.evaluationRef)), "grounding omits current evaluation");
  invariant((grounding.sourceSnapshots ?? []).some((snapshot) => sameRef(snapshot.ref, chain.intentRef)), "grounding omits exact intent source");

  invariant(sameRef(alignment.intentRef, chain.intentRef), "alignment intent ref mismatch");
  invariant(sameRef(alignment.reflectionRef, chain.reflectionRef), "alignment reflection ref mismatch");
  invariant(sameRef(alignment.groundingRef, chain.groundingRef), "alignment grounding ref mismatch");
  invariant(hasRef(alignment.evaluationRefs ?? [], chain.evaluationRef), "alignment omits current evaluation");

  const observedStatus = observedOutcomeStatus(evaluation);
  if (observedStatus !== "SUCCESS") {
    invariant(hasRef(chain.counterEvidenceRefs, chain.evaluationRef), "non-success outcome must retain the current evaluation as counterevidence");
  }
  return Object.freeze({ judgment, effectRef: normalizeRef(effectRef, "ActionIntent effect ref"), observedStatus });
}

async function resolveChain(resolver, rawChain) {
  invariant(resolver && typeof resolver.readArtifact === "function", "decision outcome artifactResolver requires readArtifact()");
  const chain = normalizeChain(rawChain);
  const deliberation = await readResolved(resolver, chain.deliberationRef, "deliberation");
  const actionIntent = await readResolved(resolver, chain.actionIntentRef, "ActionIntent");
  const effectRef = normalizeRef((actionIntent.outcomeRefs ?? []).find((ref) => ref.kind === "EFFECT_OPERATION"), "ActionIntent effect ref");
  const effect = await readResolved(resolver, effectRef, "effect operation");
  const evaluation = await readResolved(resolver, chain.evaluationRef, "evaluation");
  const intent = await readResolved(resolver, chain.intentRef, "intent memory");
  const reflection = await readResolved(resolver, chain.reflectionRef, "reflection memory");
  const grounding = await readResolved(resolver, chain.groundingRef, "grounding");
  const alignment = await readResolved(resolver, chain.alignmentRef, "intent/reflection alignment");
  const counterEvidence = [];
  for (const ref of chain.counterEvidenceRefs) counterEvidence.push(await readResolved(resolver, ref, "counterevidence"));
  const derived = assertChainRelations({ chain, deliberation, actionIntent, effect, evaluation, intent, reflection, grounding, alignment });
  return Object.freeze({
    chain,
    deliberation,
    actionIntent,
    effect,
    evaluation,
    intent,
    reflection,
    grounding,
    alignment,
    counterEvidence: Object.freeze(counterEvidence),
    derived
  });
}

function summaryBody({ itemId, submission, resolved }) {
  const { chain, deliberation, actionIntent, effect, evaluation, intent, reflection, grounding, alignment, counterEvidence, derived } = resolved;
  const pins = {
    deliberation: pin(chain.deliberationRef, deliberation),
    actionIntent: pin(chain.actionIntentRef, actionIntent),
    effect: pin(derived.effectRef, effect),
    evaluation: pin(chain.evaluationRef, evaluation),
    intent: pin(chain.intentRef, intent),
    reflection: pin(chain.reflectionRef, reflection),
    grounding: pin(chain.groundingRef, grounding),
    alignment: pin(chain.alignmentRef, alignment),
    counterEvidence: chain.counterEvidenceRefs.map((ref, index) => pin(ref, counterEvidence[index]))
  };
  return Object.freeze({
    kind: SUMMARY_KIND,
    version: SUMMARY_VERSION,
    workItemId: requireText(itemId, "decision outcome workItemId"),
    workflow: {
      kind: requireText(submission.kind, "decision outcome submission.kind"),
      attempt: Number.isInteger(submission.workflowAttempt) ? submission.workflowAttempt : 0,
      baselineRevision: requireText(submission.workflowSpec?.backendObjective?.repository?.revision, "decision outcome baseline revision"),
      acceptedRevision: requireText(submission.acceptedRevision, "decision outcome accepted revision")
    },
    objective: requireText(submission.workflowSpec?.backendObjective?.task, "decision outcome objective"),
    hypothesis: derived.judgment.hypothesis,
    alternatives: derived.judgment.alternatives,
    decision: {
      selected: derived.judgment.selected,
      rationale: derived.judgment.rationale,
      uncertainty: derived.judgment.uncertainty,
      deliberationRef: freezeClone(chain.deliberationRef)
    },
    action: {
      actionIntentRef: freezeClone(chain.actionIntentRef),
      action: freezeClone(actionIntent.action),
      authorization: freezeClone(actionIntent.authorization),
      outcomeRefs: freezeClone(actionIntent.outcomeRefs)
    },
    observedOutcome: {
      status: derived.observedStatus,
      evaluationRefs: Object.freeze([freezeClone(chain.evaluationRef)]),
      statement: requireText(reflection.content, "decision outcome reflection content")
    },
    reflection: {
      intentRef: freezeClone(chain.intentRef),
      reflectionRef: freezeClone(chain.reflectionRef),
      groundingRef: freezeClone(chain.groundingRef),
      alignmentRef: freezeClone(chain.alignmentRef),
      status: requireText(alignment.status, "decision outcome alignment status"),
      divergence: alignment.divergence ?? null
    },
    counterEvidenceRefs: freezeClone(chain.counterEvidenceRefs),
    sourcePins: freezeClone(pins),
    authority: {
      rationaleIsCorrectnessEvidence: false,
      summaryIsAcceptanceAuthority: false,
      acceptanceMustResolveEvidenceRefs: true
    }
  });
}

function finalizeSummary(body) {
  const digest = digestValue(body);
  return Object.freeze({
    ...freezeClone(body),
    id: `decision-outcome:${digest}`,
    digest
  });
}

function validateSummary(raw) {
  const value = requireRecord(raw, "DecisionOutcomeSummary");
  invariant(value.kind === SUMMARY_KIND && value.version === SUMMARY_VERSION, "DecisionOutcomeSummary kind/version is invalid");
  const body = structuredClone(value);
  delete body.id;
  delete body.digest;
  const digest = digestValue(body);
  invariant(value.digest === digest, "DecisionOutcomeSummary digest mismatch");
  invariant(value.id === `decision-outcome:${digest}`, "DecisionOutcomeSummary id mismatch");
  invariant(value.authority?.rationaleIsCorrectnessEvidence === false, "DecisionOutcomeSummary widened rationale authority");
  invariant(value.authority?.summaryIsAcceptanceAuthority === false, "DecisionOutcomeSummary widened acceptance authority");
  invariant(value.authority?.acceptanceMustResolveEvidenceRefs === true, "DecisionOutcomeSummary exact-ref verification requirement is missing");
  return freezeClone(value);
}

function summaryRef(summary) {
  return `${SUMMARY_REF_PREFIX}${summary.digest.slice("sha256:".length)}`;
}

function parseSummaryRef(ref) {
  const value = requireText(ref, "decision outcome summary ref");
  invariant(value.startsWith(SUMMARY_REF_PREFIX), "decision outcome summary ref prefix is invalid");
  const hex = value.slice(SUMMARY_REF_PREFIX.length);
  invariant(/^[0-9a-f]{64}$/.test(hex), "decision outcome summary ref digest is invalid");
  return `sha256:${hex}`;
}

function summaryFileName(digest) {
  return `decision-outcome-${digest.slice("sha256:".length)}.json`;
}

export function createJsonDecisionOutcomeSummaryStore({ path, fs = nodeFs }) {
  requireText(path, "decision outcome summary store path");
  invariant(fs && typeof fs.mkdir === "function" && typeof fs.open === "function" && typeof fs.readFile === "function" && typeof fs.link === "function" && typeof fs.unlink === "function", "decision outcome summary store requires filesystem mkdir/open/read/link/unlink capability");

  async function put(rawSummary) {
    const summary = validateSummary(rawSummary);
    await fs.mkdir(path, { recursive: true });
    const fileName = summaryFileName(summary.digest);
    const filePath = join(path, fileName);
    const tempPath = join(path, `.${fileName}.${randomUUID()}.tmp`);
    const serialized = `${JSON.stringify(summary, null, 2)}\n`;
    let handle = null;
    let tempExists = false;
    try {
      handle = await fs.open(tempPath, "wx");
      tempExists = true;
      await handle.writeFile(serialized, "utf8");
      await handle.close();
      handle = null;
      try {
        await fs.link(tempPath, filePath);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = validateSummary(JSON.parse(await fs.readFile(filePath, "utf8")));
        invariant(canonicalize(existing) === canonicalize(summary), "decision outcome summary digest already exists with different content");
      }
    } finally {
      if (handle != null) await handle.close();
      if (tempExists) {
        try {
          await fs.unlink(tempPath);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    }
    return summaryRef(summary);
  }

  async function read(ref) {
    const digest = parseSummaryRef(ref);
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(join(path, summaryFileName(digest)), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`decision outcome summary unavailable: ${ref}`);
      throw error;
    }
    const summary = validateSummary(raw);
    invariant(summary.digest === digest, `decision outcome summary ref mismatch: ${ref}`);
    return summary;
  }

  return Object.freeze({ put, read });
}

function requireSummaryStore(store) {
  invariant(store && typeof store.put === "function" && typeof store.read === "function", "decision outcome summaryStore requires put()/read()");
  return store;
}

function requireChainProvider(provider) {
  invariant(provider && typeof provider.resolve === "function", "decision outcome chainProvider requires resolve()");
  return provider;
}

async function verifyPin(resolver, pinValue, label) {
  const value = requireRecord(pinValue, `${label} pin`);
  const ref = normalizeRef(value.ref, `${label} pin.ref`);
  const artifact = await readResolved(resolver, ref, label);
  invariant(digestValue(artifact) === requireText(value.digest, `${label} pin.digest`), `${label} changed after summary materialization`);
  return artifact;
}

export async function verifyDecisionOutcomeSummary(rawSummary, { artifactResolver }) {
  const summary = validateSummary(rawSummary);
  invariant(artifactResolver && typeof artifactResolver.readArtifact === "function", "decision outcome artifactResolver requires readArtifact()");
  const pins = requireRecord(summary.sourcePins, "DecisionOutcomeSummary.sourcePins");
  const deliberation = await verifyPin(artifactResolver, pins.deliberation, "deliberation");
  const actionIntent = await verifyPin(artifactResolver, pins.actionIntent, "ActionIntent");
  const effect = await verifyPin(artifactResolver, pins.effect, "effect operation");
  const evaluation = await verifyPin(artifactResolver, pins.evaluation, "evaluation");
  const intent = await verifyPin(artifactResolver, pins.intent, "intent memory");
  const reflection = await verifyPin(artifactResolver, pins.reflection, "reflection memory");
  const grounding = await verifyPin(artifactResolver, pins.grounding, "grounding");
  const alignment = await verifyPin(artifactResolver, pins.alignment, "intent/reflection alignment");
  const counterEvidencePins = Array.isArray(pins.counterEvidence) ? pins.counterEvidence : [];
  const counterEvidence = [];
  for (let index = 0; index < counterEvidencePins.length; index += 1) {
    counterEvidence.push(await verifyPin(artifactResolver, counterEvidencePins[index], `counterevidence[${index}]`));
  }

  const chain = normalizeChain({
    deliberationRef: summary.decision.deliberationRef,
    actionIntentRef: summary.action.actionIntentRef,
    evaluationRef: summary.observedOutcome.evaluationRefs[0],
    intentRef: summary.reflection.intentRef,
    reflectionRef: summary.reflection.reflectionRef,
    groundingRef: summary.reflection.groundingRef,
    alignmentRef: summary.reflection.alignmentRef,
    counterEvidenceRefs: summary.counterEvidenceRefs
  });
  const derived = assertChainRelations({ chain, deliberation, actionIntent, effect, evaluation, intent, reflection, grounding, alignment });
  invariant(summary.hypothesis === derived.judgment.hypothesis, "summary hypothesis conflicts with deliberation");
  invariant(JSON.stringify(summary.alternatives) === JSON.stringify(derived.judgment.alternatives), "summary alternatives conflict with deliberation");
  invariant(summary.decision.selected === derived.judgment.selected, "summary selected action conflicts with deliberation");
  invariant(summary.decision.rationale === derived.judgment.rationale, "summary rationale conflicts with deliberation");
  invariant(JSON.stringify(summary.decision.uncertainty) === JSON.stringify(derived.judgment.uncertainty), "summary uncertainty conflicts with deliberation");
  invariant(JSON.stringify(summary.action.authorization) === JSON.stringify(actionIntent.authorization), "summary authorization conflicts with ActionIntent");
  invariant(JSON.stringify(summary.action.outcomeRefs) === JSON.stringify(actionIntent.outcomeRefs), "summary outcome refs conflict with ActionIntent");
  invariant(summary.observedOutcome.status === derived.observedStatus, "summary observed outcome conflicts with evaluation");
  invariant(summary.observedOutcome.statement === reflection.content, "summary observed outcome statement conflicts with grounded reflection");
  invariant(summary.reflection.status === alignment.status, "summary alignment status conflicts with alignment artifact");
  invariant(summary.reflection.divergence === (alignment.divergence ?? null), "summary alignment divergence conflicts with alignment artifact");

  return freezeClone({
    summary,
    resolved: { deliberation, actionIntent, effect, evaluation, intent, reflection, grounding, alignment, counterEvidence }
  });
}

export function createDecisionOutcomeBackendQaPilot({
  chainProvider,
  artifactResolver,
  summaryStore
}) {
  const provider = requireChainProvider(chainProvider);
  const store = requireSummaryStore(summaryStore);
  invariant(artifactResolver && typeof artifactResolver.readArtifact === "function", "decision outcome artifactResolver requires readArtifact()");

  async function materialize({ itemId, submission }) {
    invariant(submission?.kind === BACKEND_QA_WORKFLOW_KIND && submission?.stage === QA_COMPLETED_STAGE, "decision outcome pilot requires QA_COMPLETED Backend/QA submission");
    const chain = await provider.resolve({ itemId, submission: freezeClone(submission) });
    const resolved = await resolveChain(artifactResolver, chain);
    const summary = finalizeSummary(summaryBody({ itemId, submission, resolved }));
    const ref = await store.put(summary);
    return Object.freeze({ ref, summary });
  }

  function decorateOrchestrator(orchestrator) {
    invariant(orchestrator && typeof orchestrator.submit === "function" && typeof orchestrator.block === "function", "decision outcome pilot requires submit/block capable orchestrator");
    return Object.freeze({
      ...orchestrator,
      async submit(args) {
        if (args?.submission?.kind !== BACKEND_QA_WORKFLOW_KIND || args?.submission?.stage !== QA_COMPLETED_STAGE) {
          return orchestrator.submit(args);
        }
        let materialized;
        try {
          materialized = await materialize({ itemId: args.itemId, submission: args.submission });
        } catch (error) {
          await orchestrator.block({
            itemId: args.itemId,
            owner: args.owner,
            generation: args.generation,
            blockers: [`Decision/outcome summary materialization failed: ${error.message}`]
          });
          throw error;
        }
        const artifactRefs = [...new Set([...(args.submission.artifactRefs ?? []), materialized.ref])];
        return orchestrator.submit({
          ...args,
          submission: {
            ...args.submission,
            artifactRefs,
            decisionOutcomeSummaryRef: materialized.ref
          }
        });
      }
    });
  }

  function createApplicationArtifactReader(fallbackArtifactReader) {
    invariant(fallbackArtifactReader && typeof fallbackArtifactReader.readArtifact === "function", "decision outcome application reader requires fallback readArtifact()");
    return Object.freeze({
      async readArtifact(args) {
        const ref = requireText(args?.ref, "application artifact ref");
        if (!ref.startsWith(SUMMARY_REF_PREFIX)) return fallbackArtifactReader.readArtifact(args);
        const summary = await store.read(ref);
        const verified = await verifyDecisionOutcomeSummary(summary, { artifactResolver });
        return Object.freeze({
          content: `${JSON.stringify(verified.summary, null, 2)}\n`,
          sourceRef: ref
        });
      }
    });
  }

  return Object.freeze({ materialize, decorateOrchestrator, createApplicationArtifactReader });
}

export const DecisionOutcomeSummaryKind = SUMMARY_KIND;
export const DecisionOutcomeSummaryVersion = SUMMARY_VERSION;
