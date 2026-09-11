import { invariant, requireText } from "./contracts.js";
import { defineCapability } from "./agent-runtime.js";
import { ExecutionError, ExHarnessErrorCode } from "./errors.js";

export const ExecutionStatus = Object.freeze({
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  ABORTED: "ABORTED"
});

export function defineExecutionPolicy({
  timeoutMs = 60_000,
  constraints = {}
} = {}) {
  invariant(
    timeoutMs == null || (Number.isInteger(timeoutMs) && timeoutMs > 0),
    "execution timeoutMs must be null or a positive integer"
  );

  return Object.freeze({
    timeoutMs,
    constraints: Object.freeze(structuredClone(constraints ?? {}))
  });
}

export function defineExecutor(executor) {
  invariant(executor && typeof executor.execute === "function", "executor requires execute()");
  return executor;
}

function normalizeExecutionResult(result) {
  invariant(result && typeof result === "object", "executor must return an execution result");
  invariant(Object.values(ExecutionStatus).includes(result.status), "execution result status is invalid");
  return Object.freeze({
    status: result.status,
    output: structuredClone(result.output ?? null),
    artifacts: Object.freeze(structuredClone(result.artifacts ?? [])),
    metadata: structuredClone(result.metadata ?? null),
    error: structuredClone(result.error ?? null)
  });
}

export async function executeWithPolicy(executor, request, {
  policy = {},
  clock = () => Date.now()
} = {}) {
  const resolvedExecutor = defineExecutor(executor);
  const resolvedPolicy = defineExecutionPolicy(policy);
  const controller = new AbortController();
  const startedAt = clock();
  const deadlineAt = resolvedPolicy.timeoutMs == null ? null : startedAt + resolvedPolicy.timeoutMs;
  let timer = null;

  const execution = Promise.resolve().then(() => resolvedExecutor.execute(
    Object.freeze(structuredClone(request)),
    Object.freeze({
      signal: controller.signal,
      startedAt,
      deadlineAt,
      constraints: structuredClone(resolvedPolicy.constraints)
    })
  ));

  try {
    let raw;
    if (resolvedPolicy.timeoutMs == null) {
      raw = await execution;
    } else {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort("execution timeout");
          reject(new ExecutionError(
            ExHarnessErrorCode.EXECUTION_TIMED_OUT,
            `execution timed out after ${resolvedPolicy.timeoutMs}ms`,
            { timeoutMs: resolvedPolicy.timeoutMs }
          ));
        }, resolvedPolicy.timeoutMs);
      });
      raw = await Promise.race([execution, timeout]);
    }

    const result = normalizeExecutionResult(raw);
    if (result.status === ExecutionStatus.SUCCESS) return result;
    if (result.status === ExecutionStatus.ABORTED) {
      throw new ExecutionError(
        ExHarnessErrorCode.EXECUTION_ABORTED,
        "executor reported aborted execution",
        { result }
      );
    }
    throw new ExecutionError(
      ExHarnessErrorCode.EXECUTION_FAILED,
      "executor reported failed execution",
      { result }
    );
  } catch (error) {
    if (error instanceof ExecutionError) throw error;
    throw new ExecutionError(
      ExHarnessErrorCode.EXECUTION_FAILED,
      "executor threw while running action",
      { request },
      error
    );
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

export function createExecutorCapability({
  name,
  description = null,
  mutatesCandidate = false,
  executor,
  executionPolicy = {},
  buildRequest = ({ input, runtime }) => ({ input, runtime }),
  parseOutput = (result) => result.output
}) {
  const capabilityName = requireText(name, "executor capability name");
  invariant(typeof buildRequest === "function", "executor capability buildRequest must be a function");
  invariant(typeof parseOutput === "function", "executor capability parseOutput must be a function");
  const resolvedExecutor = defineExecutor(executor);
  const resolvedPolicy = defineExecutionPolicy(executionPolicy);

  return defineCapability({
    name: capabilityName,
    description,
    mutatesCandidate,
    async execute(input, runtime) {
      const request = await buildRequest({
        input: structuredClone(input),
        runtime: structuredClone(runtime),
        capability: capabilityName
      });
      const result = await executeWithPolicy(resolvedExecutor, {
        capability: capabilityName,
        request: structuredClone(request)
      }, { policy: resolvedPolicy });
      return parseOutput(result);
    }
  });
}
