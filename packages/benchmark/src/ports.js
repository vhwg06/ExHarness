// Capability port contracts. Implementations live outside the package (substrate and experiment adapters).
import { fail, isPlainObject } from './contracts.js';

export const PORT_CONTRACTS = Object.freeze({
  SubstratePort: Object.freeze(['identity', 'prepare', 'execute', 'collect']),
  ProducerPort: Object.freeze(['identity', 'execute']),
  EvaluatorPort: Object.freeze(['identity', 'evaluate']),
  ArtifactPort: Object.freeze(['collect', 'digest']),
  UsagePort: Object.freeze(['observe']),
  EvidenceStorePort: Object.freeze(['append', 'read', 'list'])
});

function assertPort(name, port) {
  if (!port || (typeof port !== 'object' && typeof port !== 'function')) fail('PORT', `${name} must be an object`);
  const missing = PORT_CONTRACTS[name].filter(method => typeof port[method] !== 'function');
  if (missing.length) fail('PORT', `${name} is missing ${missing.join(', ')}`);
  return port;
}

// SubstratePort: identity() -> { substrate, version, commit }, prepare(unit, attempt), execute(prepared, producer), collect(trial).
export function assertSubstratePort(port) {
  assertPort('SubstratePort', port);
  const identity = port.identity();
  if (!isPlainObject(identity) || typeof identity.substrate !== 'string' || !identity.substrate || typeof identity.version !== 'string' || !identity.version)
    fail('PORT', 'SubstratePort.identity() must return { substrate, version, commit }');
  if (!('commit' in identity) || (identity.commit !== null && typeof identity.commit !== 'string')) fail('PORT', 'SubstratePort.identity().commit must be a string or null');
  return port;
}

export function assertPortContract(name, port) {
  if (!(name in PORT_CONTRACTS)) fail('PORT', `unknown port ${name}`);
  return assertPort(name, port);
}
