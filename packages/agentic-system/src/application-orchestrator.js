import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { subjectFromValue } from "../../core-harness/src/index.js";
import {
  BlackboardStatus,
  ReviewRequirementSource
} from "./blackboard-orchestrator.js";
import { createApplicationOrchestrator as createBaseApplicationOrchestrator } from "./application-orchestrator-base.js";

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function requireText(value, name) {
  invariant(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
  return value;
}

function requirePositiveInteger(value, name) {
  invariant(Number.isInteger(value) && value > 0, `${name} must be a positive integer`);
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeTextArray(value, name) {
  invariant(Array.isArray(value ?? []), `${name} must be an array`);
  return [...new Set((value ?? []).map((item, index) => requireText(item, `${name}[${index}]`)))];
}

function findItem(snapshot, itemId) {
  const item = snapshot.items.find((candidate) => candidate.id === itemId);
  invariant(item, `Blackboard item not found: ${itemId}`);
  return item;
}

function assertClaim(item, itemId, owner, generation) {
  invariant(item.status === BlackboardStatus.CLAIMED, `Blackboard item ${itemId} must be CLAIMED before required-review submit`);
  invariant(item.owner === owner, `Blackboard item ${itemId} is claimed by another owner`);
  invariant(item.claimGeneration === generation, `Blackboard item ${itemId} claim generation is stale`);
}

function removeResolvedWork(item, resolvedWork) {
  const resolved = normalizeTextArray(resolvedWork, "resolvedWork");
  for (const work of resolved) {
    invariant(item.remainingWork.includes(work), `resolvedWork is not an outstanding current obligation: ${work}`);
  }
  item.remainingWork = item.remainingWork.filter((work) => !resolved.includes(work));
}

function normalizeReviewRequirements(rawRequirements) {
  invariant(Array.isArray(rawRequirements), "reviewRequirements must be an array");
  const requirements = rawRequirements.map((raw, index) => {
    invariant(raw && typeof raw === "object" && !Array.isArray(raw), `reviewRequirements[${index}] must be an object`);
    invariant(raw.source === ReviewRequirementSource.PM, `reviewRequirements[${index}].source must be PM`);
    return Object.freeze({
      key: requireText(raw.key, `reviewRequirements[${index}].key`),
      source: ReviewRequirementSource.PM,
      reason: requireText(raw.reason, `reviewRequirements[${index}].reason`)
    });
  });
  invariant(requirements.length > 0, "submitWithRequiredReviews requires at least one PM review requirement");
  invariant(new Set(requirements.map((requirement) => requirement.key)).size === requirements.length, "reviewRequirements must not contain duplicate keys");
  return requirements;
}

function addReviewRequirements(item, requirements) {
  for (const requirement of requirements) {
    const existing = item.reviewRequirements.find((candidate) => candidate.key === requirement.key) ?? null;
    if (existing != null) {
      invariant(existing.source === requirement.source, `review requirement ${requirement.key} changed source`);
      invariant(existing.reason === requirement.reason, `review requirement ${requirement.key} changed reason`);
      continue;
    }
    item.reviewRequirements.push(structuredClone(requirement));
  }
}

export function createApplicationOrchestrator({ store, reviewTrust }) {
  invariant(store && typeof store.load === "function" && typeof store.transact === "function", "ApplicationOrchestrator requires a transactional Blackboard store");
  const base = createBaseApplicationOrchestrator({ store, reviewTrust });

  async function recoverSelfUpgradeEvaluationClaim({
    itemId,
    owner,
    expectedBlocker,
    expectedCheckpoint
  }) {
    const normalizedItemId = requireText(itemId, "itemId");
    const normalizedOwner = requireText(owner, "owner");
    const blocker = requireText(expectedBlocker, "expectedBlocker");
    invariant(
      blocker.startsWith("SELF_UPGRADE_EVALUATION_ATTEMPT:"),
      "self-upgrade recovery blocker must use the bounded evaluation-attempt namespace"
    );
    invariant(
      expectedCheckpoint && typeof expectedCheckpoint === "object" && !Array.isArray(expectedCheckpoint),
      "self-upgrade recovery expectedCheckpoint must be an object"
    );

    const result = await store.transact((snapshot) => {
      const item = findItem(snapshot, normalizedItemId);
      invariant(
        item.status === BlackboardStatus.BLOCKED,
        `Blackboard item ${normalizedItemId} must be BLOCKED before self-upgrade evaluation recovery`
      );
      invariant(
        item.checkpoint?.kind === "RESEARCH_CONTINUATION",
        `Blackboard item ${normalizedItemId} must carry a research-continuation checkpoint`
      );
      invariant(
        item.blockers.length === 1 && item.blockers[0] === blocker,
        `Blackboard item ${normalizedItemId} self-upgrade evaluation blocker changed`
      );
      invariant(
        isDeepStrictEqual(item.checkpoint, expectedCheckpoint),
        `Blackboard item ${normalizedItemId} self-upgrade evaluation checkpoint changed`
      );

      item.claimGeneration += 1;
      item.status = BlackboardStatus.CLAIMED;
      item.owner = normalizedOwner;
      item.blockers = [];
      return structuredClone(item);
    });

    return Object.freeze(structuredClone(result));
  }

  async function submitWithRequiredReviews({
    itemId,
    owner,
    generation,
    submission,
    resolvedWork = [],
    reviewRequirements
  }) {
    requireText(itemId, "itemId");
    requireText(owner, "owner");
    requirePositiveInteger(generation, "generation");
    invariant(submission && typeof submission === "object" && !Array.isArray(submission), "submission must be an object");
    invariant(Array.isArray(resolvedWork), "resolvedWork must be an array");
    const requirements = normalizeReviewRequirements(reviewRequirements);

    subjectFromValue({ itemId, submission }, {
      type: "blackboard-submission",
      producer: { identity: owner, roles: ["producer"] }
    });

    const result = await store.transact((snapshot) => {
      const item = findItem(snapshot, itemId);
      assertClaim(item, itemId, owner, generation);
      removeResolvedWork(item, resolvedWork);
      addReviewRequirements(item, requirements);

      item.checkpoint = null;
      item.checkpointedBy = null;
      item.submission = structuredClone(submission);
      item.submittedBy = owner;
      item.owner = null;
      item.activeReview = null;
      item.reviews = [];
      item.findings = [];
      item.blockers = [];
      item.status = BlackboardStatus.PENDING_REVIEW;
      return structuredClone(item);
    });

    return Object.freeze(structuredClone(result));
  }


  async function resolveBlockedCheckpoint({
    itemId,
    checkpointedBy,
    expectedCheckpoint,
    checkpoint
  }) {
    requireText(itemId, "itemId");
    requireText(checkpointedBy, "checkpointedBy");
    invariant(expectedCheckpoint && typeof expectedCheckpoint === "object" && !Array.isArray(expectedCheckpoint), "expectedCheckpoint must be an object");
    invariant(checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint), "checkpoint must be an object");

    const result = await store.transact((snapshot) => {
      const item = findItem(snapshot, itemId);
      invariant(item.status === BlackboardStatus.BLOCKED, `Blackboard item ${itemId} must be BLOCKED before blocked-checkpoint resolution`);
      invariant(item.owner == null, `Blackboard item ${itemId} cannot resolve a blocked checkpoint while owned`);
      invariant(
        isDeepStrictEqual(item.checkpoint, expectedCheckpoint),
        `Blackboard item ${itemId} blocked checkpoint changed before resolution`
      );

      item.checkpoint = structuredClone(checkpoint);
      item.checkpointedBy = checkpointedBy;
      item.owner = null;
      item.blockers = [];
      item.status = BlackboardStatus.REOPENED;
      return structuredClone(item);
    });

    return Object.freeze(structuredClone(result));
  }
  async function materializeAcceptedWork({
    itemId,
    work,
    owningDomain,
    workloadType,
    dependencyIds = [],
    obligationSubjectKey,
    materializationKey,
    workContractRef,
    authorizationId,
    authorizationRef,
    authorizationGeneration,
    authorizationRevision,
    implementationArtifactRef,
    projectId,
    rootItemId,
    rootIntentId,
    revalidateAuthorization
  }) {
    const normalizedItemId=requireText(itemId,"itemId");
    const normalizedWork=requireText(work,"work");
    const normalizedDomain=requireText(owningDomain,"owningDomain");
    const normalizedWorkload=requireText(workloadType,"workloadType");
    const normalizedDependencyIds=normalizeTextArray(dependencyIds,"dependencyIds");
    const normalizedObligationSubjectKey=requireText(obligationSubjectKey,"obligationSubjectKey");
    const normalizedKey=requireText(materializationKey,"materializationKey");
    invariant(normalizedItemId==="ORG-"+normalizedKey.slice(0,24),"organization materialization itemId is not canonical for materializationKey");
    const normalizedContractRef=requireText(workContractRef,"workContractRef");
    const normalizedAuthorizationId=requireText(authorizationId,"authorizationId");
    const normalizedAuthorizationRef=requireText(authorizationRef,"authorizationRef");
    const normalizedAuthorizationGeneration=requirePositiveInteger(authorizationGeneration,"authorizationGeneration");
    const normalizedAuthorizationRevision=requireText(authorizationRevision,"authorizationRevision");
    const normalizedImplementationArtifactRef=requireText(implementationArtifactRef,"implementationArtifactRef");
    const normalizedProjectId=requireText(projectId,"projectId");
    const normalizedRootItemId=requireText(rootItemId,"rootItemId");
    const normalizedRootIntentId=requireText(rootIntentId,"rootIntentId");
    invariant(typeof revalidateAuthorization==="function","revalidateAuthorization must be a function");

    const result=await store.transact(async(snapshot)=>{
      const root=findItem(snapshot,normalizedRootItemId);
      invariant(root.origin?.kind==="USER_INTENT_ROOT","organization materialization root kind mismatch");
      invariant(root.origin?.projectId===normalizedProjectId,"organization materialization project mismatch");
      invariant(root.origin?.userIntent?.id===normalizedRootIntentId,"organization materialization root intent mismatch");
      invariant(root.status===BlackboardStatus.DONE,"organization materialization root must remain DONE");
      invariant(await revalidateAuthorization()===true,"materialization authorization revalidation failed");

      const existing=snapshot.items.find((candidate)=>candidate.id===normalizedItemId)??null;
      if(existing){
        invariant(existing.origin?.kind==="ORGANIZATION_MATERIALIZATION","Blackboard item "+normalizedItemId+" conflicts with deterministic materialization");
        invariant(existing.origin.obligationSubjectKey===normalizedObligationSubjectKey,"Blackboard item "+normalizedItemId+" logical obligation subject conflicts");
        invariant(existing.origin.materializationKey===normalizedKey,"Blackboard item "+normalizedItemId+" materialization key conflicts");
        invariant(existing.origin.workContractRef===normalizedContractRef,"Blackboard item "+normalizedItemId+" work contract conflicts");
        invariant(existing.origin.projectId===normalizedProjectId&&existing.origin.rootItemId===normalizedRootItemId&&existing.origin.rootIntentId===normalizedRootIntentId,"Blackboard item "+normalizedItemId+" project/root binding conflicts");
        invariant(existing.origin.authorizationId===normalizedAuthorizationId,"Blackboard item "+normalizedItemId+" authorization subject conflicts");
        invariant(existing.origin.authorizationRef===normalizedAuthorizationRef&&existing.origin.authorizationGeneration===normalizedAuthorizationGeneration&&existing.origin.authorizationRevision===normalizedAuthorizationRevision,"Blackboard item "+normalizedItemId+" authorization observation conflicts");
        invariant(existing.origin.implementationArtifactRef===normalizedImplementationArtifactRef,"Blackboard item "+normalizedItemId+" implementation artifact conflicts");
        const expectedDependencies=[...new Set([normalizedRootItemId,...normalizedDependencyIds])];
        invariant(JSON.stringify(existing.dependsOn)===JSON.stringify(expectedDependencies),"Blackboard item "+normalizedItemId+" dependency set conflicts");
        return structuredClone(existing);
      }

      const conflictingLive=snapshot.items.find((candidate)=>
        candidate.origin?.kind==="ORGANIZATION_MATERIALIZATION"&&
        candidate.origin.obligationSubjectKey===normalizedObligationSubjectKey&&
        ![BlackboardStatus.DONE,BlackboardStatus.SUPERSEDED].includes(candidate.status)
      )??null;
      invariant(conflictingLive==null,"live organization work already exists for obligationSubjectKey");

      for(const dependencyId of normalizedDependencyIds){
        invariant(dependencyId!==normalizedItemId,"organization materialization cannot depend on itself");
        findItem(snapshot,dependencyId);
      }

      const item={
        id:normalizedItemId,
        work:normalizedWork,
        status:BlackboardStatus.READY,
        owner:null,
        claimGeneration:0,
        reviewGeneration:0,
        dependsOn:[...new Set([normalizedRootItemId,...normalizedDependencyIds])],
        remainingWork:[],
        blockers:[],
        artifactRefs:[normalizedContractRef],
        evidenceRefs:[normalizedAuthorizationRef],
        followUpRefs:[],
        checkpoint:null,
        checkpointedBy:null,
        submission:null,
        submittedBy:null,
        reviewRequirements:[],
        reviews:[],
        findings:[],
        activeReview:null,
        origin:{
          kind:"ORGANIZATION_MATERIALIZATION",
          projectId:normalizedProjectId,
          rootItemId:normalizedRootItemId,
          rootIntentId:normalizedRootIntentId,
          owningDomain:normalizedDomain,
          workloadType:normalizedWorkload,
          obligationSubjectKey:normalizedObligationSubjectKey,
          materializationKey:normalizedKey,
          workContractRef:normalizedContractRef,
          authorizationId:normalizedAuthorizationId,
          authorizationRef:normalizedAuthorizationRef,
          authorizationGeneration:normalizedAuthorizationGeneration,
          authorizationRevision:normalizedAuthorizationRevision,
          implementationArtifactRef:normalizedImplementationArtifactRef
        }
      };
      snapshot.items.push(item);
      return structuredClone(item);
    });
    return Object.freeze(structuredClone(result));
  }

  async function blockOrganizationMaterialization({
    itemId,
    authorizationRef,
    authorizationGeneration,
    reasonRef
  }) {
    const normalizedItemId=requireText(itemId,"itemId");
    const normalizedAuthorizationRef=requireText(authorizationRef,"authorizationRef");
    const normalizedAuthorizationGeneration=requirePositiveInteger(authorizationGeneration,"authorizationGeneration");
    const normalizedReasonRef=requireText(reasonRef,"reasonRef");
    const blocker="WORK_AUTHORIZATION_INVALIDATED:"+normalizedReasonRef;

    const result=await store.transact((snapshot)=>{
      const item=findItem(snapshot,normalizedItemId);
      invariant(item.origin?.kind==="ORGANIZATION_MATERIALIZATION","organization materialization blocker requires organization-managed work");
      invariant(item.origin.authorizationRef===normalizedAuthorizationRef,"organization materialization authorization ref changed");
      invariant(item.origin.authorizationGeneration===normalizedAuthorizationGeneration,"organization materialization authorization generation changed");
      if(item.status===BlackboardStatus.BLOCKED&&item.blockers.includes(blocker)) return structuredClone(item);
      invariant(item.status===BlackboardStatus.READY||item.status===BlackboardStatus.REOPENED,"organization materialization can only be blocked while eligible");
      if(!item.evidenceRefs.includes(normalizedReasonRef)) item.evidenceRefs.push(normalizedReasonRef);
      item.owner=null;
      item.blockers=[blocker];
      item.status=BlackboardStatus.BLOCKED;
      return structuredClone(item);
    });
    return Object.freeze(structuredClone(result));
  }

  async function invalidateOrganizationClaim({
    itemId,
    expectedOwner,
    expectedClaimGeneration,
    kind,
    invalidationRef,
    invalidation
  }) {
    const normalizedItemId=requireText(itemId,"itemId");
    const normalizedOwner=requireText(expectedOwner,"expectedOwner");
    const normalizedGeneration=requirePositiveInteger(expectedClaimGeneration,"expectedClaimGeneration");
    const normalizedRef=requireText(invalidationRef,"invalidationRef");
    invariant(invalidation&&typeof invalidation==="object"&&!Array.isArray(invalidation),"invalidation artifact is required");
    invariant(invalidation.kind==="CLAIM_AUTHORITY_INVALIDATION"&&invalidation.version===1,"claim authority invalidation artifact is invalid");
    invariant(
      ["EXECUTION_AUTHORITY_INVALIDATED","ABANDONED_PROVISIONAL_CLAIM","WORK_AUTHORIZATION_INVALIDATED"].includes(kind),
      "organization claim invalidation kind is invalid"
    );
    invariant(invalidation.itemId===normalizedItemId,"claim invalidation item mismatch");
    invariant(invalidation.expectedOwner===normalizedOwner,"claim invalidation owner mismatch");
    invariant(invalidation.expectedClaimGeneration===normalizedGeneration,"claim invalidation generation mismatch");
    invariant(invalidation.cause===kind,"claim invalidation cause mismatch");
    invariant("claim-authority-invalidation:sha256:"+digest(invalidation)===normalizedRef,"claim invalidation ref/content mismatch");

    const result=await store.transact((snapshot)=>{
      const item=findItem(snapshot,normalizedItemId);
      invariant(item.status===BlackboardStatus.CLAIMED,"Blackboard item "+normalizedItemId+" must be CLAIMED before organization invalidation");
      invariant(item.owner===normalizedOwner,"Blackboard item "+normalizedItemId+" owner changed before organization invalidation");
      invariant(item.claimGeneration===normalizedGeneration,"Blackboard item "+normalizedItemId+" claim generation changed before organization invalidation");
      invariant(item.origin?.projectId===invalidation.projectId&&item.origin?.rootItemId===invalidation.rootItemId&&item.origin?.rootIntentId===invalidation.rootIntentId,"claim invalidation project/root mismatch");
      if(!item.evidenceRefs.includes(normalizedRef)) item.evidenceRefs.push(normalizedRef);
      item.owner=null;
      item.activeReview=null;
      if(kind==="WORK_AUTHORIZATION_INVALIDATED"){
        item.blockers=["WORK_AUTHORIZATION_INVALIDATED:"+normalizedRef];
        item.status=BlackboardStatus.BLOCKED;
      }else{
        item.blockers=[];
        item.status=BlackboardStatus.REOPENED;
      }
      return structuredClone(item);
    });
    return Object.freeze(structuredClone(result));
  }

  async function withOrganizationLifecycleMutation(action) {
    invariant(typeof action === "function", "organization lifecycle mutation requires action");
    invariant(typeof store.withMutationFence === "function", "Blackboard store mutation fence is required for organization lifecycle mutation");
    return store.withMutationFence(async () => action());
  }

  async function withOrganizationClaimGuard({ itemId, expectedOwner, expectedClaimGeneration }, action) {
    const normalizedItemId = requireText(itemId, "itemId");
    const owner = requireText(expectedOwner, "expectedOwner");
    const generation = requirePositiveInteger(expectedClaimGeneration, "expectedClaimGeneration");
    invariant(typeof action === "function", "withOrganizationClaimGuard requires action");
    invariant(typeof store.withMutationFence === "function", "Blackboard store mutation fence is required for guarded organization publication");

    return store.withMutationFence(async ({ token, snapshot }) => {
      const item = findItem(snapshot, normalizedItemId);
      invariant(item.status === BlackboardStatus.CLAIMED, `Blackboard item ${normalizedItemId} must remain CLAIMED during guarded mutation`);
      invariant(item.owner === owner, `Blackboard item ${normalizedItemId} owner changed during guarded mutation`);
      invariant(item.claimGeneration === generation, `Blackboard item ${normalizedItemId} claim generation changed during guarded mutation`);
      const observation = Object.freeze({
        itemId: normalizedItemId,
        status: item.status,
        owner: item.owner,
        claimGeneration: item.claimGeneration,
        boardRevision: token,
        lifecycleRevision: digest({
          boardRevision: token,
          itemId: item.id,
          status: item.status,
          owner: item.owner,
          claimGeneration: item.claimGeneration,
          origin: item.origin
        })
      });
      return Object.freeze({
        observation,
        result: await action(observation)
      });
    });
  }

  return Object.freeze({
    ...base,
    claim:(input)=>withOrganizationLifecycleMutation(()=>base.claim(input)),
    recoverClaim:(input)=>withOrganizationLifecycleMutation(()=>base.recoverClaim(input)),
    checkpoint:(input)=>withOrganizationLifecycleMutation(()=>base.checkpoint(input)),
    submit:(input)=>withOrganizationLifecycleMutation(()=>base.submit(input)),
    block:(input)=>withOrganizationLifecycleMutation(()=>base.block(input)),
    supersede:(input)=>withOrganizationLifecycleMutation(()=>base.supersede(input)),
    recoverSelfUpgradeEvaluationClaim,
    submitWithRequiredReviews:(input)=>withOrganizationLifecycleMutation(()=>submitWithRequiredReviews(input)),
    resolveBlockedCheckpoint,
    materializeAcceptedWork,
    blockOrganizationMaterialization,
    invalidateOrganizationClaim:(input)=>withOrganizationLifecycleMutation(()=>invalidateOrganizationClaim(input)),
    withOrganizationClaimGuard
  });
}
