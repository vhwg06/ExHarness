import { ResourceState } from './resource-state.mjs';

async function readInput() {
  let body = '';
  for await (const chunk of process.stdin) body += chunk;
  return JSON.parse(body);
}

let identity = null;
let action = null;
try {
  ({ resource: identity, action } = await readInput());
  if (!identity?.journalPath || !identity?.experimentId || !action?.kind) throw new Error('resource bridge input is incomplete');
  const resource = new ResourceState(identity);
  let result;
  switch (action.kind) {
    case 'reserve':
      result = await resource.reserve(action);
      break;
    case 'sendStarted':
      result = await resource.sendStarted(action);
      break;
    case 'settled':
      result = await resource.settled(action);
      break;
    case 'unknown':
      result = await resource.unknown(action);
      break;
    case 'notAdmitted':
      result = await resource.notAdmitted(action);
      break;
    case 'wait':
      result = await resource.wait(action);
      break;
    default:
      throw new Error(`unsupported resource bridge action: ${action.kind}`);
  }
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  let reported = error;
  if (error.code === 'RESOURCE_LIMIT_EXCEEDED' && identity &&
      (action?.kind === 'wait' && action.routeWide === true || String(error.message).includes('cohort API cost'))) {
    try { await new ResourceState(identity).stopCohort('RESOURCE_EXHAUSTED', String(error.message).slice(0, 256)); }
    catch (stopError) { reported = stopError; }
  }
  if (error.code === 'RESOURCE_WAIT' && error.nextEligibleAt && action?.kind === 'reserve' && action.executionId) {
    try {
      const state = await new ResourceState(identity).state();
      const item = state.executions[action.executionId];
      if (item && (!item.nextEligibleAt || Date.parse(item.nextEligibleAt) < Date.parse(error.nextEligibleAt))) {
        const waitMs = Math.max(0, Date.parse(error.nextEligibleAt) - Date.now());
        await new ResourceState(identity).wait({ executionId: action.executionId, nextAt: error.nextEligibleAt,
          waitMs, reason: 'PROVIDER_ROUTE_PACING', routeWide: true });
      }
    } catch (persistError) {
      reported = persistError;
    }
  }
  process.stdout.write(JSON.stringify({
    ok: false,
    error: {
      code: reported.code ?? 'RESOURCE_BRIDGE_FAILURE',
      message: String(reported.message ?? reported).slice(0, 512),
      nextEligibleAt: reported.nextEligibleAt ?? null
    }
  }));
}
